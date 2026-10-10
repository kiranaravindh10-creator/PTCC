import "server-only";
import type { RequestMeta } from "./context";
import type { Executor } from "./db/client";
import { auditLogs, type AuditChanges } from "./db/schema";

export type AuditEntry = {
  actorId: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  summary?: string;
  changes?: AuditChanges;
  meta?: RequestMeta;
};

/** Appends an audit record. Call inside the same transaction as the change it describes. */
export async function writeAudit(executor: Executor, entry: AuditEntry): Promise<void> {
  await executor.insert(auditLogs).values({
    actorId: entry.actorId,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    summary: entry.summary ?? null,
    changes: entry.changes ?? null,
    ip: entry.meta?.ip ?? null,
    userAgent: entry.meta?.userAgent ?? null,
  });
}

/** Builds `{ field: [before, after] }` for the fields that actually changed. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>): AuditChanges {
  const changes: AuditChanges = {};
  for (const key of Object.keys(after)) {
    const a = before[key];
    const b = after[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[key] = [a ?? null, b ?? null];
  }
  return changes;
}
