import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requirePermission, scopeOf } from "@/server/access/actor";
import { writeAudit } from "@/server/audit";
import type { Ctx } from "@/server/context";
import type { Transaction } from "@/server/db/client";
import { branches, companies, taskEvents, tasks, users } from "@/server/db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import {
  optionalIsoDate,
  optionalPhone,
  optionalText,
  optionalTime,
  optionalUuid,
  parseInput,
  requiredText,
  uuidField,
} from "@/server/validation";
import { taskRef } from "@/lib/format";
import { ensureCompanyBranch } from "@/modules/customers/internal";
import { companyVisibility } from "@/modules/customers/visibility";
import { recordActivity } from "@/modules/leads/activity";
import { notify, type NotificationInput } from "@/modules/notifications/service";
import { describeWhen, insertTask, taskHref } from "./internal";
import { KIND_LABEL, STATUS_LABEL, TASK_KINDS, TASK_PRIORITIES, type TaskStatus } from "./model";
import { getPrimaryContact, taskVisibility } from "./queries";
import { canAssign, checkTransition, isTaskAction } from "./workflow";

/**
 * All changes to work go through these functions — from forms today, and from Ask
 * PTCC and integrations later. Each one validates input, checks permission (including
 * branch scope), and writes the change, its history, notifications and the audit log in
 * one transaction.
 */

const CHECK_FIELDS = "Please check the highlighted fields.";

// ─── Create ────────────────────────────────────────────────────────────────

export const createTaskSchema = z
  .object({
    kind: z.enum(TASK_KINDS, { error: "Choose what kind of work this is." }),
    title: requiredText(160, "Say what needs to be done."),
    details: optionalText(4000),
    priority: z.enum(TASK_PRIORITIES).default("normal"),
    companyId: optionalUuid,
    contactName: optionalText(120),
    contactPhone: optionalPhone,
    locationAddress: optionalText(300),
    locationArea: optionalText(80),
    dueDate: optionalIsoDate,
    dueTime: optionalTime,
    /** "" = unassigned (only for people who can assign). Omitted = me. */
    assigneeId: z.string().trim().optional(),
    /** Only for people who assign across branches; otherwise the work is in their branch. */
    branchId: optionalUuid,
  })
  .refine((value) => !value.dueTime || value.dueDate, {
    path: ["dueDate"],
    message: "Choose a date for this time.",
  });

export type CreateTaskInput = z.input<typeof createTaskSchema>;

