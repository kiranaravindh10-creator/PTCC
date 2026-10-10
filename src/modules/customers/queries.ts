import "server-only";
import { and, asc, desc, eq, inArray, isNull, notInArray, sql, type SQL } from "drizzle-orm";
import { can, canAny, type Actor } from "@/server/access/actor";
import type { Ctx } from "@/server/context";
import { outerId } from "@/server/db/sql";
import { branches, companies, companyBranches, contacts, leads, type CompanyRelationship } from "@/server/db/schema";
import { ForbiddenError } from "@/server/errors";
import { normalizeCompanyName } from "@/lib/company";
import { OPEN_LEAD_STAGES } from "@/modules/leads/model";
import { leadVisibility } from "@/modules/leads/queries";
import { companyVisibility } from "./visibility";

/**
 * Customer reads. One central record per company; the branch relationships shown are
 * limited to what the actor may see (their branch, or all branches for company-wide roles).
 */

function requireCustomerRead(actor: Actor) {
  if (!canAny(actor, "customer.read", "customer.read.all")) throw new ForbiddenError();
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export type BranchRelationship = {
  branchId: string;
  branchName: string;
  relationship: CompanyRelationship;
  becameCustomerAt: Date | null;
};

/** Relationship rows visible to the actor: own branch, or every branch with customer.read.all. */
function relationshipFilter(actor: Actor): SQL | undefined {
  if (can(actor, "customer.read.all")) return undefined;
  return actor.branchId ? eq(companyBranches.branchId, actor.branchId) : sql`false`;
}

export type CustomerListItem = {
  id: string;
  name: string;
  area: string | null;
  city: string | null;
  industry: string | null;
  relationships: BranchRelationship[];
  openLeads: number;
};

export async function listCustomers(
  ctx: Pick<Ctx, "db" | "actor">,
  options: { query?: string; relationship?: CompanyRelationship; branchId?: string | null } = {},
): Promise<CustomerListItem[]> {
  requireCustomerRead(ctx.actor);
  const conditions: Array<SQL | undefined> = [isNull(companies.archivedAt), companyVisibility(ctx.actor)];
  if (options.query?.trim()) {
    const query = options.query.trim();
    conditions.push(
      sql`(${companies.name} ilike ${`%${escapeLike(query)}%`} or ${companies.area} ilike ${`%${escapeLike(query)}%`}
           or ${companies.normalizedName} like ${`%${escapeLike(normalizeCompanyName(query))}%`})`,
    );
  }
  const branchScope = can(ctx.actor, "customer.read.all") ? (options.branchId ?? null) : ctx.actor.branchId;
  if (options.relationship || options.branchId) {
    conditions.push(
      sql`exists (select 1 from ${companyBranches} where ${companyBranches.companyId} = ${companies.id}
              ${branchScope ? sql`and ${companyBranches.branchId} = ${branchScope}` : sql``}
              ${options.relationship ? sql`and ${companyBranches.relationship} = ${options.relationship}` : sql``})`,
    );
  }
  const visibleLeads = leadVisibility(ctx.actor);
  const rows = await ctx.db
    .select({
      id: companies.id,
      name: companies.name,
      area: companies.area,
      city: companies.city,
      industry: companies.industry,
      openLeads: sql<number>`(select count(*)::int from ${leads} where ${leads.companyId} = ${outerId(companies)}
                              and ${inArray(leads.stage, [...OPEN_LEAD_STAGES])} and ${visibleLeads ?? sql`true`})`,
    })
    .from(companies)
    .where(and(...conditions))
    .orderBy(asc(companies.name))
    .limit(300);
  const relationships = await relationshipsFor(
    ctx,
    rows.map((row) => row.id),
  );
  return rows.map((row) => ({ ...row, relationships: relationships.get(row.id) ?? [] }));
}

async function relationshipsFor(ctx: Pick<Ctx, "db" | "actor">, companyIds: string[]) {
  const map = new Map<string, BranchRelationship[]>();
  if (companyIds.length === 0) return map;
  const rows = await ctx.db
    .select({
      companyId: companyBranches.companyId,
      branchId: companyBranches.branchId,
      branchName: branches.name,
      relationship: companyBranches.relationship,
      becameCustomerAt: companyBranches.becameCustomerAt,
    })
    .from(companyBranches)
    .innerJoin(branches, eq(branches.id, companyBranches.branchId))
    .where(and(inArray(companyBranches.companyId, companyIds), relationshipFilter(ctx.actor)))
    .orderBy(asc(branches.name));
  for (const { companyId, ...relationship } of rows) {
    map.set(companyId, [...(map.get(companyId) ?? []), relationship]);
  }
  return map;
}

export type CompanySuggestion = {
  id: string;
  name: string;
  area: string | null;
  city: string | null;
  /** Linked to the actor's branch (or visible to them) — otherwise an existing PTCC company to reuse. */
  known: boolean;
};

/**
 * Company suggestions while typing a name (lead and customer forms). Searches ALL companies,
 * so nobody creates a duplicate of a company another branch already has — but returns only
 * identity (name, area, city), never another branch's business with it.
 */
export async function suggestCompanies(ctx: Pick<Ctx, "db" | "actor">, query: string): Promise<CompanySuggestion[]> {
  if (!canAny(ctx.actor, "lead.capture", "customer.write", "task.create")) throw new ForbiddenError();
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const normalized = normalizeCompanyName(trimmed);
  // Every typed word must appear in the name, in any order: "abc eng" finds "ABC Engineering".
  const words = normalized.split(" ").filter(Boolean);
  if (words.length === 0) return [];
  const visible = companyVisibility(ctx.actor);
  return ctx.db
    .select({
      id: companies.id,
      name: companies.name,
      area: companies.area,
      city: companies.city,
      known: visible ? sql<boolean>`${visible}` : sql<boolean>`true`,
    })
    .from(companies)
    .where(
      and(
        isNull(companies.archivedAt),
        ...words.map((word) => sql`${companies.normalizedName} like ${`%${escapeLike(word)}%`}`),
      ),
    )
    .orderBy(sql`${companies.normalizedName} = ${normalized} desc`, asc(companies.name))
    .limit(8);
}

export type CustomerDetail = {
  id: string;
  name: string;
  industry: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  addressLine: string | null;
  area: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  latitude: string | null;
  longitude: string | null;
  notes: string | null;
  relationships: BranchRelationship[];
  contacts: { id: string; name: string; phone: string | null; email: string | null; designation: string | null; isPrimary: boolean }[];
};

/** A customer the actor may open, or null (not found or not visible). */
export async function getCustomer(ctx: Pick<Ctx, "db" | "actor">, companyId: string): Promise<CustomerDetail | null> {
  if (!/^[0-9a-f-]{36}$/i.test(companyId)) return null;
  const [company] = await ctx.db
    .select()
    .from(companies)
    .where(and(eq(companies.id, companyId), companyVisibility(ctx.actor)))
    .limit(1);
  if (!company) return null;
  const [relationships, contactRows] = await Promise.all([
    relationshipsFor(ctx, [company.id]),
    ctx.db
      .select({
        id: contacts.id,
        name: contacts.name,
        phone: contacts.phone,
        email: contacts.email,
        designation: contacts.designation,
        isPrimary: contacts.isPrimary,
      })
      .from(contacts)
      .where(eq(contacts.companyId, company.id))
      .orderBy(desc(contacts.isPrimary), asc(contacts.name)),
  ]);
  return {
    id: company.id,
    name: company.name,
    industry: company.industry,
    phone: company.phone,
    email: company.email,
    website: company.website,
    addressLine: company.addressLine,
    area: company.area,
    city: company.city,
    state: company.state,
    pincode: company.pincode,
    latitude: company.latitude,
    longitude: company.longitude,
    notes: company.notes,
    relationships: relationships.get(company.id) ?? [],
    contacts: contactRows,
  };
}

/** Branches a person may link customers to: their own, or any active branch (company-wide). */
export async function linkableBranches(ctx: Pick<Ctx, "db" | "actor">) {
  const rows = await ctx.db
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(
      and(
        eq(branches.status, "active"),
        can(ctx.actor, "customer.read.all") ? undefined : ctx.actor.branchId ? eq(branches.id, ctx.actor.branchId) : sql`false`,
      ),
    )
    .orderBy(asc(branches.name));
  return rows;
}

export type BranchOption = { id: string; name: string; verification: "verified" | "needs_verification" };

/** Active branches (for pickers and the CEO filter). */
export async function listActiveBranches(ctx: Pick<Ctx, "db">): Promise<BranchOption[]> {
  return ctx.db
    .select({ id: branches.id, name: branches.name, verification: branches.verification })
    .from(branches)
    .where(eq(branches.status, "active"))
    .orderBy(asc(branches.name));
}

/** Companies linked to no branch at all are invisible to branch staff — the CEO sees them here. */
export async function unlinkedCompanyCount(ctx: Pick<Ctx, "db" | "actor">): Promise<number> {
  if (!can(ctx.actor, "customer.read.all")) return 0;
  const [row] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(companies)
    .where(
      and(
        isNull(companies.archivedAt),
        notInArray(companies.id, ctx.db.select({ id: companyBranches.companyId }).from(companyBranches)),
      ),
    );
  return row?.n ?? 0;
}
