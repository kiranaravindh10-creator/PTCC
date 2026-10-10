import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { canAny } from "@/server/access/actor";
import { writeAudit } from "@/server/audit";
import type { Ctx } from "@/server/context";
import type { Transaction } from "@/server/db/client";
import {
  branches,
  companies,
  contacts,
  leadRequirements,
  leads,
  quotationLines,
  quotations,
  rolePermissions,
  scopeEntries,
  tasks,
  userRoles,
  users,
} from "@/server/db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import {
  optionalEmail,
  optionalIsoDate,
  optionalPhone,
  optionalText,
  optionalTime,
  optionalUuid,
  parseInput,
  requiredText,
  uuidField,
} from "@/server/validation";
import { parseRupeesToPaise } from "@/lib/money";
import { createCompanyRecord, ensureCompanyBranch, findOrCreateContact, markCustomerOfBranch } from "@/modules/customers/internal";
import { notify, type NotificationInput } from "@/modules/notifications/service";
import { cancelOpenLeadTasks, insertTask, reassignOpenLeadTasks } from "@/modules/tasks/internal";
import {
  canAssignLead,
  canCreateLeadInBranch,
  canManageBranchLeads,
  canNoteLead,
  canReopenLead,
  canSetLeadBranch,
  canWorkLead,
} from "./access";
import { recordActivity } from "./activity";
import {
  advancedStage,
  CALL_OUTCOMES,
  isOpenStage,
  LEAD_SOURCES,
  leadRef,
  OPEN_LEAD_STAGES,
  QUOTATION_STATUS_LABEL,
  quotationRef,
  STAGE_LABEL,
  STAGE_ORDER,
  type AiCaptureMethod,
  type DetectedLanguage,
  type LeadStage,
  type QuotationStatus,
} from "./model";
import { leadVisibility } from "./queries";

const WEBSITE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i;

/**
 * Marketing actions. Each validates input, applies branch-aware access rules (access.ts),
 * and writes the change with its history (activities), notifications and audit entry in one
 * transaction. Forms call these today; Ask PTCC and AI capture will call the same functions.
 */

const CHECK_FIELDS = "Please check the highlighted fields.";
const leadHref = (id: string) => `/leads/${id}`;

// ─── Create ────────────────────────────────────────────────────────────────

export const createLeadSchema = z
  .object({
    /** An existing company chosen from suggestions… */
    companyId: optionalUuid,
    /** …or a new one. */
    companyName: optionalText(160),
    industry: optionalText(120),
    companyPhone: optionalPhone,
    addressLine: optionalText(300),
    area: optionalText(80),
    city: optionalText(80),
    contactName: optionalText(120),
    contactDesignation: optionalText(120),
    contactPhone: optionalPhone,
    contactEmail: optionalEmail,
    companyWebsite: optionalText(200).refine((value) => !value || WEBSITE.test(value), "Enter a website like www.example.com."),
    requirement: requiredText(500, "Say what the customer needs."),
    scopeEntryIds: z.array(z.uuid()).max(20).default([]),
    source: z.enum(LEAD_SOURCES).default("employee"),
    /** "" = branch not known ("Needs assignment"). Omitted = my branch. */
    branchId: z.string().trim().optional(),
    /** Omitted = me if I work leads in this branch, otherwise nobody yet. */
    ownerId: optionalUuid,
    followUpDate: optionalIsoDate,
    followUpTime: optionalTime,
    notes: optionalText(2000),
  })
  .refine((v) => v.companyId || v.companyName, { path: ["companyName"], message: "Enter the company's name." })
  .refine((v) => !v.followUpTime || v.followUpDate, { path: ["followUpDate"], message: "Choose a date for this time." });

export type CreateLeadInput = z.input<typeof createLeadSchema>;
export type CreateLeadData = z.output<typeof createLeadSchema>;

export type CreateLeadOptions = {
  /** Set when the lead came from an AI-assisted capture (capture-service.ts). */
  capture?: {
    id: string;
    method: AiCaptureMethod;
    language: DetectedLanguage;
    provider: string;
    simulated: boolean;
    editedFields: string[];
  };
};

export async function createLead(ctx: Ctx, input: CreateLeadInput, options: CreateLeadOptions = {}): Promise<{ id: string; number: number }> {
  if (!canAny(ctx.actor, "lead.capture", "marketing.work")) throw new ForbiddenError();
  const data = parseInput(createLeadSchema, input);
  return ctx.db.transaction((tx) => createLeadInTx(tx, ctx, data, options));
}

/**
 * createLead inside the caller's transaction — so a capture confirmation creates the lead and
 * marks the capture confirmed atomically. Callers must check permission and parse input first
 * (createLead does both).
 */
