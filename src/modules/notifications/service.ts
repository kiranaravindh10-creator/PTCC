import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { Ctx } from "@/server/context";
import type { Executor } from "@/server/db/client";
import { notifications } from "@/server/db/schema";

export type NotificationInput = {
  recipientId: string;
  type: string;
  title: string;
  body?: string;
  href?: string;
  entityType?: string;
  entityId?: string;
  actorId?: string | null;
};

/**
 * Creates in-app notifications. Called by other module services inside their
 * transaction (it performs no permission check of its own — callers decide who to
 * notify). Recipients who are the actor themselves are skipped.
 *
 * NOT IMPLEMENTED (Phase 7): fan-out to WhatsApp via the notification_deliveries outbox.
 */
export async function notify(executor: Executor, inputs: NotificationInput | NotificationInput[]): Promise<void> {
  const list = (Array.isArray(inputs) ? inputs : [inputs]).filter(
    (input, index, all) =>
      input.recipientId !== input.actorId &&
      all.findIndex((other) => other.recipientId === input.recipientId) === index,
  );
  if (list.length === 0) return;
  await executor.insert(notifications).values(
    list.map((input) => ({
      recipientId: input.recipientId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      actorId: input.actorId ?? null,
    })),
  );
}

/** Marks one of the actor's notifications read. Returns its link (if any). */
export async function markNotificationRead(ctx: Ctx, notificationId: string): Promise<{ href: string | null } | null> {
  const [row] = await ctx.db
    .update(notifications)
    .set({ readAt: ctx.now })
    .where(and(eq(notifications.id, notificationId), eq(notifications.recipientId, ctx.actor.id)))
    .returning({ href: notifications.href });
  return row ?? null;
}

export async function markAllNotificationsRead(ctx: Ctx): Promise<void> {
  await ctx.db
    .update(notifications)
    .set({ readAt: ctx.now })
    .where(and(eq(notifications.recipientId, ctx.actor.id), isNull(notifications.readAt)));
}
