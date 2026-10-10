import "server-only";
import { and, asc, eq, gte, inArray, lt, notInArray, sql, type SQL } from "drizzle-orm";
import { can, scopeOf, type Actor } from "@/server/access/actor";
import type { Ctx } from "@/server/context";
import { outerId } from "@/server/db/sql";
import { activities, branches, leads, quotations, rolePermissions, tasks, userRoles, users } from "@/server/db/schema";
import { ForbiddenError } from "@/server/errors";
import { addDays, companyDayStart, companyToday } from "@/lib/time";
import { FIELD_KINDS } from "@/modules/tasks/model";

/**
 * Management numbers, computed live from the records people update while working —
 * nobody types figures in for management's sake (docs/PRODUCT_ARCHITECTURE.md §2).
 * Company-wide (CEO) or for one branch.
 */

export const PERIODS = ["today", "7d", "30d"] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_LABEL: Record<Period, string> = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days" };

export function periodStart(period: Period, now: Date): Date {
  const today = companyToday(now);
  const days = period === "today" ? 0 : period === "7d" ? 6 : 29;
  return companyDayStart(addDays(today, -days));
}

/**
 * Which branch the numbers may cover: the CEO chooses (null = all branches); a branch
 * marketing manager or coordinator always gets their own branch.
 */
function metricsBranch(actor: Actor, requested: string | null | undefined): string | null {
  if (can(actor, "overview.company")) return requested ?? null;
  if (scopeOf(actor, "marketing.read") === "branch" && actor.branchId) return actor.branchId;
  throw new ForbiddenError();
}

export type MarketingMetrics = {
  callsMade: number;
  callsConnected: number;
  newLeads: number;
  followUpsDone: number;
  followUpsOverdue: number;
  quotations: number;
  won: number;
  lost: number;
  /** Won ÷ (won + lost) for leads closed in the period; null when none closed. */
  winRate: number | null;
  businessValuePaise: number;
};

const count = (condition: SQL | undefined) => sql<number>`(count(*) filter (where ${condition ?? sql`true`}))::int`;

export async function marketingMetrics(
  ctx: Pick<Ctx, "db" | "actor" | "now">,
  options: { branchId?: string | null; period: Period },
): Promise<MarketingMetrics> {
  const branchId = metricsBranch(ctx.actor, options.branchId);
  const since = periodStart(options.period, ctx.now);
  const today = companyToday(ctx.now);

  const [calls] = await ctx.db
    .select({
      made: count(undefined),
      connected: count(eq(activities.callOutcome, "connected")),
    })
    .from(activities)
    .where(and(eq(activities.kind, "call"), gte(activities.occurredAt, since), branchId ? eq(activities.branchId, branchId) : undefined));

  const [leadRow] = await ctx.db
    .select({
      created: count(gte(leads.createdAt, since)),
      won: count(and(eq(leads.stage, "won"), gte(leads.wonAt, since))),
      lost: count(and(eq(leads.stage, "lost"), gte(leads.lostAt, since))),
      value: sql<number>`coalesce(sum(${leads.wonValuePaise}) filter (where ${leads.stage} = 'won' and ${leads.wonAt} >= ${since.toISOString()}::timestamptz), 0)::bigint`,
    })
    .from(leads)
    .where(branchId ? eq(leads.branchId, branchId) : undefined);

  const [followUps] = await ctx.db
    .select({
      done: count(and(eq(tasks.status, "completed"), gte(tasks.completedAt, since))),
      overdue: count(and(inArray(tasks.status, ["pending", "assigned", "in_progress"]), lt(tasks.dueDate, today))),
    })
    .from(tasks)
    .where(and(eq(tasks.kind, "follow_up"), branchId ? eq(tasks.branchId, branchId) : undefined));

  const [quotationRow] = await ctx.db
    .select({ created: count(undefined) })
    .from(quotations)
    .where(and(gte(quotations.createdAt, since), branchId ? eq(quotations.branchId, branchId) : undefined));

  const won = leadRow?.won ?? 0;
  const lost = leadRow?.lost ?? 0;
  return {
    callsMade: calls?.made ?? 0,
    callsConnected: calls?.connected ?? 0,
    newLeads: leadRow?.created ?? 0,
    followUpsDone: followUps?.done ?? 0,
    followUpsOverdue: followUps?.overdue ?? 0,
    quotations: quotationRow?.created ?? 0,
    won,
    lost,
    winRate: won + lost > 0 ? won / (won + lost) : null,
    businessValuePaise: Number(leadRow?.value ?? 0),
  };
}

export type PersonPerformance = {
  id: string;
  name: string;
  branchName: string | null;
  calls: number;
  connected: number;
  newLeads: number;
  followUpsDone: number;
  quotations: number;
  won: number;
  valuePaise: number;
};

