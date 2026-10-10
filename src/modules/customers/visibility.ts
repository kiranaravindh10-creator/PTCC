import "server-only";
import { or, sql, type SQL } from "drizzle-orm";
import { can, type Actor } from "@/server/access/actor";
import { companies, companyBranches, leads, tasks } from "@/server/db/schema";

/**
 * Which companies an actor may open (SQL condition on `companies`; undefined = all).
 *
 * A company is central master data shared by all branches, but browsing is branch-aware:
 * - customer.read.all → every company
 * - customer.read     → companies linked to my branch
 * - anyone            → companies of leads I own or added, and of work assigned to me
 *
 * Branch business records about a company (leads, quotations, work, calls) have their own,
 * stricter visibility rules — seeing a company never reveals another branch's records.
 */
export function companyVisibility(actor: Actor): SQL | undefined {
  if (can(actor, "customer.read.all")) return undefined;
  const rules: SQL[] = [
    sql`exists (select 1 from ${leads} where ${leads.companyId} = ${companies.id}
                and (${leads.ownerId} = ${actor.id} or ${leads.capturedBy} = ${actor.id}))`,
    sql`exists (select 1 from ${tasks} where ${tasks.companyId} = ${companies.id} and ${tasks.assigneeId} = ${actor.id})`,
  ];
  if (can(actor, "customer.read") && actor.branchId) {
    rules.unshift(
      sql`exists (select 1 from ${companyBranches} where ${companyBranches.companyId} = ${companies.id}
                  and ${companyBranches.branchId} = ${actor.branchId})`,
    );
  }
  return or(...rules);
}