export async function createLeadInTx(
  tx: Transaction,
  ctx: Ctx,
  data: CreateLeadData,
  options: CreateLeadOptions = {},
): Promise<{ id: string; number: number }> {
  {
    // Branch: chosen, "" for unknown, or mine by default. Never guessed.
    let branchId: string | null =
      data.branchId === undefined ? ctx.actor.branchId : data.branchId === "" ? null : data.branchId;
    if (branchId) {
      if (!z.uuid().safeParse(branchId).success) throw new ValidationError(CHECK_FIELDS, { branchId: "Choose a branch." });
      // Own branch or "Not sure which branch" — another branch only for company-wide routers.
      if (!canCreateLeadInBranch(ctx.actor, branchId)) {
        throw new ForbiddenError(
          "You can add leads for your own branch. If it belongs to another branch, choose “Not sure which branch” and it will be routed.",
        );
      }
      branchId = await requireActiveBranchId(tx, branchId);
    }

    const company = data.companyId
      ? await requireCompany(tx, data.companyId)
      : await createCompanyRecord(tx, ctx, {
          name: data.companyName!,
          industry: data.industry,
          phone: data.companyPhone,
          addressLine: data.addressLine,
          area: data.area,
          city: data.city,
          website: data.companyWebsite,
        });
    const contact = await findOrCreateContact(tx, {
      companyId: company.id,
      name: data.contactName,
      phone: data.contactPhone,
      email: data.contactEmail,
      designation: data.contactDesignation,
      actorId: ctx.actor.id,
    });

    // Owner: explicit (needs branch lead management, or it's me), else me if I work this branch's leads.
    let ownerUser: { id: string; name: string; branchId: string } | null = null;
    if (data.ownerId) {
      if (!branchId) throw new ValidationError(CHECK_FIELDS, { ownerId: "Choose the branch before assigning someone." });
      const selfAssign = data.ownerId === ctx.actor.id && ctx.actor.branchId === branchId;
      if (!selfAssign && !canManageBranchLeads(ctx.actor, branchId)) throw new ForbiddenError();
      ownerUser = await requireMarketer(tx, data.ownerId, branchId);
    } else if (branchId && ctx.actor.branchId === branchId && ctx.actor.permissions.has("marketing.work")) {
      ownerUser = { id: ctx.actor.id, name: ctx.actor.name, branchId };
    }

    const [lead] = await tx
      .insert(leads)
      .values({
        branchId,
        companyId: company.id,
        contactId: contact?.id ?? null,
        requirement: data.requirement,
        source: data.source,
        captureMethod: options.capture?.method ?? "manual",
        ownerId: ownerUser?.id ?? null,
        assignedBy: ownerUser ? ctx.actor.id : null,
        assignedAt: ownerUser ? ctx.now : null,
        capturedBy: ctx.actor.id,
        createdBy: ctx.actor.id,
        updatedBy: ctx.actor.id,
      })
      .returning({ id: leads.id, number: leads.number });

    if (branchId) await ensureCompanyBranch(tx, { companyId: company.id, branchId, actorId: ctx.actor.id });
    await addRequirementRows(tx, ctx, lead!.id, data.scopeEntryIds.map((scopeEntryId) => ({ scopeEntryId })));

    const base = { companyId: company.id, leadId: lead!.id, contactId: contact?.id, branchId, actorId: ctx.actor.id };
    await recordActivity(tx, { ...base, kind: "lead_created", body: data.requirement, meta: { source: data.source } });
    if (data.notes) await recordActivity(tx, { ...base, kind: "note", body: data.notes });

    if (data.followUpDate && ownerUser) {
      await insertTask(tx, ctx, followUpTask({
        lead: { id: lead!.id, branchId: branchId!, requirement: data.requirement },
        company,
        contact,
        owner: ownerUser,
        dueDate: data.followUpDate,
        dueTime: data.followUpTime,
      }));
      await recordActivity(tx, { ...base, kind: "follow_up_scheduled", meta: { dueDate: data.followUpDate, dueTime: data.followUpTime ?? null } });
    }

    // Tell whoever acts next: the owner, the branch's lead managers, or the company-wide routers.
    const title = `New lead: ${company.name}`;
    const body = `${data.requirement} · ${leadRef(lead!.number)}`;
    const common = { actorId: ctx.actor.id, href: leadHref(lead!.id), entityType: "lead", entityId: lead!.id, body };
    if (ownerUser && ownerUser.id !== ctx.actor.id) {
      await notify(tx, { ...common, recipientId: ownerUser.id, type: "lead.assigned", title });
    } else if (!ownerUser && branchId) {
      const managers = await leadManagersOf(tx, branchId);
      await notify(tx, managers.map((id) => ({ ...common, recipientId: id, type: "lead.needs_owner", title: `${title} — needs an owner` })));
    } else if (!branchId) {
      const routers = await companyWideLeadRouters(tx);
      await notify(tx, routers.map((id) => ({ ...common, recipientId: id, type: "lead.needs_branch", title: `${title} — needs a branch` })));
    }

    const capture = options.capture;
    await writeAudit(tx, {
      actorId: ctx.actor.id,
      action: "lead.create",
      entityType: "lead",
      entityId: lead!.id,
      summary: `${leadRef(lead!.number)} ${company.name}: ${data.requirement}${
        capture ? ` (captured by ${capture.method}${capture.simulated ? ", simulated" : ""})` : ""
      }`,
      changes: {
        branchId: [null, branchId],
        ...(capture
          ? {
              captureId: [null, capture.id],
              captureMethod: [null, capture.method],
              captureLanguage: [null, capture.language],
              captureProvider: [null, capture.provider],
              simulated: [null, capture.simulated],
              editedFields: [null, capture.editedFields],
            }
          : {}),
      },
      meta: ctx.meta,
    });
    return lead!;
  }
}

// ─── Edit ──────────────────────────────────────────────────────────────────

const updateLeadSchema = z.object({
  leadId: uuidField,
  requirement: requiredText(500, "Say what the customer needs."),
  source: z.enum(LEAD_SOURCES),
  contactName: optionalText(120),
  contactPhone: optionalPhone,
  contactEmail: optionalEmail,
});

