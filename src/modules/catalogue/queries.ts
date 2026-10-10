import "server-only";
import { and, asc, count, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { requirePermission } from "@/server/access/actor";
import type { Ctx } from "@/server/context";
import { outerId } from "@/server/db/sql";
import type { Executor } from "@/server/db/client";
import {
  accreditations,
  branches,
  scopeDisciplines,
  scopeDocuments,
  scopeEntries,
  scopeGroups,
  users,
  type FacilityType,
} from "@/server/db/schema";
import { compact, queryTokens } from "./normalize";

/**
 * Reads of PTCC's accredited scope. Results always carry the certificate, branch and
 * facility type, because availability is branch-specific — no branch is assumed to be able
 * to do everything.
 */

export type ScopeEntryView = {
  id: string;
  measurandOrInstrument: string;
  method: string;
  rangeText: string;
  cmcText: string;
  facilityType: FacilityType;
  groupLabel: string;
  disciplineLabel: string;
  certificateNumber: string;
  validUntil: string | null;
  branchId: string | null;
  branchName: string | null;
  isCurrent: boolean;
  pdfPage: number;
};

const entryColumns = {
  id: scopeEntries.id,
  measurandOrInstrument: scopeEntries.measurandOrInstrument,
  method: scopeEntries.method,
  rangeText: scopeEntries.rangeText,
  cmcText: scopeEntries.cmcText,
  facilityType: scopeEntries.facilityType,
  groupLabel: scopeGroups.label,
  disciplineLabel: scopeDisciplines.label,
  certificateNumber: accreditations.certificateNumber,
  validUntil: accreditations.validUntil,
  branchId: accreditations.branchId,
  branchName: branches.name,
  isCurrent: scopeEntries.isCurrent,
  pdfPage: scopeEntries.pdfPage,
};

function selectEntries(db: Executor) {
  return db
    .select(entryColumns)
    .from(scopeEntries)
    .innerJoin(scopeGroups, eq(scopeGroups.id, scopeEntries.groupId))
    .innerJoin(scopeDisciplines, eq(scopeDisciplines.id, scopeGroups.disciplineId))
    .innerJoin(accreditations, eq(accreditations.id, scopeEntries.accreditationId))
    .leftJoin(branches, eq(branches.id, accreditations.branchId));
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export type ScopeSearchGroup = {
  instrument: string;
  groupLabel: string;
  disciplineLabel: string;
  entries: ScopeEntryView[];
};

export type ScopeSearchResult = {
  query: string;
  groups: ScopeSearchGroup[];
  matchedEntries: number;
};

/**
 * Searches current scope rows. Every word must match (instrument, method, group, discipline
 * or range). Results are grouped by instrument description and ranked so that matches in the
 * instrument text come first.
 */
export async function searchScope(
  ctx: Pick<Ctx, "db" | "actor">,
  options: { query: string; branchId?: string | null; limitGroups?: number },
): Promise<ScopeSearchResult> {
  requirePermission(ctx.actor, "catalogue.read");
  const tokens = queryTokens(options.query);
  if (tokens.length === 0) return { query: options.query, groups: [], matchedEntries: 0 };

  const conditions: SQL[] = [eq(scopeEntries.isCurrent, true)];
  for (const variants of tokens) {
    const alternatives = variants.flatMap((token) => [
      sql`${scopeEntries.searchText} like ${`%${escapeLike(token)}%`}`,
      sql`${scopeEntries.searchCompact} like ${`%${escapeLike(compact(token))}%`}`,
    ]);
    conditions.push(or(...alternatives)!);
  }
  if (options.branchId) conditions.push(eq(accreditations.branchId, options.branchId));

  const rows = await selectEntries(ctx.db)
    .where(and(...conditions))
    .orderBy(asc(branches.name), asc(scopeEntries.facilityType), asc(scopeEntries.serialNumber))
    .limit(400);

  const groups = new Map<string, ScopeSearchGroup & { score: number }>();
  for (const row of rows) {
    const key = `${row.groupLabel}\u0000${row.measurandOrInstrument}`;
    let group = groups.get(key);
    if (!group) {
      const instrument = row.measurandOrInstrument.toLowerCase();
      const instrumentCompact = compact(instrument);
      const score = tokens.reduce(
        (sum, variants) =>
          sum + (variants.some((t) => instrument.includes(t) || instrumentCompact.includes(compact(t))) ? 2 : 0),
        0,
      );
      group = {
        instrument: row.measurandOrInstrument,
        groupLabel: row.groupLabel,
        disciplineLabel: row.disciplineLabel,
        entries: [],
        score,
      };
      groups.set(key, group);
    }
    group.entries.push(row);
  }
  const ranked = [...groups.values()]
    .sort((a, b) => b.score - a.score || a.instrument.length - b.instrument.length)
    .slice(0, options.limitGroups ?? 12)
    .map(({ instrument, groupLabel, disciplineLabel, entries }) => ({ instrument, groupLabel, disciplineLabel, entries }));
  return { query: options.query, groups: ranked, matchedEntries: rows.length };
}

/** Scope rows by id (for requirement and quotation status), regardless of current version. */
export async function getScopeEntries(db: Executor, ids: readonly string[]): Promise<Map<string, ScopeEntryView>> {
  if (ids.length === 0) return new Map();
  const rows = await selectEntries(db).where(inArray(scopeEntries.id, [...new Set(ids)]));
  return new Map(rows.map((row) => [row.id, row]));
}

export type AccreditationView = {
  id: string;
  certificateNumber: string;
  accreditationBody: string;
  standard: string | null;
  field: string | null;
  facilityAddress: string | null;
  issueDate: string | null;
  validFrom: string | null;
  validUntil: string | null;
  lastAmendedOn: string | null;
  branchId: string | null;
  branchName: string | null;
  branchLinkStatus: "confirmed" | "needs_verification";
  currentEntries: number;
  permanentEntries: number;
  siteEntries: number;
  sourceFile: string | null;
  sourceSha256: string | null;
};

/** Accreditation certificates with their branch and scope size. */
export async function listAccreditations(ctx: Pick<Ctx, "db" | "actor">): Promise<AccreditationView[]> {
  requirePermission(ctx.actor, "catalogue.read");
  const rows = await ctx.db
    .select({
      id: accreditations.id,
      certificateNumber: accreditations.certificateNumber,
      accreditationBody: accreditations.accreditationBody,
      standard: accreditations.standard,
      field: accreditations.field,
      facilityAddress: accreditations.facilityAddress,
      issueDate: accreditations.issueDate,
      validFrom: accreditations.validFrom,
      validUntil: accreditations.validUntil,
      lastAmendedOn: accreditations.lastAmendedOn,
      branchId: accreditations.branchId,
      branchName: branches.name,
      branchLinkStatus: accreditations.branchLinkStatus,
      sourceFile: scopeDocuments.fileName,
      sourceSha256: scopeDocuments.sha256,
      currentEntries: sql<number>`(select count(*)::int from ${scopeEntries} e where e.accreditation_id = ${outerId(accreditations)} and e.is_current)`,
      permanentEntries: sql<number>`(select count(*)::int from ${scopeEntries} e where e.accreditation_id = ${outerId(accreditations)} and e.is_current and e.facility_type = 'permanent')`,
      siteEntries: sql<number>`(select count(*)::int from ${scopeEntries} e where e.accreditation_id = ${outerId(accreditations)} and e.is_current and e.facility_type = 'site')`,
    })
    .from(accreditations)
    .leftJoin(branches, eq(branches.id, accreditations.branchId))
    .leftJoin(scopeDocuments, eq(scopeDocuments.id, accreditations.scopeDocumentId))
    .orderBy(asc(branches.name), asc(accreditations.certificateNumber));
  return rows;
}

export type ScopeOverviewGroup = {
  groupId: string;
  groupLabel: string;
  disciplineLabel: string;
  /** Current entries per branch name ("Needs verification" when the certificate's branch is unconfirmed). */
  byBranch: Record<string, number>;
};

/** Disciplines and groups with how many scope rows each branch has — for browsing. */
export async function scopeOverview(ctx: Pick<Ctx, "db" | "actor">): Promise<ScopeOverviewGroup[]> {
  requirePermission(ctx.actor, "catalogue.read");
  const rows = await ctx.db
    .select({
      groupId: scopeGroups.id,
      groupLabel: scopeGroups.label,
      disciplineLabel: scopeDisciplines.label,
      branchName: branches.name,
      n: count(),
    })
    .from(scopeEntries)
    .innerJoin(scopeGroups, eq(scopeGroups.id, scopeEntries.groupId))
    .innerJoin(scopeDisciplines, eq(scopeDisciplines.id, scopeGroups.disciplineId))
    .innerJoin(accreditations, eq(accreditations.id, scopeEntries.accreditationId))
    .leftJoin(branches, eq(branches.id, accreditations.branchId))
    .where(eq(scopeEntries.isCurrent, true))
    .groupBy(scopeGroups.id, scopeGroups.label, scopeDisciplines.label, branches.name)
    .orderBy(asc(scopeDisciplines.label), asc(scopeGroups.label));
  const groups = new Map<string, ScopeOverviewGroup>();
  for (const row of rows) {
    const group = groups.get(row.groupId) ?? {
      groupId: row.groupId,
      groupLabel: row.groupLabel,
      disciplineLabel: row.disciplineLabel,
      byBranch: {},
    };
    group.byBranch[row.branchName ?? "Needs verification"] = Number(row.n);
    groups.set(row.groupId, group);
  }
  return [...groups.values()];
}

/** Rows of one group (browsing), current only. */
export async function listGroupEntries(ctx: Pick<Ctx, "db" | "actor">, groupId: string): Promise<ScopeEntryView[]> {
  requirePermission(ctx.actor, "catalogue.read");
  if (!/^[0-9a-f-]{36}$/i.test(groupId)) return [];
  return selectEntries(ctx.db)
    .where(and(eq(scopeEntries.groupId, groupId), eq(scopeEntries.isCurrent, true)))
    .orderBy(asc(branches.name), asc(scopeEntries.facilityType), asc(scopeEntries.serialNumber));
}

export type ScopeDocumentView = {
  id: string;
  kind: "scope" | "certificates";
  fileName: string;
  sha256: string;
  generator: string;
  importedAt: Date;
  importedByName: string | null;
  currentEntries: number;
  retiredEntries: number;
};

/** Every imported source document, newest first, with how many of its rows are still current. */
export async function listScopeDocuments(ctx: Pick<Ctx, "db" | "actor">): Promise<ScopeDocumentView[]> {
  requirePermission(ctx.actor, "catalogue.manage");
  return ctx.db
    .select({
      id: scopeDocuments.id,
      kind: scopeDocuments.kind,
      fileName: scopeDocuments.fileName,
      sha256: scopeDocuments.sha256,
      generator: scopeDocuments.generator,
      importedAt: scopeDocuments.importedAt,
      importedByName: users.name,
      currentEntries: sql<number>`(select count(*)::int from ${scopeEntries} e where e.scope_document_id = ${outerId(scopeDocuments)} and e.is_current)`,
      retiredEntries: sql<number>`(select count(*)::int from ${scopeEntries} e where e.scope_document_id = ${outerId(scopeDocuments)} and not e.is_current)`,
    })
    .from(scopeDocuments)
    .leftJoin(users, eq(users.id, scopeDocuments.importedBy))
    .orderBy(desc(scopeDocuments.importedAt), asc(scopeDocuments.kind));
}
