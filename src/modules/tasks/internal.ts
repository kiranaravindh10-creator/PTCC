import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { writeAudit } from "@/server/audit";
import type { Ctx } from "@/server/context";
import type { Transaction } from "@/server/db/client";
import { taskEvents, tasks } from "@/server/db/schema";
import { formatAbsoluteDue } from "@/lib/time";
import { taskRef } from "@/lib/format";
import { notify } from "@/modules/notifications/service";
import { KIND_LABEL, type TaskKind, type TaskPriority } from "./model";

/**
 * Trusted building blocks for creating and adjusting work from other module services
 * (e.g. Marketing scheduling a follow-up). Callers must have checked permission and pass
 * their open transaction. Pages and actions use service.ts instead.
 */

export const taskHref = (id: string) => `/work/${id}`;

export type NewTaskRecord = {
  kind: TaskKind;
  title: string;
  details?: string | null;
  priority?: TaskPriority;
  branchId: string;
  leadId?: string | null;
  companyId?: string | null;
  companyName?: string | null;
  contactId?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  locationAddress?: string | null;
  locationArea?: string | null;
  latitude?: string | null;
  longitude?: string | null;
  dueDate?: string | null;
  dueTime?: string | null;
  assignee: { id: string; name: string } | null;
};

/** Inserts work with its history, the assignee's notification and the audit entry. */
export async function insertTask(tx: Transaction, ctx: Ctx, record: NewTaskRecord): Promise<{ id: string; number: number }> {
  const assigneeId = record.assignee?.id ?? null;
  const [task] = await tx
    .insert(tasks)
    .values({
      kind: record.kind,
      title: record.title,
      details: record.details ?? null,
      priority: record.priority ?? "normal",
      status: assigneeId ? "assigned" : "pending",
      branchId: record.branchId,
      leadId: record.leadId ?? null,
      companyId: record.companyId ?? null,
      contactId: record.contactId ?? null,
      contactName: record.contactName ?? null,
      contactPhone: record.contactPhone ?? null,
      locationAddress: record.locationAddress ?? null,
      locationArea: record.locationArea ?? null,
      latitude: record.latitude ?? null,
      longitude: record.longitude ?? null,
      dueDate: record.dueDate ?? null,
      dueTime: record.dueTime ?? null,
      assigneeId,
      assignedBy: assigneeId ? ctx.actor.id : null,
      assignedAt: assigneeId ? ctx.now : null,
      createdBy: ctx.actor.id,
      updatedBy: ctx.actor.id,
    })
    .returning({ id: tasks.id, number: tasks.number });

  await tx.insert(taskEvents).values({
    taskId: task!.id,
    actorId: ctx.actor.id,
    type: "created",
    toStatus: assigneeId ? "assigned" : "pending",
  });
  if (record.assignee && record.assignee.id !== ctx.actor.id) {
    await tx.insert(taskEvents).values({
      taskId: task!.id,
      actorId: ctx.actor.id,
      type: "assigned",
      meta: { assigneeId: record.assignee.id, assigneeName: record.assignee.name },
    });
    await notify(tx, {
      recipientId: record.assignee.id,
      actorId: ctx.actor.id,
      type: "task.assigned",
      title: `New ${KIND_LABEL[record.kind].toLowerCase()}: ${record.companyName ?? record.title}`,
      body: describeWhen(record.dueDate, record.dueTime, record.title, record.companyName),
      href: taskHref(task!.id),
      entityType: "task",
      entityId: task!.id,
    });
  }
  await writeAudit(tx, {
    actorId: ctx.actor.id,
    action: "task.create",
    entityType: "task",
    entityId: task!.id,
    summary: `${KIND_LABEL[record.kind]} ${taskRef(task!.number)}: ${record.title}`,
    meta: ctx.meta,
  });
  return task!;
}

const OPEN = ["pending", "assigned", "in_progress"] as const;

/** Cancels a lead's open follow-ups and calls (e.g. when the lead is lost). */
export async function cancelOpenLeadTasks(tx: Transaction, ctx: Ctx, leadId: string, reason: string): Promise<number> {
  const open = await tx
    .select({ id: tasks.id, status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.leadId, leadId), inArray(tasks.status, [...OPEN])));
  for (const task of open) {
    await tx
      .update(tasks)
      .set({ status: "cancelled", cancelledAt: ctx.now, cancelReason: reason, updatedBy: ctx.actor.id })
      .where(eq(tasks.id, task.id));
    await tx.insert(taskEvents).values({
      taskId: task.id,
      actorId: ctx.actor.id,
      type: "status_changed",
      fromStatus: task.status,
      toStatus: "cancelled",
      body: reason,
    });
  }
  return open.length;
}

/** Moves a lead's open follow-ups and calls to its new owner. */
export async function reassignOpenLeadTasks(
  tx: Transaction,
  ctx: Ctx,
  leadId: string,
  owner: { id: string; name: string; branchId: string },
): Promise<number> {
  const open = await tx
    .select({ id: tasks.id, status: tasks.status, assigneeId: tasks.assigneeId })
    .from(tasks)
    .where(and(eq(tasks.leadId, leadId), inArray(tasks.status, [...OPEN])));
  let moved = 0;
  for (const task of open) {
    if (task.assigneeId === owner.id) continue;
    await tx
      .update(tasks)
      .set({
        assigneeId: owner.id,
        assignedBy: ctx.actor.id,
        assignedAt: ctx.now,
        status: "assigned",
        startedAt: null,
        branchId: owner.branchId,
        updatedBy: ctx.actor.id,
      })
      .where(eq(tasks.id, task.id));
    await tx.insert(taskEvents).values({
      taskId: task.id,
      actorId: ctx.actor.id,
      type: "assigned",
      fromStatus: task.status,
      toStatus: "assigned",
      meta: { assigneeId: owner.id, assigneeName: owner.name, previousAssigneeId: task.assigneeId },
    });
    moved += 1;
  }
  return moved;
}

/** Notification body: what and when. Dates are absolute because this text is stored. */
export function describeWhen(
  dueDate: string | null | undefined,
  dueTime: string | null | undefined,
  title: string,
  companyName: string | null | undefined,
): string {
  const when = dueDate ? formatAbsoluteDue(dueDate, dueTime ?? null) : null;
  const what = companyName ? title : null;
  return [what, when].filter(Boolean).join(" · ");
}