export async function updateLead(ctx: Ctx, input: z.input<typeof updateLeadSchema>): Promise<void> {
  const data = parseInput(updateLeadSchema, input);
  await ctx.db.transaction(async (tx) => {
    const lead = await lockWorkableLead(tx, ctx, data.leadId);
    const contact =
      data.contactName || data.contactPhone
        ? await findOrCreateContact(tx, {
            companyId: lead.companyId,
            name: data.contactName,
            phone: data.contactPhone,
            email: data.contactEmail,
            actorId: ctx.actor.id,
          })
        : null;
    await tx
      .update(leads)
      .set({
        requirement: data.requirement,
        source: data.source,
        ...(contact ? { contactId: contact.id } : {}),
        updatedBy: ctx.actor.id,
      })
      .where(eq(leads.id, lead.id));
    await writeAudit(tx, {
      actorId: ctx.actor.id,
      action: "lead.update",
      entityType: "lead",
      entityId: lead.id,
      summary: `${leadRef(lead.number)} details updated`,
      changes: {
        requirement: [lead.requirement, data.requirement],
        source: [lead.source, data.source],
        ...(contact && contact.id !== lead.contactId ? { contactId: [lead.contactId, contact.id] } : {}),
      },
      meta: ctx.meta,
    });
  });
}

// ─── Requirements (linked to PTCC's scope) ─────────────────────────────────

const addRequirementSchema = z
  .object({
    leadId: uuidField,
    scopeEntryId: optionalUuid,
    description: optionalText(300),
    quantity: z.coerce.number().int().positive().max(100000).optional(),
  })
  .refine((v) => v.scopeEntryId || v.description, { path: ["description"], message: "Choose a service or describe the requirement." });

/** Adds a requirement. Free text is allowed — it is shown as "Scope not confirmed — verify with PTCC". */
export async function addRequirement(ctx: Ctx, input: z.input<typeof addRequirementSchema>): Promise<void> {
  const data = parseInput(addRequirementSchema, input);
  await ctx.db.transaction(async (tx) => {
    const lead = await lockWorkableLead(tx, ctx, data.leadId);
    await addRequirementRows(tx, ctx, lead.id, [
      { scopeEntryId: data.scopeEntryId, description: data.description, quantity: data.quantity },
    ]);
    await recordActivity(tx, {
      companyId: lead.companyId,
      leadId: lead.id,
      branchId: lead.branchId,
      actorId: ctx.actor.id,
      kind: "requirement_added",
      body: data.description ?? null,
      meta: { scopeEntryId: data.scopeEntryId ?? null },
    });
  });
}

export async function removeRequirement(ctx: Ctx, input: { requirementId: string }): Promise<void> {
  const requirementId = parseInput(uuidField, input.requirementId);
  await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ leadId: leadRequirements.leadId })
      .from(leadRequirements)
      .where(eq(leadRequirements.id, requirementId))
      .limit(1);
    if (!row) throw new NotFoundError();
    await lockWorkableLead(tx, ctx, row.leadId);
    await tx.delete(leadRequirements).where(eq(leadRequirements.id, requirementId));
  });
}

// ─── Assignment ────────────────────────────────────────────────────────────

const assignLeadSchema = z.object({ leadId: uuidField, ownerId: uuidField });

/** Assigns or reassigns a lead to a marketer of its branch. Open follow-ups move with it. */
export async function assignLead(ctx: Ctx, input: { leadId: string; ownerId: string }): Promise<{ ownerName: string }> {
  const data = parseInput(assignLeadSchema, input);
  return ctx.db.transaction(async (tx) => {
    const lead = await lockVisibleLead(tx, ctx, data.leadId);
    if (!canAssignLead(ctx.actor, lead)) {
      if (!lead.branchId) throw new ValidationError("Choose the lead's branch first.", { ownerId: "Choose the lead's branch first." });
      if (!isOpenStage(lead.stage)) throw new ConflictError(`This lead is ${STAGE_LABEL[lead.stage].toLowerCase()}.`);
      throw new ForbiddenError();
    }
    const ownerUser = await requireMarketer(tx, data.ownerId, lead.branchId!);
    if (lead.ownerId === ownerUser.id) return { ownerName: ownerUser.name };
    const previousOwnerId = lead.ownerId;

    await tx
      .update(leads)
      .set({ ownerId: ownerUser.id, assignedBy: ctx.actor.id, assignedAt: ctx.now, updatedBy: ctx.actor.id })
      .where(eq(leads.id, lead.id));
    await reassignOpenLeadTasks(tx, ctx, lead.id, ownerUser);
    await recordActivity(tx, {
      companyId: lead.companyId,
      leadId: lead.id,
      branchId: lead.branchId,
      actorId: ctx.actor.id,
      kind: "assigned",
      meta: { ownerId: ownerUser.id, ownerName: ownerUser.name, previousOwnerId },
    });
    const notifications: NotificationInput[] = [
      {
        recipientId: ownerUser.id,
        actorId: ctx.actor.id,
        type: "lead.assigned",
        title: `New lead: ${lead.companyName}`,
        body: `${lead.requirement} · ${leadRef(lead.number)}`,
        href: leadHref(lead.id),
        entityType: "lead",
        entityId: lead.id,
      },
    ];
    if (previousOwnerId) {
      notifications.push({
        recipientId: previousOwnerId,
        actorId: ctx.actor.id,
        type: "lead.reassigned",
        title: `${leadRef(lead.number)} ${lead.companyName} was reassigned to ${ownerUser.name}`,
        href: leadHref(lead.id),
        entityType: "lead",
        entityId: lead.id,
      });
    }
    await notify(tx, notifications);
    await writeAudit(tx, {
      actorId: ctx.actor.id,
      action: "lead.assign",
      entityType: "lead",
      entityId: lead.id,
      summary: `${leadRef(lead.number)} ${lead.companyName} assigned to ${ownerUser.name}`,
      changes: { ownerId: [previousOwnerId, ownerUser.id] },
      meta: ctx.meta,
    });
    return { ownerName: ownerUser.name };
  });
}

const setBranchSchema = z.object({ leadId: uuidField, branchId: uuidField });

