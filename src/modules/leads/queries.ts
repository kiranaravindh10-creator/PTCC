import "server-only";
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { can, requirePermission, scopeOf, type Actor } from "@/server/access/actor";
import type { Ctx } from "@/server/context";
import { outerId } from "@/server/db/sql";
import type { Executor } from "@/server/db/client";
import {
  activities,
  branches,
  companies,
  contacts,
  leadRequirements,
  leads,
  quotationLines,
  quotations,
  rolePermissions,
  tasks,
  userRoles,
  users,
} from "@/server/db/schema";
import { ForbiddenError } from "@/server/errors";
import { companyToday, toHourMinute, type IsoDate } from "@/lib/time";
import { getScopeEntries } from "@/modules/catalogue/queries";
import { scopeStatus, type ScopeStatus } from "@/modules/catalogue/status";
import {
  OPEN_LEAD_STAGES,
  type ActivityKind,
  type CallOutcome,
  type CaptureMethod,
  type LeadSource,
  type LeadStage,
  type QuotationStatus,
} from "./model";

/**
 * Reads for leads, quotations and marketing history. Branch isolation is applied in SQL:
 * a lead outside the actor's scope is "not found", whatever ID is in the URL.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Leads this actor may see (undefined = all). Everyone sees leads they added. */
export function leadVisibility(actor: Actor): SQL | undefined {
  const scope = scopeOf(actor, "marketing.read");
  // Routing leads company-wide needs to see them all.
  if (scope === "all" || can(actor, "lead.route")) return undefined;
  const rules: SQL[] = [eq(leads.capturedBy, actor.id)];
  if (scope) rules.push(eq(leads.ownerId, actor.id));
  if (scope === "branch") rules.push(eq(leads.branchId, actor.branchId!));
  return or(...rules);
}

/**
 * Marketing history this actor may see: activities on visible leads, plus activities of
 * their branch (branch scope) or their own (own scope).
 */
export function activityVisibility(actor: Actor): SQL | undefined {
  const scope = scopeOf(actor, "marketing.read");
  if (scope === "all" || can(actor, "lead.route")) return undefined;
  const visibleLead = leadVisibility(actor);
  const rules: SQL[] = [
    eq(activities.actorId, actor.id),
    sql`(${activities.leadId} is not null and exists (select 1 from ${leads} where ${leads.id} = ${activities.leadId} and ${visibleLead ?? sql`true`}))`,
  ];
  if (scope === "branch") rules.push(eq(activities.branchId, actor.branchId!));
  return or(...rules);
}

const owner = alias(users, "owner");
const capturer = alias(users, "capturer");

/** Earliest open follow-up / call for the lead. */
const nextFollowUp = sql<{ due_date: string | null; due_time: string | null; id: string } | null>`(
  select json_build_object('id', t.id, 'due_date', t.due_date, 'due_time', t.due_time)
  from ${tasks} t
  where t.lead_id = ${outerId(leads)} and t.status in ('pending', 'assigned', 'in_progress')
  order by t.due_date asc nulls last, t.due_time asc nulls last
  limit 1)`;

const listColumns = {
  id: leads.id,
  number: leads.number,
  stage: leads.stage,
  requirement: leads.requirement,
  source: leads.source,
  createdAt: leads.createdAt,
  companyId: leads.companyId,
  companyName: companies.name,
  companyArea: companies.area,
  companyCity: companies.city,
  branchId: leads.branchId,
  branchName: branches.name,
  ownerId: leads.ownerId,
  ownerName: owner.name,
  capturedBy: leads.capturedBy,
  capturedByName: capturer.name,
  wonValuePaise: leads.wonValuePaise,
  nextFollowUp,
};

export type LeadListItem = {
  id: string;
  number: number;
  stage: LeadStage;
  requirement: string;
  source: LeadSource;
  createdAt: Date;
  companyId: string;
  companyName: string;
  companyArea: string | null;
  companyCity: string | null;
  branchId: string | null;
  branchName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  capturedBy: string;
  capturedByName: string;
  wonValuePaise: number | null;
  nextFollowUp: { id: string; dueDate: IsoDate | null; dueTime: string | null } | null;
};

function selectLeads(db: Executor) {
  return db
    .select(listColumns)
    .from(leads)
    .innerJoin(companies, eq(companies.id, leads.companyId))
    .leftJoin(branches, eq(branches.id, leads.branchId))
    .leftJoin(owner, eq(owner.id, leads.ownerId))
    .innerJoin(capturer, eq(capturer.id, leads.capturedBy));
}