export async function createTask(ctx: Ctx, input: CreateTaskInput): Promise<{ id: string; number: number }> {
  requirePermission(ctx.actor, "task.create");
  const data = parseInput(createTaskSchema, input);
  const assignScope = scopeOf(ctx.actor, "task.assign");

  // Who will do it: unspecified → me. Anyone else (or nobody) requires an assign permission.
  const assigneeId = data.assigneeId === undefined ? ctx.actor.id : data.assigneeId || null;
  if (assigneeId !== ctx.actor.id && !assignScope) throw new ForbiddenError();
  if (assigneeId && !z.uuid().safeParse(assigneeId).success) {
    throw new ValidationError(CHECK_FIELDS, { assigneeId: "Choose a valid person." });
  }
  if (data.branchId && assignScope !== "all" && data.branchId !== ctx.actor.branchId) throw new ForbiddenError();

  return ctx.db.transaction(async (tx) => {
    const assignee = assigneeId ? await requireActiveUser(tx, assigneeId) : null;

    // Which branch the work belongs to: chosen (company-wide assigners), else the
    // assignee's branch, else mine. Never left to guesswork.
    const branchId = data.branchId ?? assignee?.branchId ?? ctx.actor.branchId;
    if (!branchId) throw new ValidationError(CHECK_FIELDS, { branchId: "Choose the branch this work belongs to." });
    await requireActiveBranch(tx, branchId);
    if (assignScope !== "all" && branchId !== ctx.actor.branchId && assigneeId !== ctx.actor.id) {
      throw new ValidationError(CHECK_FIELDS, { assigneeId: "Choose someone from your branch." });
    }
    if (assignee && assignee.id !== ctx.actor.id && assignee.branchId && assignee.branchId !== branchId) {
      throw new ValidationError(CHECK_FIELDS, {
        assigneeId: `${assignee.name} works at another branch. Choose someone from this branch.`,
      });
    }

    // Fill in from the customer what the person didn't type ("don't ask twice").
    let company: typeof companies.$inferSelect | undefined;
    if (data.companyId) {
      [company] = await tx
        .select()
        .from(companies)
        .where(and(eq(companies.id, data.companyId), companyVisibility(ctx.actor)))
        .limit(1);
      if (!company) throw new ValidationError(CHECK_FIELDS, { companyId: "Choose a customer from the list." });
      await ensureCompanyBranch(tx, { companyId: company.id, branchId, actorId: ctx.actor.id });
    }
    const contact = company && !data.contactName && !data.contactPhone ? await getPrimaryContact(tx, company.id) : null;
    const usingCompanyAddress = company && !data.locationAddress && !data.locationArea;

    return insertTask(tx, ctx, {
      kind: data.kind,
      title: data.title,
      details: data.details,
      priority: data.priority,
      branchId,
      companyId: company?.id,
      companyName: company?.name,
      contactId: contact?.id,
      contactName: data.contactName ?? contact?.name,
      contactPhone: data.contactPhone ?? contact?.phone,
      locationAddress: data.locationAddress ?? (usingCompanyAddress ? company!.addressLine : null),
      locationArea: data.locationArea ?? (usingCompanyAddress ? company!.area : null),
      latitude: usingCompanyAddress ? company!.latitude : null,
      longitude: usingCompanyAddress ? company!.longitude : null,
      dueDate: data.dueDate,
      dueTime: data.dueTime,
      assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
    });
  });
}

// ─── Assign ────────────────────────────────────────────────────────────────

const assignSchema = z.object({ taskId: uuidField, assigneeId: uuidField });

/**
 * Assigns or reassigns open work. Branch coordinators assign within their branch;
 * company-wide assigners may hand work to anyone, which moves it to that person's branch.
 */
export async function assignTask(
  ctx: Ctx,
  input: { taskId: string; assigneeId: string },
): Promise<{ assigneeName: string }> {
  const assignScope = scopeOf(ctx.actor, "task.assign");
  if (!assignScope || assignScope === "own") throw new ForbiddenError();
  const data = parseInput(assignSchema, input);

  return ctx.db.transaction(async (tx) => {
    const task = await lockVisibleTask(tx, ctx, data.taskId);
    if (!canAssign(task, ctx.actor)) {
      if (task.status === "pending" || task.status === "assigned" || task.status === "in_progress") throw new ForbiddenError();
      throw new ConflictError(`This work is ${STATUS_LABEL[task.status].toLowerCase()} and can no longer be reassigned.`);
    }
    const assignee = await requireActiveUser(tx, data.assigneeId);
    if (assignScope === "branch" && assignee.branchId !== ctx.actor.branchId) {
      throw new ValidationError(CHECK_FIELDS, { assigneeId: "Choose someone from your branch." });
    }
    if (task.assigneeId === assignee.id) return { assigneeName: assignee.name };
    const previousAssigneeId = task.assigneeId;
    const branchId = assignee.branchId && assignee.branchId !== task.branchId ? assignee.branchId : task.branchId;

    await tx
      .update(tasks)
      .set({
        assigneeId: assignee.id,
        assignedBy: ctx.actor.id,
        assignedAt: ctx.now,
        status: "assigned",
        startedAt: null,
        branchId,
        updatedBy: ctx.actor.id,
      })
      .where(eq(tasks.id, task.id));
    await tx.insert(taskEvents).values({
      taskId: task.id,
      actorId: ctx.actor.id,
      type: "assigned",
      fromStatus: task.status,
      toStatus: "assigned",
      meta: {
        assigneeId: assignee.id,
        assigneeName: assignee.name,
        previousAssigneeId,
        ...(branchId !== task.branchId ? { movedFromBranchId: task.branchId, movedToBranchId: branchId } : {}),
      },
    });

    const label = `${KIND_LABEL[task.kind]} ${taskRef(task.number)}`;
    const notifications: NotificationInput[] = [
      {
        recipientId: assignee.id,
        actorId: ctx.actor.id,
        type: "task.assigned",
        title: `New ${KIND_LABEL[task.kind].toLowerCase()}: ${task.companyName ?? task.title}`,
        body: describeWhen(task.dueDate, task.dueTime, task.title, task.companyName),
        href: taskHref(task.id),
        entityType: "task",
        entityId: task.id,
      },
    ];
    if (previousAssigneeId) {
      notifications.push({
        recipientId: previousAssigneeId,
        actorId: ctx.actor.id,
        type: "task.reassigned",
        title: `${label} was reassigned to ${assignee.name}`,
        body: task.title,
        href: taskHref(task.id),
        entityType: "task",
        entityId: task.id,
      });
    }
    await notify(tx, notifications);
    await writeAudit(tx, {
      actorId: ctx.actor.id,
      action: "task.assign",
      entityType: "task",
      entityId: task.id,
      summary: `${label} assigned to ${assignee.name}`,
      changes: {
        assigneeId: [previousAssigneeId, assignee.id],
        ...(branchId !== task.branchId ? { branchId: [task.branchId, branchId] } : {}),
      },
      meta: ctx.meta,
    });
    return { assigneeName: assignee.name };
  });
}