/**
 * Decides which branch a lead belongs to (company-wide decision). If the owner works at
 * another branch, the lead goes back to "needs owner" and its open follow-ups are released
 * to the new branch for assignment.
 */
export async function setLeadBranch(ctx: Ctx, input: { leadId: string; branchId: string }): Promise<void> {
  const data = parseInput(setBranchSchema, input);
  await ctx.db.transaction(async (tx) => {
    const lead = await lockVisibleLead(tx, ctx, data.leadId);
    if (!canSetLeadBranch(ctx.actor, lead)) throw new ForbiddenError();
    const branchId = await requireActiveBranchId(tx, data.branchId);
    if (lead.branchId === branchId) return;
    const [ownerRow] = lead.ownerId
      ? await tx.select({ branchId: users.branchId }).from(users).where(eq(users.id, lead.ownerId)).limit(1)
      : [];
    const keepOwner = Boolean(ownerRow && ownerRow.branchId === branchId);

    await tx
      .update(leads)
      .set({ branchId, ...(keepOwner ? {} : { ownerId: null, assignedBy: null, assignedAt: null }), updatedBy: ctx.actor.id })
      .where(eq(leads.id, lead.id));
    if (!keepOwner) {
      // Open follow-ups wait for the new branch to assign an owner.
      await tx
        .update(tasks)
        .set({ branchId, assigneeId: null, assignedBy: null, assignedAt: null, status: "pending", updatedBy: ctx.actor.id })
        .where(and(eq(tasks.leadId, lead.id), inArray(tasks.status, ["pending", "assigned", "in_progress"])));
    }
    await ensureCompanyBranch(tx, { companyId: lead.companyId, branchId, actorId: ctx.actor.id });
    const [branch] = await tx.select({ name: branches.name }).from(branches).where(eq(branches.id, branchId)).limit(1);
    await recordActivity(tx, {
      companyId: lead.companyId,
      leadId: lead.id,
      branchId,
      actorId: ctx.actor.id,
      kind: "branch_assigned",
      meta: { branchId, branchName: branch?.name ?? null, previousBranchId: lead.branchId },
    });
    if (!keepOwner) {
      const managers = await leadManagersOf(tx, branchId);
      await notify(
        tx,
        managers.map((recipientId) => ({
          recipientId,
          actorId: ctx.actor.id,
          type: "lead.needs_owner",
          title: `New lead for ${branch?.name ?? "your branch"}: ${lead.companyName} — needs an owner`,
          body: `${lead.requirement} · ${leadRef(lead.number)}`,
          href: leadHref(lead.id),
          entityType: "lead",
          entityId: lead.id,
        })),
      );
    }
    await writeAudit(tx, {
      actorId: ctx.actor.id,
      action: "lead.branch",
      entityType: "lead",
      entityId: lead.id,
      summary: `${leadRef(lead.number)} ${lead.companyName} → ${branch?.name ?? branchId}`,
      changes: { branchId: [lead.branchId, branchId], ...(keepOwner ? {} : { ownerId: [lead.ownerId, null] }) },
      meta: ctx.meta,
    });
  });
}

// ─── Calls, notes, follow-ups ──────────────────────────────────────────────

const logCallSchema = z
  .object({
    leadId: uuidField,
    outcome: z.enum(CALL_OUTCOMES, { error: "Choose how the call went." }),
    notes: optionalText(2000),
    followUpDate: optionalIsoDate,
    followUpTime: optionalTime,
  })
  .refine((v) => !v.followUpTime || v.followUpDate, { path: ["followUpDate"], message: "Choose a date for this time." });

/**
 * Records a call and its outcome — one action that also moves the lead to "Contact" on a
 * connected call and, optionally, schedules the next follow-up.
 */
export async function logCall(ctx: Ctx, input: z.input<typeof logCallSchema>): Promise<{ stage: LeadStage }> {
  const data = parseInput(logCallSchema, input);
  return ctx.db.transaction(async (tx) => {
    const lead = await lockWorkableLead(tx, ctx, data.leadId);
    await recordActivity(tx, {
      companyId: lead.companyId,
      leadId: lead.id,
      contactId: lead.contactId,
      branchId: lead.branchId,
      actorId: ctx.actor.id,
      kind: "call",
      callOutcome: data.outcome,
      body: data.notes ?? null,
    });
    let stage = lead.stage;
    if (data.outcome === "connected") stage = await moveForward(tx, ctx, lead, stage, "contact");
    if (data.followUpDate) stage = await scheduleFollowUpInTx(tx, ctx, lead, stage, data.followUpDate, data.followUpTime, null);
    return { stage };
  });
}

const noteSchema = z.object({ leadId: uuidField, body: requiredText(2000, "Write a note first.") });

export async function addLeadNote(ctx: Ctx, input: { leadId: string; body: string }): Promise<void> {
  const data = parseInput(noteSchema, input);
  if (!canNoteLead(ctx.actor)) throw new ForbiddenError();
  await ctx.db.transaction(async (tx) => {
    const lead = await lockVisibleLead(tx, ctx, data.leadId, { lock: false });
    await recordActivity(tx, {
      companyId: lead.companyId,
      leadId: lead.id,
      branchId: lead.branchId,
      actorId: ctx.actor.id,
      kind: "note",
      body: data.body,
    });
    if (lead.ownerId && lead.ownerId !== ctx.actor.id) {
      await notify(tx, {
        recipientId: lead.ownerId,
        actorId: ctx.actor.id,
        type: "lead.note",
        title: `${ctx.actor.name} added a note on ${leadRef(lead.number)} ${lead.companyName}`,
        body: data.body.length > 140 ? `${data.body.slice(0, 137)}…` : data.body,
        href: leadHref(lead.id),
        entityType: "lead",
        entityId: lead.id,
      });
    }
  });
}

