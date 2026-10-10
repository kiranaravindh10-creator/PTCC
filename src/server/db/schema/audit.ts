import { index, jsonb, pgTable, text } from "drizzle-orm/pg-core";
import { createdAt, id, userRef } from "./_columns";
import { users } from "./identity";

/** Before/after values per changed field. */
export type AuditChanges = Record<string, [before: unknown, after: unknown]>;

/**
 * Append-only record of security-relevant and business-state changes.
 * The application never updates or deletes rows here.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    actorId: userRef(() => users.id),
    action: text().notNull(),
    entityType: text(),
    entityId: text(),
    summary: text(),
    changes: jsonb().$type<AuditChanges>(),
    ip: text(),
    userAgent: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
    index("audit_logs_actor_idx").on(t.actorId, t.createdAt),
    index("audit_logs_created_idx").on(t.createdAt.desc()),
  ],
);