// ─── Status changes ────────────────────────────────────────────────────────

const transitionSchema = z.object({
  taskId: uuidField,
  action: z.string().refine(isTaskAction, "Unknown action."),
  reason: optionalText(500),
});

export async function transitionTask(
  ctx: Ctx,
  input: { taskId: string; action: string; reason?: string },
): Promise<{ status: TaskStatus }> {
  const data = parseInput(transitionSchema, input);
  if (!isTaskAction(data.action)) throw new ValidationError("Unknown action.");
  const action = data.action;

  return ctx.db.transaction(async (tx) => {
    const task = await lockVisibleTask(tx, ctx, data.taskId);
    const check = checkTransition(task, action, ctx.actor);
    if (!check.ok) {
      if (check.reason === "forbidden") throw new ForbiddenError();
      throw new ConflictError(`This work is already ${STATUS_LABEL[task.status].toLowerCase()}.`);
    }
    if (action === "cancel" && !data.reason) {
      throw new ValidationError("Please say why this is being cancelled.", { reason: "Please give a reason." });
    }

    const to = check.to;
    await tx
      .update(tasks)
      .set({
        status: to,
        updatedBy: ctx.actor.id,
        ...(to === "in_progress" ? { startedAt: ctx.now } : {}),
        ...(to === "completed" ? { completedAt: ctx.now, completedBy: ctx.actor.id } : {}),
        ...(to === "cancelled" ? { cancelledAt: ctx.now, cancelReason: data.reason ?? null } : {}),
      })
      .where(eq(tasks.id, task.id));
    await tx.insert(taskEvents).values({
      taskId: task.id,
      actorId: ctx.actor.id,
      type: "status_changed",
      fromStatus: task.status,
      toStatus: to,
      body: action === "cancel" ? (data.reason ?? null) : null,
    });

    // A completed follow-up or call is part of the lead's history.
    if (to === "completed" && task.leadId && task.companyId) {
      await recordActivity(tx, {
        companyId: task.companyId,
        leadId: task.leadId,
        branchId: task.branchId,
        actorId: ctx.actor.id,
        kind: "follow_up_done",
        body: task.title,
        meta: { taskId: task.id, taskKind: task.kind },
      });
    }

    // Tell the people on the other side of the hand-off.
    const label = `${KIND_LABEL[task.kind]} ${taskRef(task.number)}`;
    const subject = task.companyName ?? task.title;
    const base = { actorId: ctx.actor.id, href: taskHref(task.id), entityType: "task", entityId: task.id };
    const others = [task.createdBy, task.assignedBy].filter((id): id is string => Boolean(id));
    const recipients: NotificationInput[] = [];
    if (to === "collected" || to === "delivered" || (to === "completed" && task.assigneeId === ctx.actor.id)) {
      for (const recipientId of others) {
        recipients.push({ ...base, recipientId, type: "task.progress", title: `${label} ${check.past}: ${subject}`, body: `By ${ctx.actor.name}` });
      }
    } else if (to === "completed" && task.assigneeId) {
      recipients.push({ ...base, recipientId: task.assigneeId, type: "task.closed", title: `${label} ${check.past}: ${subject}` });
    } else if (to === "cancelled") {
      for (const recipientId of [task.assigneeId, ...others]) {
        if (recipientId) recipients.push({ ...base, recipientId, type: "task.cancelled", title: `${label} ${check.past}: ${subject}`, body: data.reason });
      }
    }
    await notify(tx, recipients);

    await writeAudit(tx, {
      actorId: ctx.actor.id,
      action: "task.status_change",
      entityType: "task",
      entityId: task.id,
      summary: `${label}: ${STATUS_LABEL[task.status]} → ${STATUS_LABEL[to]}`,
      changes: { status: [task.status, to] },
      meta: ctx.meta,
    });
    return { status: to };
  });
}