const followUpSchema = z
  .object({ leadId: uuidField, dueDate: optionalIsoDate, dueTime: optionalTime, note: optionalText(300) })
  .refine((v) => v.dueDate, { path: ["dueDate"], message: "Choose a date for the follow-up." });

export async function scheduleFollowUp(ctx: Ctx, input: z.input<typeof followUpSchema>): Promise<void> {
  const data = parseInput(followUpSchema, input);
  await ctx.db.transaction(async (tx) => {
    const lead = await lockWorkableLead(tx, ctx, data.leadId);
    await scheduleFollowUpInTx(tx, ctx, lead, lead.stage, data.dueDate!, data.dueTime, data.note ?? null);
  });
}

// ─── Pipeline ──────────────────────────────────────────────────────────────

const stageSchema = z.object({ leadId: uuidField, stage: z.enum(OPEN_LEAD_STAGES, { error: "Choose a stage." }) });

/** Moves an open lead to another open stage (won and lost have their own actions). */
export async function changeStage(ctx: Ctx, input: { leadId: string; stage: string }): Promise<void> {
  const data = parseInput(stageSchema, input);
  await ctx.db.transaction(async (tx) => {
    const lead = await lockWorkableLead(tx, ctx, data.leadId);
    if (!isOpenStage(lead.stage)) throw new ConflictError(`This lead is already ${STAGE_LABEL[lead.stage].toLowerCase()}.`);
    if (lead.stage === data.stage) return;
    await setStage(tx, ctx, lead, data.stage);
  });
}

const wonSchema = z.object({ leadId: uuidField, wonValue: optionalText(30) });

/**
 * Marks a lead won: it becomes a deal, and the company becomes a customer of the lead's
 * branch. The value defaults to the latest accepted (else sent) quotation.
 */
export async function markWon(ctx: Ctx, input: { leadId: string; wonValue?: string }): Promise<void> {
  const data = parseInput(wonSchema, input);
  let wonValuePaise: number | null = null;
  if (data.wonValue) {
    wonValuePaise = parseRupeesToPaise(data.wonValue);
    if (wonValuePaise === null) throw new ValidationError(CHECK_FIELDS, { wonValue: "Enter an amount in rupees, e.g. 25,000." });
  }
  await ctx.db.transaction(async (tx) => {
    const lead = await lockWorkableLead(tx, ctx, data.leadId);
    if (!isOpenStage(lead.stage)) throw new ConflictError(`This lead is already ${STAGE_LABEL[lead.stage].toLowerCase()}.`);
    if (!lead.branchId) throw new ValidationError("Choose the lead's branch first.");
    if (wonValuePaise === null) {
      const [quotation] = await tx
        .select({ totalPaise: quotations.totalPaise })
        .from(quotations)
        .where(and(eq(quotations.leadId, lead.id), inArray(quotations.status, ["accepted", "sent"])))
        .orderBy(sql`case ${quotations.status} when 'accepted' then 0 else 1 end`, desc(quotations.createdAt))
        .limit(1);
      wonValuePaise = quotation?.totalPaise ?? null;
    }
    await tx
      .update(leads)
      .set({ stage: "won", stageChangedAt: ctx.now, wonAt: ctx.now, wonValuePaise, closedBy: ctx.actor.id, updatedBy: ctx.actor.id })
      .where(eq(leads.id, lead.id));
    const { changed } = await markCustomerOfBranch(tx, {
      companyId: lead.companyId,
      branchId: lead.branchId,
      actorId: ctx.actor.id,
      at: ctx.now,
    });
    const base = { companyId: lead.companyId, leadId: lead.id, branchId: lead.branchId, actorId: ctx.actor.id };
    await recordActivity(tx, { ...base, kind: "won", meta: { wonValuePaise } });
    if (changed) await recordActivity(tx, { ...base, kind: "customer_linked", meta: { relationship: "customer" } });
    await writeAudit(tx, {
      actorId: ctx.actor.id,
      action: "lead.won",
      entityType: "lead",
      entityId: lead.id,
      summary: `${leadRef(lead.number)} ${lead.companyName} won`,
      changes: { stage: [lead.stage, "won"], wonValuePaise: [null, wonValuePaise] },
      meta: ctx.meta,
    });
  });
}

const lostSchema = z.object({ leadId: uuidField, reason: requiredText(300, "Say why the lead was lost.") });

/** Marks a lead lost (reason required) and cancels its open follow-ups. */
export async function markLost(ctx: Ctx, input: { leadId: string; reason: string }): Promise<void> {
  const data = parseInput(lostSchema, input);
  await ctx.db.transaction(async (tx) => {
    const lead = await lockWorkableLead(tx, ctx, data.leadId);
    if (!isOpenStage(lead.stage)) throw new ConflictError(`This lead is already ${STAGE_LABEL[lead.stage].toLowerCase()}.`);
    await tx
      .update(leads)
      .set({ stage: "lost", stageChangedAt: ctx.now, lostAt: ctx.now, lostReason: data.reason, closedBy: ctx.actor.id, updatedBy: ctx.actor.id })
      .where(eq(leads.id, lead.id));
    await cancelOpenLeadTasks(tx, ctx, lead.id, "Lead marked lost");
    await recordActivity(tx, {
      companyId: lead.companyId,
      leadId: lead.id,
      branchId: lead.branchId,
      actorId: ctx.actor.id,
      kind: "lost",
      body: data.reason,
    });
    await writeAudit(tx, {
      actorId: ctx.actor.id,
      action: "lead.lost",
      entityType: "lead",
      entityId: lead.id,
      summary: `${leadRef(lead.number)} ${lead.companyName} lost: ${data.reason}`,
      changes: { stage: [lead.stage, "lost"] },
      meta: ctx.meta,
    });
  });
}

