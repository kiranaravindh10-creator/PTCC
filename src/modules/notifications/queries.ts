import "server-only";
import { and, count, desc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Ctx } from "@/server/context";
import { notifications, users } from "@/server/db/schema";

/** Notifications are only ever visible to their recipient. */

export async function unreadNotificationCount(ctx: Pick<Ctx, "db" | "actor">): Promise<number> {
  const [row] = await ctx.db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.recipientId, ctx.actor.id), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  actorName: string | null;
  readAt: Date | null;
  createdAt: Date;
};

export async function listNotifications(
  ctx: Pick<Ctx, "db" | "actor">,
  options: { limit?: number } = {},
): Promise<NotificationItem[]> {
  const actor = alias(users, "actor");
  return ctx.db
    .select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      href: notifications.href,
      actorName: actor.name,
      readAt: notifications.readAt,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .leftJoin(actor, eq(actor.id, notifications.actorId))
    .where(eq(notifications.recipientId, ctx.actor.id))
    .orderBy(desc(notifications.createdAt))
    .limit(options.limit ?? 50);
}