function toListItem(row: Awaited<ReturnType<ReturnType<typeof selectLeads>["execute"]>>[number]): LeadListItem {
  const next = row.nextFollowUp;
  return {
    ...row,
    nextFollowUp: next ? { id: next.id, dueDate: next.due_date, dueTime: toHourMinute(next.due_time) } : null,
  };
}

export type LeadView = "mine" | "added" | "branch" | "all" | "needs_owner" | "needs_branch";
export type LeadStageFilter = "open" | "won" | "lost" | LeadStage;

/** Which list views this actor may use. */
export function leadViewsFor(actor: Actor): LeadView[] {
  const scope = scopeOf(actor, "marketing.read");
  const assign = scopeOf(actor, "marketing.assign");
  const views: LeadView[] = [];
  // Only people who work leads can own them.
  if (scope && actor.permissions.has("marketing.work")) views.push("mine");
  const routes = can(actor, "lead.route");
  views.push("added");
  if (scope === "branch") views.push("branch");
  if (scope === "all" || routes) views.push("all");
  if (assign === "branch" || assign === "all" || routes) views.push("needs_owner");
  if (assign === "all" || routes) views.push("needs_branch");
  return views;
}

/** Where a person lands: the company overview for the CEO, otherwise their own leads, else their branch's. */
export function defaultLeadView(actor: Actor): LeadView {
  const views = leadViewsFor(actor);
  if (views.includes("all")) return "all";
  if (views.includes("mine")) return "mine";
  if (views.includes("branch")) return "branch";
  return views[0]!;
}