/** Reopens a lost lead (branch lead managers). It returns to "Follow-up". */
export async function reopenLead(ctx: Ctx, input: { leadId: string }): Promise<void> {
  const leadId = parseInput(uuidField, input.leadId);
  await ctx.db.transaction(async (tx) => {
    const lead = await lockVisibleLead(tx, ctx, leadId);
    if (!canReopenLead(ctx.actor, lead)) throw new ForbiddenError();
    await tx
      .update(leads)
      .set({ stage: "follow_up", stageChangedAt: ctx.now, lostAt: null, lostReason: null, closedBy: null, updatedBy: ctx.actor.id })
      .where(eq(leads.id, lead.id));
    await recordActivity(tx, {
      companyId: lead.companyId,
      leadId: lead.id,
      branchId: lead.branchId,
      actorId: ctx.actor.id,
      kind: "reopened",
    });
    await writeAudit(tx, {
      actorId: ctx.actor.id,
      action: "lead.reopen",
      entityType: "lead",
      entityId: lead.id,
      summary: `${leadRef(lead.number)} ${lead.companyName} reopened`,
      changes: { stage: ["lost", "follow_up"] },
      meta: ctx.meta,
    });
  });
}

// ─── Quotations ────────────────────────────────────────────────────────────

const quotationLineSchema = z.object({
  scopeEntryId: optionalUuid,
  description: requiredText(300, "Describe this line."),
  quantity: z.coerce.number({ error: "Enter a quantity." }).int("Use a whole number.").positive("Use 1 or more.").max(100000),
  unitPrice: z.string().trim().min(1, "Enter the price per unit."),
});

const createQuotationSchema = z.object({
  leadId: uuidField,
  validUntil: optionalIsoDate,
  notes: optionalText(2000),
  lines: z.array(quotationLineSchema).min(1, "Add at least one line.").max(50),
});

export type CreateQuotationInput = z.input<typeof createQuotationSchema>;

/**
 * Creates a draft quotation. Prices are entered by people — PTCC's prices are not stored
 * anywhere in the platform. Amounts are before tax; invoicing and tax stay in Tally.
 */
export async function createQuotation(ctx: Ctx, input: CreateQuotationInput): Promise<{ id: string; number: number }> {
  const data = parseInput(createQuotationSchema, input);
  const lines = data.lines.map((line, index) => {
    const unitPricePaise = parseRupeesToPaise(line.unitPrice);
    if (unitPricePaise === null) {
      throw new ValidationError(CHECK_FIELDS, { [`lines.${index}.unitPrice`]: "Enter an amount in rupees, e.g. 1,250." });
    }
    return { ...line, unitPricePaise, amountPaise: unitPricePaise * line.quantity, position: index + 1 };
  });
  const totalPaise = lines.reduce((sum, line) => sum + line.amountPaise, 0);

  return ctx.db.transaction(async (tx) => {
    const lead = await lockWorkableLead(tx, ctx, data.leadId);
    if (!isOpenStage(lead.stage)) throw new ConflictError(`This lead is ${STAGE_LABEL[lead.stage].toLowerCase()}.`);
    if (!lead.branchId) throw new ValidationError("Choose the lead's branch before quoting.");
    const scopeIds = lines.map((line) => line.scopeEntryId).filter((id): id is string => Boolean(id));
    if (scopeIds.length) {
      const found = await tx.select({ id: scopeEntries.id }).from(scopeEntries).where(inArray(scopeEntries.id, scopeIds));
      if (found.length !== new Set(scopeIds).size) throw new ValidationError(CHECK_FIELDS, { lines: "A service on this quotation no longer exists." });
    }

    const [quotation] = await tx
      .insert(quotations)
      .values({
        branchId: lead.branchId,
        leadId: lead.id,
        companyId: lead.companyId,
        contactId: lead.contactId,
        validUntil: data.validUntil ?? null,
        notes: data.notes ?? null,
        totalPaise,
        createdBy: ctx.actor.id,
        updatedBy: ctx.actor.id,
      })
      .returning({ id: quotations.id, number: quotations.number });
    await tx.insert(quotationLines).values(
      lines.map((line) => ({
        quotationId: quotation!.id,
        position: line.position,
        scopeEntryId: line.scopeEntryId ?? null,
        description: line.description,
        quantity: line.quantity,
        unitPricePaise: line.unitPricePaise,
        amountPaise: line.amountPaise,
      })),
    );
    await recordActivity(tx, {
      companyId: lead.companyId,
      leadId: lead.id,
      branchId: lead.branchId,
      actorId: ctx.actor.id,
      kind: "quotation_created",
      meta: { quotationId: quotation!.id, number: quotation!.number, totalPaise },
    });
    await moveForward(tx, ctx, lead, lead.stage, "quotation");
    await writeAudit(tx, {
      actorId: ctx.actor.id,
      action: "quotation.create",
      entityType: "quotation",
      entityId: quotation!.id,
      summary: `${quotationRef(quotation!.number)} for ${lead.companyName} (${leadRef(lead.number)})`,
      changes: { totalPaise: [null, totalPaise] },
      meta: ctx.meta,
    });
    return quotation!;
  });
}

const QUOTATION_TRANSITIONS: Record<QuotationStatus, readonly QuotationStatus[]> = {
  draft: ["sent"],
  sent: ["accepted", "rejected"],
  accepted: [],
  rejected: [],
};

const quotationStatusSchema = z.object({ quotationId: uuidField, status: z.enum(["sent", "accepted", "rejected"]) });

