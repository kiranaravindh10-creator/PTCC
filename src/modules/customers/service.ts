import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { can, requirePermission } from "@/server/access/actor";
import { diff, writeAudit } from "@/server/audit";
import type { Ctx } from "@/server/context";
import type { Transaction } from "@/server/db/client";
import { branches, companies, companyBranches, contacts } from "@/server/db/schema";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { optionalEmail, optionalPhone, optionalText, optionalUuid, parseInput, requiredText, uuidField } from "@/server/validation";
import { normalizeCompanyName } from "@/lib/company";
import { recordActivity } from "@/modules/leads/activity";
import { createCompanyRecord, ensureCompanyBranch, findOrCreateContact, markCustomerOfBranch } from "./internal";
import { companyVisibility } from "./visibility";

/**
 * Customer changes. A company is one central record shared by every department and branch;
 * these functions keep it that way (duplicate checks) and record each branch's relationship.
 */

const CHECK_FIELDS = "Please check the highlighted fields.";

const companyFields = {
  name: requiredText(160, "Enter the company's name."),
  industry: optionalText(120),
  phone: optionalPhone,
  email: optionalEmail,
  website: optionalText(200),
  addressLine: optionalText(300),
  area: optionalText(80),
  city: optionalText(80),
  state: optionalText(80),
  pincode: optionalText(12),
};

const createCustomerSchema = z.object({
  ...companyFields,
  /** Company-wide roles may choose; others always link to their own branch. */
  branchId: optionalUuid,
  relationship: z.enum(["prospect", "customer"]).default("prospect"),
  contactName: optionalText(120),
  contactPhone: optionalPhone,
  contactEmail: optionalEmail,
  contactDesignation: optionalText(120),
});

export type CreateCustomerInput = z.input<typeof createCustomerSchema>;

export async function createCustomer(ctx: Ctx, input: CreateCustomerInput): Promise<{ id: string }> {
  requirePermission(ctx.actor, "customer.write");
  const data = parseInput(createCustomerSchema, input);
  const branchId = await resolveBranch(ctx, data.branchId);

  return ctx.db.transaction(async (tx) => {
    const company = await createCompanyRecord(tx, ctx, data);
    await ensureCompanyBranch(tx, {
      companyId: company.id,
      branchId,
      actorId: ctx.actor.id,
      relationship: data.relationship,
      at: ctx.now,
    });
    if (data.contactName || data.contactPhone) {
      const contact = await findOrCreateContact(tx, {
        companyId: company.id,
        name: data.contactName,
        phone: data.contactPhone,
        email: data.contactEmail,
        actorId: ctx.actor.id,
      });
      if (contact && data.contactDesignation) {
        await tx.update(contacts).set({ designation: data.contactDesignation }).where(eq(contacts.id, contact.id));
      }
    }
    await recordActivity(tx, {
      companyId: company.id,
      branchId,
      actorId: ctx.actor.id,
      kind: "customer_linked",
      meta: { relationship: data.relationship },
    });
    return { id: company.id };
  });
}

const updateCustomerSchema = z.object({ companyId: uuidField, ...companyFields, notes: optionalText(4000) });

export async function updateCustomer(ctx: Ctx, input: z.input<typeof updateCustomerSchema>): Promise<void> {
  requirePermission(ctx.actor, "customer.write");
  const data = parseInput(updateCustomerSchema, input);
  await ctx.db.transaction(async (tx) => {
    const before = await lockVisibleCompany(tx, ctx, data.companyId);
    const normalizedName = normalizeCompanyName(data.name);
    if (normalizedName !== before.normalizedName) {
      const [duplicate] = await tx
        .select({ name: companies.name })
        .from(companies)
        .where(and(eq(companies.normalizedName, normalizedName), ne(companies.id, before.id)))
        .limit(1);
      if (duplicate) throw new ValidationError(CHECK_FIELDS, { name: `“${duplicate.name}” already exists.` });
    }
    const after = {
      name: data.name,
      industry: data.industry ?? null,
      phone: data.phone ?? null,
      email: data.email ?? null,
      website: data.website ?? null,
      addressLine: data.addressLine ?? null,
      area: data.area ?? null,
      city: data.city ?? null,
      state: data.state ?? null,
      pincode: data.pincode ?? null,
      notes: data.notes ?? null,
    };
    await tx
      .update(companies)
      .set({ ...after, normalizedName, updatedBy: ctx.actor.id })
      .where(eq(companies.id, before.id));
    const changes = diff(before as unknown as Record<string, unknown>, after);
    if (Object.keys(changes).length > 0) {
      await writeAudit(tx, {
        actorId: ctx.actor.id,
        action: "customer.update",
        entityType: "company",
        entityId: before.id,
        summary: `Updated customer ${data.name}`,
        changes,
        meta: ctx.meta,
      });
    }
  });
}

const contactSchema = z
  .object({
    companyId: uuidField,
    name: requiredText(120, "Enter the contact's name."),
    phone: optionalPhone,
    email: optionalEmail,
    designation: optionalText(120),
    makePrimary: z.union([z.literal("on"), z.boolean()]).optional().transform(Boolean),
  });

