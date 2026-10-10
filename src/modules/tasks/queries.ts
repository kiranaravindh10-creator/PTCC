import "server-only";
import { and, asc, desc, eq, gte, inArray, isNull, lt, notInArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { requirePermission, scopeOf, type Actor } from "@/server/access/actor";
import type { Ctx } from "@/server/context";
import { outerId } from "@/server/db/sql";
import type { Executor } from "@/server/db/client";
import { branches, companies, contacts, roles, taskEvents, tasks, userRoles, users } from "@/server/db/schema";
import { ForbiddenError } from "@/server/errors";
import { companyDayStart, companyToday, toHourMinute, type IsoDate } from "@/lib/time";
import { companyVisibility } from "@/modules/customers/visibility";
import {
  CLOSED_STATUSES,
  DONE_FOR_ASSIGNEE_STATUSES,
  FIELD_KINDS,
  OPEN_FOR_ASSIGNEE_STATUSES,
  type TaskEventType,
  type TaskKind,
  type TaskPriority,
  type TaskStatus,
} from "./model";

/**
 * Reads for work items. Every query applies the actor's visibility in SQL — including
 * branch scope — and fetch-by-id uses the same rule: work outside your scope is simply
 * "not found". Visibility rules: docs/USER_ROLES.md §4.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RECENT_DONE_DAYS = 14;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** SQL condition selecting the tasks this actor may see (undefined = everything). */
export function taskVisibility(actor: Actor): SQL | undefined {
  const workScope = scopeOf(actor, "task.read");
  if (workScope === "all") return undefined;
  const rules: SQL[] = [];
  if (workScope) rules.push(eq(tasks.assigneeId, actor.id), eq(tasks.createdBy, actor.id));
  if (workScope === "branch") rules.push(eq(tasks.branchId, actor.branchId!));
  const fieldScope = scopeOf(actor, "collection.read");
  if (fieldScope === "all") rules.push(inArray(tasks.kind, [...FIELD_KINDS]));
  if (fieldScope === "branch") rules.push(and(inArray(tasks.kind, [...FIELD_KINDS]), eq(tasks.branchId, actor.branchId!))!);
  return rules.length > 0 ? or(...rules) : sql`false`;
}

const assignee = alias(users, "assignee");

const listColumns = {
  id: tasks.id,
  number: tasks.number,
  kind: tasks.kind,
  title: tasks.title,
  status: tasks.status,
  priority: tasks.priority,
  dueDate: tasks.dueDate,
  dueTime: tasks.dueTime,
  branchId: tasks.branchId,
  branchName: branches.name,
  leadId: tasks.leadId,
  companyId: tasks.companyId,
  companyName: companies.name,
  contactName: tasks.contactName,
  contactPhone: tasks.contactPhone,
  locationArea: tasks.locationArea,
  locationAddress: tasks.locationAddress,
  latitude: tasks.latitude,
  longitude: tasks.longitude,
  assigneeId: tasks.assigneeId,
  assigneeName: assignee.name,
  createdBy: tasks.createdBy,
  updatedAt: tasks.updatedAt,
};

export type TaskListItem = {
  id: string;
  number: number;
  kind: TaskKind;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: IsoDate | null;
  dueTime: string | null;
  branchId: string;
  branchName: string;
  leadId: string | null;
  companyId: string | null;
  companyName: string | null;
  contactName: string | null;
  contactPhone: string | null;
  locationArea: string | null;
  locationAddress: string | null;
  latitude: string | null;
  longitude: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  createdBy: string;
  updatedAt: Date;
};

const priorityRank = sql`case ${tasks.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`;
const byDue = [
  sql`${tasks.dueDate} asc nulls last`,
  sql`${tasks.dueTime} asc nulls last`,
  priorityRank,
  asc(tasks.number),
];

function normalizeRow<T extends { dueTime: string | null }>(row: T): T {
  return { ...row, dueTime: toHourMinute(row.dueTime) };
}

function selectTaskList(db: Executor) {
  return db
    .select(listColumns)
    .from(tasks)
    .innerJoin(branches, eq(branches.id, tasks.branchId))
    .leftJoin(companies, eq(companies.id, tasks.companyId))
    .leftJoin(assignee, eq(assignee.id, tasks.assigneeId));
}

export type WorkScope = "mine" | "team";
export type WorkView = "open" | "done";

/**
 * My Work and team lists.
 * - mine/open: assigned to me and still needing me
 * - mine/done: my part finished in the last two weeks
 * - team/open: everything not closed that my scope covers (branch or company)
 * - team/done: closed in the last two weeks
 * `branchId` narrows a company-wide view to one branch (CEO filter).
 */
export async function listWork(
  ctx: Pick<Ctx, "db" | "actor" | "now">,
  options: { scope: WorkScope; view: WorkView; kinds?: readonly TaskKind[]; branchId?: string | null },
): Promise<TaskListItem[]> {
  const conditions: Array<SQL | undefined> = [taskVisibility(ctx.actor)];

  if (options.scope === "mine") {
    conditions.push(eq(tasks.assigneeId, ctx.actor.id));
  } else {
    const fieldOnly = options.kinds?.every((kind) => FIELD_KINDS.includes(kind)) ?? false;
    const wide = (scope: string | null) => scope === "branch" || scope === "all";
    if (!(wide(scopeOf(ctx.actor, "task.read")) || (fieldOnly && wide(scopeOf(ctx.actor, "collection.read"))))) {
      throw new ForbiddenError();
    }
  }
  if (options.kinds) conditions.push(inArray(tasks.kind, [...options.kinds]));
  if (options.branchId) conditions.push(eq(tasks.branchId, options.branchId));

  const since = new Date(ctx.now.getTime() - RECENT_DONE_DAYS * 86_400_000);
  if (options.view === "open") {
    conditions.push(
      options.scope === "mine"
        ? inArray(tasks.status, [...OPEN_FOR_ASSIGNEE_STATUSES])
        : notInArray(tasks.status, [...CLOSED_STATUSES]),
    );
  } else {
    conditions.push(
      inArray(tasks.status, options.scope === "mine" ? [...DONE_FOR_ASSIGNEE_STATUSES] : [...CLOSED_STATUSES]),
      gte(tasks.updatedAt, since),
    );
  }

  const query = selectTaskList(ctx.db).where(and(...conditions));
  const rows =
    options.view === "open"
      ? await query.orderBy(...byDue).limit(300)
      : await query.orderBy(desc(tasks.updatedAt)).limit(100);
  return rows.map(normalizeRow);
}

/** Work nobody owns yet, in the branches the actor can assign for. */
export async function listUnassigned(
  ctx: Pick<Ctx, "db" | "actor">,
  options: { branchId?: string | null } = {},
): Promise<TaskListItem[]> {
  const assignScope = scopeOf(ctx.actor, "task.assign");
  if (!assignScope || assignScope === "own") throw new ForbiddenError();
  const conditions: Array<SQL | undefined> = [taskVisibility(ctx.actor), eq(tasks.status, "pending")];
  if (assignScope === "branch") conditions.push(eq(tasks.branchId, ctx.actor.branchId!));
  if (options.branchId) conditions.push(eq(tasks.branchId, options.branchId));
  const rows = await selectTaskList(ctx.db)
    .where(and(...conditions))
    .orderBy(...byDue)
    .limit(100);
  return rows.map(normalizeRow);
}

export type TaskDetail = TaskListItem & {
  details: string | null;
  contactId: string | null;
  companyArea: string | null;
  companyPhone: string | null;
  createdByName: string;
  assignedByName: string | null;
  assignedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  createdAt: Date;
};

/** A single task, or null if it doesn't exist or is outside the actor's scope. */
export async function getTask(ctx: Pick<Ctx, "db" | "actor">, taskId: string): Promise<TaskDetail | null> {
  if (!isUuid(taskId)) return null;
  const creator = alias(users, "creator");
  const assigner = alias(users, "assigner");
  const [row] = await ctx.db
    .select({
      ...listColumns,
      details: tasks.details,
      contactId: tasks.contactId,
      companyArea: companies.area,
      companyPhone: companies.phone,
      createdByName: creator.name,
      assignedByName: assigner.name,
      assignedAt: tasks.assignedAt,
      startedAt: tasks.startedAt,
      completedAt: tasks.completedAt,
      cancelledAt: tasks.cancelledAt,
      cancelReason: tasks.cancelReason,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .innerJoin(branches, eq(branches.id, tasks.branchId))
    .leftJoin(companies, eq(companies.id, tasks.companyId))
    .leftJoin(assignee, eq(assignee.id, tasks.assigneeId))
    .innerJoin(creator, eq(creator.id, tasks.createdBy))
    .leftJoin(assigner, eq(assigner.id, tasks.assignedBy))
    .where(and(eq(tasks.id, taskId), taskVisibility(ctx.actor)))
    .limit(1);
  return row ? normalizeRow(row) : null;
}

export type TaskEventItem = {
  id: string;
  type: TaskEventType;
  actorName: string | null;
  /** For "assigned" events: the person it was assigned to (current name). */
  assigneeName: string | null;
  fromStatus: TaskStatus | null;
  toStatus: TaskStatus | null;
  body: string | null;
  meta: Record<string, unknown> | null;
  createdAt: Date;
};

/** History of a task. Returns [] if the task is not visible. */
export async function listTaskEvents(ctx: Pick<Ctx, "db" | "actor">, taskId: string): Promise<TaskEventItem[]> {
  const task = await getTask(ctx, taskId);
  if (!task) return [];
  const actor = alias(users, "actor");
  const eventAssignee = alias(users, "event_assignee");
  return ctx.db
    .select({
      id: taskEvents.id,
      type: taskEvents.type,
      actorName: actor.name,
      assigneeName: eventAssignee.name,
      fromStatus: taskEvents.fromStatus,
      toStatus: taskEvents.toStatus,
      body: taskEvents.body,
      meta: taskEvents.meta,
      createdAt: taskEvents.createdAt,
    })
    .from(taskEvents)
    .leftJoin(actor, eq(actor.id, taskEvents.actorId))
    .leftJoin(eventAssignee, eq(sql`${eventAssignee.id}::text`, sql`${taskEvents.meta}->>'assigneeId'`))
    .where(eq(taskEvents.taskId, taskId))
    .orderBy(asc(taskEvents.seq));
}

/** Open work linked to a lead (follow-ups, calls), visible to the actor. */
export async function listLeadTasks(ctx: Pick<Ctx, "db" | "actor">, leadId: string): Promise<TaskListItem[]> {
  const rows = await selectTaskList(ctx.db)
    .where(and(taskVisibility(ctx.actor), eq(tasks.leadId, leadId), notInArray(tasks.status, [...CLOSED_STATUSES])))
    .orderBy(...byDue);
  return rows.map(normalizeRow);
}

/** Open work for a company, visible to the actor (customer page). */
export async function listCompanyTasks(
  ctx: Pick<Ctx, "db" | "actor">,
  companyId: string,
  options: { includeClosed?: boolean } = {},
): Promise<TaskListItem[]> {
  const rows = await selectTaskList(ctx.db)
    .where(
      and(
        taskVisibility(ctx.actor),
        eq(tasks.companyId, companyId),
        options.includeClosed ? undefined : notInArray(tasks.status, [...CLOSED_STATUSES]),
      ),
    )
    .orderBy(...byDue)
    .limit(100);
  return rows.map(normalizeRow);
}

// ─── Options for forms ─────────────────────────────────────────────────────

export type PersonOption = {
  id: string;
  name: string;
  roleNames: string[];
  branchId: string | null;
  branchName: string | null;
};

/**
 * Active people the actor may assign work to: their branch (task.assign.branch) or
 * everyone (task.assign.all), optionally narrowed to one branch.
 */
export async function listAssignablePeople(
  ctx: Pick<Ctx, "db" | "actor">,
  options: { branchId?: string | null } = {},
): Promise<PersonOption[]> {
  const assignScope = scopeOf(ctx.actor, "task.assign");
  if (!assignScope || assignScope === "own") throw new ForbiddenError();
  const branchFilter =
    assignScope === "branch" ? eq(users.branchId, ctx.actor.branchId!) : options.branchId ? eq(users.branchId, options.branchId) : undefined;
  const rows = await ctx.db
    .select({
      id: users.id,
      name: users.name,
      branchId: users.branchId,
      branchName: branches.name,
      roleNames: sql<string[] | null>`array_remove(array_agg(${roles.name} order by ${roles.name}), null)`,
    })
    .from(users)
    .leftJoin(branches, eq(branches.id, users.branchId))
    .leftJoin(userRoles, eq(userRoles.userId, users.id))
    .leftJoin(roles, eq(roles.id, userRoles.roleId))
    .where(and(eq(users.status, "active"), branchFilter))
    .groupBy(users.id, users.name, users.branchId, branches.name)
    .orderBy(asc(branches.name), asc(users.name));
  return rows.map((row) => ({ ...row, roleNames: row.roleNames ?? [] }));
}

export type CompanyOption = {
  id: string;
  name: string;
  area: string | null;
  addressLine: string | null;
};

/** Customers the actor may create work for (visible customers, not archived). */
export async function listCompanyOptions(ctx: Pick<Ctx, "db" | "actor">): Promise<CompanyOption[]> {
  requirePermission(ctx.actor, "task.create");
  return ctx.db
    .select({ id: companies.id, name: companies.name, area: companies.area, addressLine: companies.addressLine })
    .from(companies)
    .where(and(isNull(companies.archivedAt), companyVisibility(ctx.actor)))
    .orderBy(asc(companies.name))
    .limit(500);
}

/** Primary contact for a company (used to pre-fill new work). */
export async function getPrimaryContact(db: Executor, companyId: string) {
  const [contact] = await db
    .select({ id: contacts.id, name: contacts.name, phone: contacts.phone })
    .from(contacts)
    .where(eq(contacts.companyId, companyId))
    .orderBy(desc(contacts.isPrimary), asc(contacts.createdAt))
    .limit(1);
  return contact ?? null;
}

// ─── Aggregates for Home ───────────────────────────────────────────────────

export type TeamMemberLoad = {
  id: string;
  name: string;
  roleNames: string[];
  branchName: string | null;
  open: number;
  dueToday: number;
  overdue: number;
};

/** Open work per active person — my branch (team.view.branch) or any branch (team.view.all). */
export async function teamWorkload(
  ctx: Pick<Ctx, "db" | "actor" | "now">,
  options: { branchId?: string | null } = {},
): Promise<TeamMemberLoad[]> {
  const teamScope = scopeOf(ctx.actor, "team.view");
  if (!teamScope || teamScope === "own") throw new ForbiddenError();
  const branchId = teamScope === "branch" ? ctx.actor.branchId : (options.branchId ?? null);
  const today = companyToday(ctx.now);
  const rows = await ctx.db
    .select({
      id: users.id,
      name: users.name,
      branchName: branches.name,
      roleNames: sql<string[] | null>`(
        select array_agg(r.name order by r.name) from user_roles ur
        join roles r on r.id = ur.role_id where ur.user_id = ${outerId(users)})`,
      open: sql<number>`count(${tasks.id})::int`,
      dueToday: sql<number>`count(${tasks.id}) filter (where ${eq(tasks.dueDate, today)})::int`,
      overdue: sql<number>`count(${tasks.id}) filter (where ${lt(tasks.dueDate, today)})::int`,
    })
    .from(users)
    .leftJoin(branches, eq(branches.id, users.branchId))
    .leftJoin(tasks, and(eq(tasks.assigneeId, users.id), inArray(tasks.status, [...OPEN_FOR_ASSIGNEE_STATUSES])))
    .where(
      and(
        eq(users.status, "active"),
        branchId ? eq(users.branchId, branchId) : undefined,
        // People who do operational work — not accounts that only administer or oversee.
        sql`exists (select 1 from user_roles ur join roles r on r.id = ur.role_id
                    where ur.user_id = ${users.id} and r.key not in ('admin', 'ceo'))`,
      ),
    )
    .groupBy(users.id, users.name, branches.name)
    .orderBy(desc(sql`count(${tasks.id})`), asc(users.name));
  return rows.map((row) => ({ ...row, roleNames: row.roleNames ?? [] }));
}

export type CompanyWorkSnapshot = {
  open: number;
  dueToday: number;
  overdue: number;
  unassigned: number;
  completedToday: number;
  field: Record<"pending" | "assigned" | "in_progress" | "collected" | "delivered" | "delayed", number> & {
    completedToday: number;
  };
};

/** Work numbers for the CEO overview, company-wide or for one branch. Computed live. */
export async function companyWorkSnapshot(
  ctx: Pick<Ctx, "db" | "actor" | "now">,
  options: { branchId?: string | null } = {},
): Promise<CompanyWorkSnapshot> {
  requirePermission(ctx.actor, "overview.company");
  const today = companyToday(ctx.now);
  const completedToday = and(eq(tasks.status, "completed"), gte(tasks.completedAt, companyDayStart(today)));
  const notClosed = notInArray(tasks.status, [...CLOSED_STATUSES]);
  const open = inArray(tasks.status, ["pending", "assigned", "in_progress"]);
  const field = inArray(tasks.kind, [...FIELD_KINDS]);
  const countWhere = (condition: SQL | undefined) => sql<number>`(count(*) filter (where ${condition}))::int`;

  const [row] = await ctx.db
    .select({
      open: countWhere(notClosed),
      dueToday: countWhere(and(notClosed, eq(tasks.dueDate, today))),
      overdue: countWhere(and(open, lt(tasks.dueDate, today))),
      unassigned: countWhere(eq(tasks.status, "pending")),
      completedToday: countWhere(completedToday),
      fPending: countWhere(and(field, eq(tasks.status, "pending"))),
      fAssigned: countWhere(and(field, eq(tasks.status, "assigned"))),
      fInProgress: countWhere(and(field, eq(tasks.status, "in_progress"))),
      fCollected: countWhere(eq(tasks.status, "collected")),
      fDelivered: countWhere(eq(tasks.status, "delivered")),
      fDelayed: countWhere(and(field, open, lt(tasks.dueDate, today))),
      fCompletedToday: countWhere(and(field, completedToday)),
    })
    .from(tasks)
    .where(options.branchId ? eq(tasks.branchId, options.branchId) : undefined);

  return {
    open: row?.open ?? 0,
    dueToday: row?.dueToday ?? 0,
    overdue: row?.overdue ?? 0,
    unassigned: row?.unassigned ?? 0,
    completedToday: row?.completedToday ?? 0,
    field: {
      pending: row?.fPending ?? 0,
      assigned: row?.fAssigned ?? 0,
      in_progress: row?.fInProgress ?? 0,
      collected: row?.fCollected ?? 0,
      delivered: row?.fDelivered ?? 0,
      delayed: row?.fDelayed ?? 0,
      completedToday: row?.fCompletedToday ?? 0,
    },
  };
}