export async function setQuotationStatus(ctx: Ctx, input: { quotationId: string; status: string }): Promise<void> {
  const data = parseInput(quotationStatusSchema, input);
  await ctx.db.transaction(async (tx) => {
    const [quotation] = await tx
      .select({ id: quotations.id, number: quotations.number, status: quotations.status, leadId: quotations.leadId })
      .from(quotations)
      .where(eq(quotations.id, data.quotationId))
      .for("update")
      .limit(1);
    if (!quotation) throw new NotFoundError();
    const lead = await lockWorkableLead(tx, ctx, quotation.leadId);
    if (!QUOTATION_TRANSITIONS[quotation.status].includes(data.status)) {
      throw new ConflictError(`This quotation is ${QUOTATION_STATUS_LABEL[quotation.status].toLowerCase()}.`);
    }
    await tx
      .update(quotations)
      .set({
        status: data.status,
        ...(data.status === "sent" ? { sentAt: ctx.now } : { decidedAt: ctx.now }),
        updatedBy: ctx.actor.id,
      })
      .where(eq(quotations.id, quotation.id));
    await recordActivity(tx, {
      companyId: lead.companyId,
      leadId: lead.id,
      branchId: lead.branchId,
      actorId: ctx.actor.id,
      kind: "quotation_status",
      meta: { quotationId: quotation.id, number: quotation.number, from: quotation.status, to: data.status },
    });
    await writeAudit(tx, {
      actorId: ctx.actor.id,
      action: "quotation.status",
      entityType: "quotation",
      entityId: quotation.id,
      summary: `${quotationRef(quotation.number)}: ${QUOTATION_STATUS_LABEL[quotation.status]} → ${QUOTATION_STATUS_LABEL[data.status]}`,
      changes: { status: [quotation.status, data.status] },
      meta: ctx.meta,
    });
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

type LockedLead = {
  id: string;
  number: number;
  stage: LeadStage;
  branchId: string | null;
  ownerId: string | null;
  capturedBy: string;
  companyId: string;
  companyName: string;
  contactId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  requirement: string;
  source: (typeof LEAD_SOURCES)[number];
};

async function lockVisibleLead(tx: Transaction, ctx: Ctx, leadId: string, options: { lock?: boolean } = {}): Promise<LockedLead> {
  const query = tx
    .select({
      id: leads.id,
      number: leads.number,
      stage: leads.stage,
      branchId: leads.branchId,
      ownerId: leads.ownerId,
      capturedBy: leads.capturedBy,
      companyId: leads.companyId,
      companyName: companies.name,
      contactId: leads.contactId,
      contactName: contacts.name,
      contactPhone: contacts.phone,
      requirement: leads.requirement,
      source: leads.source,
    })
    .from(leads)
    .innerJoin(companies, eq(companies.id, leads.companyId))
    .leftJoin(contacts, eq(contacts.id, leads.contactId))
    .where(and(eq(leads.id, leadId), leadVisibility(ctx.actor)))
    .limit(1);
  const [lead] = options.lock === false ? await query : await query.for("update", { of: leads });
  if (!lead) throw new NotFoundError();
  return lead;
}

async function lockWorkableLead(tx: Transaction, ctx: Ctx, leadId: string): Promise<LockedLead> {
  const lead = await lockVisibleLead(tx, ctx, leadId);
  if (!canWorkLead(ctx.actor, lead)) throw new ForbiddenError();
  return lead;
}

async function setStage(tx: Transaction, ctx: Ctx, lead: LockedLead, to: LeadStage): Promise<void> {
  await tx.update(leads).set({ stage: to, stageChangedAt: ctx.now, updatedBy: ctx.actor.id }).where(eq(leads.id, lead.id));
  await recordActivity(tx, {
    companyId: lead.companyId,
    leadId: lead.id,
    branchId: lead.branchId,
    actorId: ctx.actor.id,
    kind: "stage_changed",
    meta: { from: lead.stage, to },
  });
  await writeAudit(tx, {
    actorId: ctx.actor.id,
    action: "lead.stage",
    entityType: "lead",
    entityId: lead.id,
    summary: `${leadRef(lead.number)} ${lead.companyName}: ${STAGE_LABEL[lead.stage]} → ${STAGE_LABEL[to]}`,
    changes: { stage: [lead.stage, to] },
    meta: ctx.meta,
  });
  lead.stage = to;
}

/** Moves an open lead forward to `reached` if it is behind it. Returns the resulting stage. */
async function moveForward(
  tx: Transaction,
  ctx: Ctx,
  lead: LockedLead,
  current: LeadStage,
  reached: (typeof OPEN_LEAD_STAGES)[number],
): Promise<LeadStage> {
  const next = advancedStage(current, reached);
  if (next !== current) await setStage(tx, ctx, lead, next);
  return next;
}

async function scheduleFollowUpInTx(
  tx: Transaction,
  ctx: Ctx,
  lead: LockedLead,
  stage: LeadStage,
  dueDate: string,
  dueTime: string | undefined,
  note: string | null,
): Promise<LeadStage> {
  if (!isOpenStage(stage)) throw new ConflictError(`This lead is ${STAGE_LABEL[stage].toLowerCase()}.`);
  if (!lead.branchId) throw new ValidationError("Choose the lead's branch before scheduling follow-ups.");
  let assignee: { id: string; name: string; branchId: string } | null = null;
  if (lead.ownerId) {
    const [ownerRow] = await tx
      .select({ id: users.id, name: users.name, branchId: users.branchId })
      .from(users)
      .where(eq(users.id, lead.ownerId))
      .limit(1);
    if (ownerRow) assignee = { id: ownerRow.id, name: ownerRow.name, branchId: ownerRow.branchId ?? lead.branchId };
  }
  if (!assignee) throw new ValidationError("Assign the lead to someone before scheduling follow-ups.");
  const [company] = await tx
    .select({ id: companies.id, name: companies.name, addressLine: companies.addressLine, area: companies.area })
    .from(companies)
    .where(eq(companies.id, lead.companyId))
    .limit(1);
  await insertTask(
    tx,
    ctx,
    followUpTask({
      lead: { id: lead.id, branchId: lead.branchId, requirement: lead.requirement },
      company: company!,
      contact: lead.contactId ? { id: lead.contactId, name: lead.contactName ?? "", phone: lead.contactPhone } : null,
      owner: assignee,
      dueDate,
      dueTime,
      note,
    }),
  );
  await recordActivity(tx, {
    companyId: lead.companyId,
    leadId: lead.id,
    branchId: lead.branchId,
    actorId: ctx.actor.id,
    kind: "follow_up_scheduled",
    body: note,
    meta: { dueDate, dueTime: dueTime ?? null },
  });
  // A follow-up after first contact puts the lead in "Follow-up"; before that it stays where it is.
  return STAGE_ORDER[stage] >= STAGE_ORDER.contact ? moveForward(tx, ctx, lead, stage, "follow_up") : stage;
}

function followUpTask(input: {
  lead: { id: string; branchId: string; requirement: string };
  company: { id: string; name: string; addressLine?: string | null; area?: string | null };
  contact: { id: string; name: string; phone: string | null } | null;
  owner: { id: string; name: string; branchId: string };
  dueDate: string;
  dueTime?: string;
  note?: string | null;
}) {
  return {
    kind: "follow_up" as const,
    title: input.lead.requirement.length > 120 ? `${input.lead.requirement.slice(0, 117)}…` : input.lead.requirement,
    details: input.note ?? null,
    branchId: input.lead.branchId,
    leadId: input.lead.id,
    companyId: input.company.id,
    companyName: input.company.name,
    contactId: input.contact?.id ?? null,
    contactName: input.contact?.name ?? null,
    contactPhone: input.contact?.phone ?? null,
    locationAddress: input.company.addressLine ?? null,
    locationArea: input.company.area ?? null,
    dueDate: input.dueDate,
    dueTime: input.dueTime ?? null,
    assignee: { id: input.owner.id, name: input.owner.name },
  };
}

async function addRequirementRows(
  tx: Transaction,
  ctx: Ctx,
  leadId: string,
  rows: { scopeEntryId?: string; description?: string; quantity?: number }[],
): Promise<void> {
  if (rows.length === 0) return;
  const ids = rows.map((row) => row.scopeEntryId).filter((id): id is string => Boolean(id));
  const entries = ids.length
    ? await tx
        .select({ id: scopeEntries.id, text: scopeEntries.measurandOrInstrument })
        .from(scopeEntries)
        .where(inArray(scopeEntries.id, ids))
    : [];
  const byId = new Map(entries.map((entry) => [entry.id, entry.text]));
  await tx.insert(leadRequirements).values(
    rows.map((row) => {
      if (row.scopeEntryId && !byId.has(row.scopeEntryId)) {
        throw new ValidationError(CHECK_FIELDS, { scopeEntryIds: "That service is not in PTCC's scope list." });
      }
      return {
        leadId,
        scopeEntryId: row.scopeEntryId ?? null,
        description: row.description ?? byId.get(row.scopeEntryId!)!,
        quantity: row.quantity ?? null,
        createdBy: ctx.actor.id,
      };
    }),
  );
}

async function requireCompany(tx: Transaction, companyId: string) {
  const [company] = await tx
    .select({ id: companies.id, name: companies.name, addressLine: companies.addressLine, area: companies.area })
    .from(companies)
    .where(and(eq(companies.id, companyId), sql`${companies.archivedAt} is null`))
    .limit(1);
  if (!company) throw new ValidationError(CHECK_FIELDS, { companyId: "Choose a customer from the suggestions." });
  return company;
}

async function requireActiveBranchId(tx: Transaction, branchId: string): Promise<string> {
  const [branch] = await tx
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.status, "active")))
    .limit(1);
  if (!branch) throw new ValidationError(CHECK_FIELDS, { branchId: "Choose an active branch." });
  return branch.id;
}

