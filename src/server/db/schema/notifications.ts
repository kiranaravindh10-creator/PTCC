import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, userRef } from "./_columns";
import { users } from "./identity";

/**
 * In-app notifications. `href` is a pointer, not a grant: the target page re-checks
 * permissions when opened. External channels (WhatsApp) will be delivered from an
 * outbox table in Phase 7 — docs/DATABASE_ARCHITECTURE.md §12.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    recipientId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text().notNull(),
    title: text().notNull(),
    body: text(),
    href: text(),
    entityType: text(),
    entityId: uuid(),
    actorId: userRef(() => users.id),
    readAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_recipient_idx").on(t.recipientId, t.readAt, t.createdAt.desc())],
);
