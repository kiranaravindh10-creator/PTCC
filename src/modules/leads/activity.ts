import "server-only";
import type { Executor } from "@/server/db/client";
import { activities } from "@/server/db/schema";
import type { ActivityKind, CallOutcome } from "./model";

export type ActivityInput = {
  companyId: string;
  leadId?: string | null;
  contactId?: string | null;
  branchId?: string | null;
  actorId: string;
  kind: ActivityKind;
  callOutcome?: CallOutcome | null;
  body?: string | null;
  meta?: Record<string, unknown> | null;
  occurredAt?: Date;
};

/**
 * Appends to a customer's / lead's history. Trusted internal helper: callers (module
 * services) have already checked permission and are inside their transaction.
 */
export async function recordActivity(executor: Executor, input: ActivityInput): Promise<void> {
  await executor.insert(activities).values({
    companyId: input.companyId,
    leadId: input.leadId ?? null,
    contactId: input.contactId ?? null,
    branchId: input.branchId ?? null,
    actorId: input.actorId,
    kind: input.kind,
    callOutcome: input.callOutcome ?? null,
    body: input.body ?? null,
    meta: input.meta ?? null,
    ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
  });
}