/** Per-marketer numbers for the period (people whose roles allow working leads). */
export async function marketingPerformance(
  ctx: Pick<Ctx, "db" | "actor" | "now">,
  options: { branchId?: string | null; period: Period },
): Promise<PersonPerformance[]> {
  const branchId = metricsBranch(ctx.actor, options.branchId);
  const since = periodStart(options.period, ctx.now).toISOString();
  const rows = await ctx.db
    .selectDistinct({
      id: users.id,
      name: users.name,
      branchName: branches.name,
      calls: sql<number>`(select count(*)::int from ${activities} a where a.actor_id = ${outerId(users)} and a.kind = 'call' and a.occurred_at >= ${since}::timestamptz)`,
      connected: sql<number>`(select count(*)::int from ${activities} a where a.actor_id = ${outerId(users)} and a.kind = 'call' and a.call_outcome = 'connected' and a.occurred_at >= ${since}::timestamptz)`,
      newLeads: sql<number>`(select count(*)::int from ${leads} l where l.owner_id = ${outerId(users)} and l.created_at >= ${since}::timestamptz)`,
      followUpsDone: sql<number>`(select count(*)::int from ${tasks} t where t.assignee_id = ${outerId(users)} and t.kind = 'follow_up' and t.status = 'completed' and t.completed_at >= ${since}::timestamptz)`,
      quotations: sql<number>`(select count(*)::int from ${quotations} q where q.created_by = ${outerId(users)} and q.created_at >= ${since}::timestamptz)`,
      won: sql<number>`(select count(*)::int from ${leads} l where l.owner_id = ${outerId(users)} and l.stage = 'won' and l.won_at >= ${since}::timestamptz)`,
      valuePaise: sql<number>`(select coalesce(sum(l.won_value_paise), 0)::bigint from ${leads} l where l.owner_id = ${outerId(users)} and l.stage = 'won' and l.won_at >= ${since}::timestamptz)`,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .leftJoin(branches, eq(branches.id, users.branchId))
    .where(
      and(
        eq(users.status, "active"),
        eq(rolePermissions.permissionKey, "marketing.work"),
        notInArray(users.id, ctx.db.select({ id: userRoles.userId }).from(userRoles).innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId)).where(eq(rolePermissions.permissionKey, "overview.company"))),
        branchId ? eq(users.branchId, branchId) : undefined,
      ),
    )
    .orderBy(asc(branches.name), asc(users.name));
  return rows.map((row) => ({ ...row, valuePaise: Number(row.valuePaise) }));
}

export type BranchComparisonRow = {
  branchId: string;
  branchName: string;
  newLeads: number;
  calls: number;
  won: number;
  valuePaise: number;
  openPickupsAndDeliveries: number;
  delayed: number;
};

/** One row per active branch — CEO only. */
export async function branchComparison(
  ctx: Pick<Ctx, "db" | "actor" | "now">,
  options: { period: Period },
): Promise<BranchComparisonRow[]> {
  if (!can(ctx.actor, "overview.company")) throw new ForbiddenError();
  const since = periodStart(options.period, ctx.now).toISOString();
  const today = companyToday(ctx.now);
  const fieldKinds = sql.raw(FIELD_KINDS.map((kind) => `'${kind}'`).join(", "));
  const rows = await ctx.db
    .select({
      branchId: branches.id,
      branchName: branches.name,
      newLeads: sql<number>`(select count(*)::int from ${leads} l where l.branch_id = ${outerId(branches)} and l.created_at >= ${since}::timestamptz)`,
      calls: sql<number>`(select count(*)::int from ${activities} a where a.branch_id = ${outerId(branches)} and a.kind = 'call' and a.occurred_at >= ${since}::timestamptz)`,
      won: sql<number>`(select count(*)::int from ${leads} l where l.branch_id = ${outerId(branches)} and l.stage = 'won' and l.won_at >= ${since}::timestamptz)`,
      valuePaise: sql<number>`(select coalesce(sum(l.won_value_paise), 0)::bigint from ${leads} l where l.branch_id = ${outerId(branches)} and l.stage = 'won' and l.won_at >= ${since}::timestamptz)`,
      openPickupsAndDeliveries: sql<number>`(select count(*)::int from ${tasks} t where t.branch_id = ${outerId(branches)} and t.kind in (${fieldKinds}) and t.status not in ('completed', 'cancelled'))`,
      delayed: sql<number>`(select count(*)::int from ${tasks} t where t.branch_id = ${outerId(branches)} and t.kind in (${fieldKinds}) and t.status in ('pending', 'assigned', 'in_progress') and t.due_date < ${today})`,
    })
    .from(branches)
    .where(eq(branches.status, "active"))
    .orderBy(asc(branches.name));
  return rows.map((row) => ({ ...row, valuePaise: Number(row.valuePaise) }));
}