// ─── Comments ──────────────────────────────────────────────────────────────

const commentSchema = z.object({
  taskId: uuidField,
  body: requiredText(2000, "Write a note first."),
});

export async function addTaskComment(ctx: Ctx, input: { taskId: string; body: string }): Promise<void> {
  requirePermission(ctx.actor, "task.work");
  const data = parseInput(commentSchema, input);
  await ctx.db.transaction(async (tx) => {
    const task = await lockVisibleTask(tx, ctx, data.taskId, { lock: false });
    await tx.insert(taskEvents).values({ taskId: task.id, actorId: ctx.actor.id, type: "comment", body: data.body });
    const recipients = [task.assigneeId, task.createdBy, task.assignedBy].filter((id): id is string => Boolean(id));
    await notify(
      tx,
      recipients.map((recipientId) => ({
        recipientId,
        actorId: ctx.actor.id,
        type: "task.comment",
        title: `${ctx.actor.name} added a note on ${KIND_LABEL[task.kind].toLowerCase()} ${taskRef(task.number)}`,
        body: data.body.length > 140 ? `${data.body.slice(0, 137)}…` : data.body,
        href: taskHref(task.id),
        entityType: "task",
        entityId: task.id,
      })),
    );
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

async function lockVisibleTask(tx: Transaction, ctx: Ctx, taskId: string, options: { lock?: boolean } = {}) {
  const query = tx
    .select({
      id: tasks.id,
      number: tasks.number,
      kind: tasks.kind,
      title: tasks.title,
      status: tasks.status,
      branchId: tasks.branchId,
      leadId: tasks.leadId,
      companyId: tasks.companyId,
      assigneeId: tasks.assigneeId,
      assignedBy: tasks.assignedBy,
      createdBy: tasks.createdBy,
      dueDate: tasks.dueDate,
      dueTime: tasks.dueTime,
      companyName: companies.name,
    })
    .from(tasks)
    .leftJoin(companies, eq(companies.id, tasks.companyId))
    .where(and(eq(tasks.id, taskId), taskVisibility(ctx.actor)))
    .limit(1);
  const [task] = options.lock === false ? await query : await query.for("update", { of: tasks });
  if (!task) throw new NotFoundError();
  return task;
}

async function requireActiveUser(tx: Transaction, userId: string) {
  const [user] = await tx
    .select({ id: users.id, name: users.name, branchId: users.branchId })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.status, "active")))
    .limit(1);
  if (!user) throw new ValidationError(CHECK_FIELDS, { assigneeId: "Choose an active person." });
  return user;
}

async function requireActiveBranch(tx: Transaction, branchId: string) {
  const [branch] = await tx
    .select({ id: branches.id })
    .from(branches)
    .where(and(eq(branches.id, branchId), eq(branches.status, "active")))
    .limit(1);
  if (!branch) throw new ValidationError(CHECK_FIELDS, { branchId: "Choose an active branch." });
}