export async function addContact(ctx: Ctx, input: z.input<typeof contactSchema>): Promise<{ id: string }> {
  requirePermission(ctx.actor, "customer.write");
  const data = parseInput(contactSchema, input);
  return ctx.db.transaction(async (tx) => {
    const company = await lockVisibleCompany(tx, ctx, data.companyId);
    if (data.phone) {
      const [existing] = await tx
        .select({ name: contacts.name })
        .from(contacts)
        .where(and(eq(contacts.companyId, company.id), eq(contacts.phone, data.phone)))
        .limit(1);
      if (existing) throw new ValidationError(CHECK_FIELDS, { phone: `This number is already saved for ${existing.name}.` });
    }
    if (data.makePrimary) {
      await tx.update(contacts).set({ isPrimary: false }).where(eq(contacts.companyId, company.id));
    }
    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(contacts)
      .where(eq(contacts.companyId, company.id));
    const [contact] = await tx
      .insert(contacts)
      .values({
        companyId: company.id,
        name: data.name,
        phone: data.phone ?? null,
        email: data.email ?? null,
        designation: data.designation ?? null,
        isPrimary: data.makePrimary || count === 0,
        createdBy: ctx.actor.id,
        updatedBy: ctx.actor.id,
      })
      .returning({ id: contacts.id });
    await writeAudit(tx, {
      actorId: ctx.actor.id,
      action: "contact.create",
      entityType: "company",
      entityId: company.id,
      summary: `Added contact ${data.name} at ${company.name}`,
      meta: ctx.meta,
    });
    return contact!;
  });
}

const relationshipSchema = z.object({
  companyId: uuidField,
  branchId: optionalUuid,
  relationship: z.enum(["prospect", "customer", "inactive"]),
});

/**
 * Sets a company's relationship with a branch — e.g. adding an existing PTCC company to my
 * branch's list, or recording that it is now a customer here. Branch staff act on their own
 * branch only.
 */
export async function setBranchRelationship(
  ctx: Ctx,
  input: { companyId: string; branchId?: string; relationship: string },
): Promise<void> {
  requirePermission(ctx.actor, "customer.write");
  const data = parseInput(relationshipSchema, input);
  const branchId = await resolveBranch(ctx, data.branchId);
  await ctx.db.transaction(async (tx) => {
    // Linking a company to my branch is allowed even if I couldn't see it before — that's
    // how an existing PTCC company is reused instead of duplicated.
    const [company] = await tx
      .select({ id: companies.id, name: companies.name })
      .from(companies)
      .where(eq(companies.id, data.companyId))
      .limit(1);
    if (!company) throw new NotFoundError();
    const [before] = await tx
      .select({ relationship: companyBranches.relationship })
      .from(companyBranches)
      .where(and(eq(companyBranches.companyId, company.id), eq(companyBranches.branchId, branchId)))
      .limit(1);
    if (data.relationship === "customer") {
      await markCustomerOfBranch(tx, { companyId: company.id, branchId, actorId: ctx.actor.id, at: ctx.now });
    } else {
      await ensureCompanyBranch(tx, { companyId: company.id, branchId, actorId: ctx.actor.id, relationship: data.relationship });
      await tx
        .update(companyBranches)
        .set({ relationship: data.relationship, updatedBy: ctx.actor.id })
        .where(and(eq(companyBranches.companyId, company.id), eq(companyBranches.branchId, branchId)));
    }
    if (before?.relationship === data.relationship) return;
    await recordActivity(tx, {
      companyId: company.id,
      branchId,
      actorId: ctx.actor.id,
      kind: "customer_linked",
      meta: { relationship: data.relationship, previous: before?.relationship ?? null },
    });
    await writeAudit(tx, {
      actorId: ctx.actor.id,
      action: "customer.relationship",
      entityType: "company",
      entityId: company.id,
      summary: `${company.name}: ${before?.relationship ?? "not linked"} → ${data.relationship}`,
      changes: { relationship: [before?.relationship ?? null, data.relationship], branchId: [null, branchId] },
      meta: ctx.meta,
    });
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** My branch, unless I'm company-wide and chose one. */
async function resolveBranch(ctx: Ctx, requested: string | undefined): Promise<string> {
  const companyWide = can(ctx.actor, "customer.read.all");
  const branchId = requested && companyWide ? requested : ctx.actor.branchId;
  if (requested && !companyWide && requested !== ctx.actor.branchId) throw new ForbiddenError();
  if (!branchId) throw new ValidationError(CHECK_FIELDS, { branchId: "Choose a branch." });
  const [branch] = await ctx.db
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.status, "active")))
    .limit(1);
  if (!branch) throw new ValidationError(CHECK_FIELDS, { branchId: "Choose an active branch." });
  return branchId;
}

async function lockVisibleCompany(tx: Transaction, ctx: Ctx, companyId: string) {
  const [company] = await tx
    .select()
    .from(companies)
    .where(and(eq(companies.id, companyId), companyVisibility(ctx.actor)))
    .for("update")
    .limit(1);
  if (!company) throw new NotFoundError();
  return company;
}