/** An active person of the branch whose roles allow working leads. */
async function requireMarketer(tx: Transaction, userId: string, branchId: string) {
  const [user] = await tx
    .select({ id: users.id, name: users.name, branchId: users.branchId })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .where(
      and(
        eq(users.id, userId),
        eq(users.status, "active"),
        eq(users.branchId, branchId),
        eq(rolePermissions.permissionKey, "marketing.work"),
      ),
    )
    .limit(1);
  if (!user) {
    throw new ValidationError(CHECK_FIELDS, { ownerId: "Choose someone from this branch's marketing team." });
  }
  return { id: user.id, name: user.name, branchId };
}

/** People who route a branch's leads (marketing.assign.branch in that branch). */
async function leadManagersOf(tx: Transaction, branchId: string): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .where(and(eq(users.status, "active"), eq(users.branchId, branchId), eq(rolePermissions.permissionKey, "marketing.assign.branch")));
  return rows.map((row) => row.id);
}

/**
 * People who decide which branch a lead belongs to: marketing.assign.all (the CEO) and
 * lead.route (Admin). Each person once, even if they hold both.
 */
async function companyWideLeadRouters(tx: Transaction): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ id: users.id })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .where(and(eq(users.status, "active"), inArray(rolePermissions.permissionKey, ["marketing.assign.all", "lead.route"])));
  return rows.map((row) => row.id);
}