export async function listLeads(
  ctx: Pick<Ctx, "db" | "actor">,
  options: { view: LeadView; stage?: LeadStageFilter; branchId?: string | null; query?: string },
): Promise<LeadListItem[]> {
  if (!leadViewsFor(ctx.actor).includes(options.view)) throw new ForbiddenError();
  const conditions: Array<SQL | undefined> = [leadVisibility(ctx.actor)];
  switch (options.view) {
    case "mine":
      conditions.push(eq(leads.ownerId, ctx.actor.id));
      break;
    case "added":
      conditions.push(eq(leads.capturedBy, ctx.actor.id));
      break;
    case "branch":
      conditions.push(eq(leads.branchId, ctx.actor.branchId!));
      break;
    case "needs_owner":
      conditions.push(isNull(leads.ownerId), sql`${leads.branchId} is not null`);
      if (scopeOf(ctx.actor, "marketing.assign") === "branch") conditions.push(eq(leads.branchId, ctx.actor.branchId!));
      break;
    case "needs_branch":
      conditions.push(isNull(leads.branchId));
      break;
  }
  if (options.branchId && options.view === "all") conditions.push(eq(leads.branchId, options.branchId));
  const stage = options.stage ?? "open";
  if (stage === "open") conditions.push(inArray(leads.stage, [...OPEN_LEAD_STAGES]));
  else conditions.push(eq(leads.stage, stage));
  if (options.query?.trim()) {
    conditions.push(sql`${companies.name} ilike ${`%${options.query.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`}`);
  }

  const rows = await selectLeads(ctx.db)
    .where(and(...conditions))
    .orderBy(desc(leads.updatedAt))
    .limit(300);
  return rows.map(toListItem);
}

/** Open leads owned by me in stage "new" — the "New leads" count on Home. */
export async function countMyNewLeads(ctx: Pick<Ctx, "db" | "actor">): Promise<number> {
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(and(eq(leads.ownerId, ctx.actor.id), eq(leads.stage, "new")));
  return row?.n ?? 0;
}

/** Open leads waiting for an owner (in the branches I assign for) or for a branch (company-wide). */
export async function leadsAwaitingAssignment(
  ctx: Pick<Ctx, "db" | "actor">,
  options: { branchId?: string | null } = {},
): Promise<{ needsOwner: LeadListItem[]; needsBranch: LeadListItem[] }> {
  const assign = scopeOf(ctx.actor, "marketing.assign");
  const routes = can(ctx.actor, "lead.route");
  if ((!assign || assign === "own") && !routes) return { needsOwner: [], needsBranch: [] };
  const needsOwner = await listLeads(ctx, { view: "needs_owner", stage: "open" });
  const filtered = options.branchId ? needsOwner.filter((lead) => lead.branchId === options.branchId) : needsOwner;
  const needsBranch = assign === "all" || routes ? await listLeads(ctx, { view: "needs_branch", stage: "open" }) : [];
  return { needsOwner: filtered, needsBranch };
}

export type LeadDetail = LeadListItem & {
  contactId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  contactDesignation: string | null;
  companyPhone: string | null;
  companyIndustry: string | null;
  companyAddress: string | null;
  captureMethod: CaptureMethod;
  stageChangedAt: Date;
  wonAt: Date | null;
  lostAt: Date | null;
  lostReason: string | null;
};

/** One lead, or null if it doesn't exist or is outside the actor's scope. */
export async function getLead(ctx: Pick<Ctx, "db" | "actor">, leadId: string): Promise<LeadDetail | null> {
  if (!UUID.test(leadId)) return null;
  const [row] = await ctx.db
    .select({
      ...listColumns,
      contactId: leads.contactId,
      contactName: contacts.name,
      contactPhone: contacts.phone,
      contactEmail: contacts.email,
      contactDesignation: contacts.designation,
      companyPhone: companies.phone,
      companyIndustry: companies.industry,
      companyAddress: companies.addressLine,
      captureMethod: leads.captureMethod,
      stageChangedAt: leads.stageChangedAt,
      wonAt: leads.wonAt,
      lostAt: leads.lostAt,
      lostReason: leads.lostReason,
    })
    .from(leads)
    .innerJoin(companies, eq(companies.id, leads.companyId))
    .leftJoin(branches, eq(branches.id, leads.branchId))
    .leftJoin(owner, eq(owner.id, leads.ownerId))
    .innerJoin(capturer, eq(capturer.id, leads.capturedBy))
    .leftJoin(contacts, eq(contacts.id, leads.contactId))
    .where(and(eq(leads.id, leadId), leadVisibility(ctx.actor)))
    .limit(1);
  if (!row) return null;
  const { nextFollowUp: next, ...rest } = row;
  return {
    ...rest,
    nextFollowUp: next ? { id: next.id, dueDate: next.due_date, dueTime: toHourMinute(next.due_time) } : null,
  };
}

export type RequirementItem = {
  id: string;
  description: string;
  quantity: number | null;
  scopeEntryId: string | null;
  scope: {
    measurandOrInstrument: string;
    rangeText: string;
    cmcText: string;
    facilityType: "permanent" | "site";
    groupLabel: string;
    certificateNumber: string;
    branchName: string | null;
  } | null;
  status: ScopeStatus;
};

/** Requirements of a (visible) lead with their accreditation status at the lead's branch. */
export async function getLeadRequirements(
  ctx: Pick<Ctx, "db" | "actor" | "now">,
  lead: Pick<LeadDetail, "id" | "branchId">,
): Promise<RequirementItem[]> {
  // The lead's visibility is re-checked here, so these rows can't be read by passing another ID.
  const rows = await ctx.db
    .select({
      id: leadRequirements.id,
      description: leadRequirements.description,
      quantity: leadRequirements.quantity,
      scopeEntryId: leadRequirements.scopeEntryId,
    })
    .from(leadRequirements)
    .innerJoin(leads, eq(leads.id, leadRequirements.leadId))
    .where(and(eq(leadRequirements.leadId, lead.id), leadVisibility(ctx.actor)))
    .orderBy(asc(leadRequirements.createdAt));
  const entries = await getScopeEntries(
    ctx.db,
    rows.map((row) => row.scopeEntryId).filter((id): id is string => Boolean(id)),
  );
  const today = companyToday(ctx.now);
  return rows.map((row) => {
    const entry = row.scopeEntryId ? (entries.get(row.scopeEntryId) ?? null) : null;
    return {
      id: row.id,
      description: row.description,
      quantity: row.quantity,
      scopeEntryId: row.scopeEntryId,
      scope: entry
        ? {
            measurandOrInstrument: entry.measurandOrInstrument,
            rangeText: entry.rangeText,
            cmcText: entry.cmcText,
            facilityType: entry.facilityType,
            groupLabel: entry.groupLabel,
            certificateNumber: entry.certificateNumber,
            branchName: entry.branchName,
          }
        : null,
      status: scopeStatus(entry, lead.branchId, today),
    };
  });
}

export type QuotationItem = {
  id: string;
  number: number;
  status: QuotationStatus;
  totalPaise: number;
  validUntil: string | null;
  notes: string | null;
  sentAt: Date | null;
  decidedAt: Date | null;
  createdAt: Date;
  createdByName: string;
  lines: { id: string; description: string; quantity: number; unitPricePaise: number; amountPaise: number; scopeEntryId: string | null }[];
};

/** Quotations of a (visible) lead, newest first. */
export async function getLeadQuotations(ctx: Pick<Ctx, "db" | "actor">, leadId: string): Promise<QuotationItem[]> {
  const creator = alias(users, "quotation_creator");
  const rows = await ctx.db
    .select({
      id: quotations.id,
      number: quotations.number,
      status: quotations.status,
      totalPaise: quotations.totalPaise,
      validUntil: quotations.validUntil,
      notes: quotations.notes,
      sentAt: quotations.sentAt,
      decidedAt: quotations.decidedAt,
      createdAt: quotations.createdAt,
      createdByName: creator.name,
    })
    .from(quotations)
    .innerJoin(creator, eq(creator.id, quotations.createdBy))
    .innerJoin(leads, eq(leads.id, quotations.leadId))
    .where(and(eq(quotations.leadId, leadId), leadVisibility(ctx.actor)))
    .orderBy(desc(quotations.createdAt));
  if (rows.length === 0) return [];
  const lines = await ctx.db
    .select()
    .from(quotationLines)
    .where(
      inArray(
        quotationLines.quotationId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(quotationLines.position));
  return rows.map((row) => ({
    ...row,
    lines: lines
      .filter((line) => line.quotationId === row.id)
      .map(({ id, description, quantity, unitPricePaise, amountPaise, scopeEntryId }) => ({
        id,
        description,
        quantity,
        unitPricePaise,
        amountPaise,
        scopeEntryId,
      })),
  }));
}

export type ActivityItem = {
  id: string;
  kind: ActivityKind;
  callOutcome: CallOutcome | null;
  body: string | null;
  meta: Record<string, unknown> | null;
  actorName: string;
  leadId: string | null;
  leadNumber: number | null;
  branchName: string | null;
  occurredAt: Date;
};

/** History for a lead or a company, limited to what the actor may see. */
export async function listActivities(
  ctx: Pick<Ctx, "db" | "actor">,
  filter: { leadId: string } | { companyId: string },
  options: { limit?: number } = {},
): Promise<ActivityItem[]> {
  const actor = alias(users, "activity_actor");
  return ctx.db
    .select({
      id: activities.id,
      kind: activities.kind,
      callOutcome: activities.callOutcome,
      body: activities.body,
      meta: activities.meta,
      actorName: actor.name,
      leadId: activities.leadId,
      leadNumber: leads.number,
      branchName: branches.name,
      occurredAt: activities.occurredAt,
    })
    .from(activities)
    .innerJoin(actor, eq(actor.id, activities.actorId))
    .leftJoin(leads, eq(leads.id, activities.leadId))
    .leftJoin(branches, eq(branches.id, activities.branchId))
    .where(
      and(
        "leadId" in filter ? eq(activities.leadId, filter.leadId) : eq(activities.companyId, filter.companyId),
        activityVisibility(ctx.actor),
      ),
    )
    .orderBy(desc(activities.seq))
    .limit(options.limit ?? 100);
}

export type MarketerOption = { id: string; name: string; isManager: boolean };

/** Active people in a branch who can own leads (their roles grant marketing.work). */
export async function listMarketers(ctx: Pick<Ctx, "db" | "actor">, branchId: string): Promise<MarketerOption[]> {
  const assign = scopeOf(ctx.actor, "marketing.assign");
  if (!(assign === "all" || (assign === "branch" && ctx.actor.branchId === branchId) || can(ctx.actor, "lead.route"))) {
    requirePermission(ctx.actor, "marketing.assign.all");
  }
  const rows = await ctx.db
    .selectDistinct({
      id: users.id,
      name: users.name,
      isManager: sql<boolean>`exists (select 1 from ${userRoles} ur2 join ${rolePermissions} rp2 on rp2.role_id = ur2.role_id
                                      where ur2.user_id = ${outerId(users)} and rp2.permission_key in ('marketing.assign.branch', 'marketing.assign.all'))`,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, userRoles.roleId))
    .where(and(eq(users.status, "active"), eq(users.branchId, branchId), eq(rolePermissions.permissionKey, "marketing.work")))
    .orderBy(asc(users.name));
  return rows;
}

/** Open leads of a company the actor can see (customer page). */
export async function listCompanyLeads(
  ctx: Pick<Ctx, "db" | "actor">,
  companyId: string,
  options: { includeClosed?: boolean } = {},
): Promise<LeadListItem[]> {
  const rows = await selectLeads(ctx.db)
    .where(
      and(
        eq(leads.companyId, companyId),
        leadVisibility(ctx.actor),
        options.includeClosed ? undefined : inArray(leads.stage, [...OPEN_LEAD_STAGES]),
      ),
    )
    .orderBy(desc(leads.updatedAt))
    .limit(50);
  return rows.map(toListItem);
}
