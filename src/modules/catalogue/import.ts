import "server-only";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { writeAudit } from "@/server/audit";
import type { Database, Transaction } from "@/server/db/client";
import {
  accreditations,
  branches,
  scopeDisciplines,
  scopeDocuments,
  scopeEntries,
  scopeGroups,
} from "@/server/db/schema";
import { compact, scopeLabel, searchTextOf, splitDisciplineGroup } from "./normalize";

/**
 * Imports PTCC's accredited scope from the controlled reference file
 * (data/scope/ptcc-nabl-scope.json, produced by tools/scope-parser) — docs/SERVICE_CATALOGUE.md.
 *
 * - Strictly validated; refuses files the parser flagged with anomalies.
 * - Idempotent: a source document (by SHA-256) is imported once.
 * - Versioned: when a newer document contains a certificate, that certificate's previous rows
 *   are marked not current (kept, because leads and quotations may reference them).
 * - Branch links come only from data/scope/branches.json (confirmed by PTCC). A certificate
 *   without a confirmed branch is imported with its branch marked "needs verification".
 */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const text = z.string().trim().min(1);

export const scopeFileSchema = z.object({
  format: z.literal("ptcc-scope/v1"),
  generator: text,
  generatedAt: text,
  sources: z
    .array(z.object({ kind: z.enum(["scope", "certificates"]), fileName: text, sha256: z.string().regex(/^[0-9a-f]{64}$/) }))
    .min(1),
  accreditations: z
    .array(
      z.object({
        certificateNumber: z.string().regex(/^CC-\d+$/),
        accreditationBody: text,
        standard: z.string().nullable().optional(),
        field: z.string().nullable().optional(),
        legalEntity: z.string().nullable().optional(),
        facilityAddress: z.string().nullable().optional(),
        issueDate: isoDate.nullable().optional(),
        validFrom: isoDate.nullable(),
        validUntil: isoDate.nullable(),
        lastAmendedOn: isoDate.nullable(),
      }),
    )
    .min(1),
  entries: z
    .array(
      z.object({
        certificateNumber: z.string().regex(/^CC-\d+$/),
        facilityType: z.enum(["permanent", "site"]),
        serialNumber: z.string().regex(/^\d+$/),
        disciplineGroup: text,
        measurandOrInstrument: text,
        method: text,
        range: text,
        cmc: text,
        pdfPage: z.number().int().positive(),
        annexurePage: z.number().int().positive().nullable(),
        raw: z.array(z.string().nullable()).length(6),
      }),
    )
    .min(1),
  anomalies: z.array(z.unknown()).max(0, "The parser reported anomalies — resolve them before importing."),
});
export type ScopeFile = z.infer<typeof scopeFileSchema>;

export const branchMapSchema = z.object({
  note: z.string(),
  branches: z.array(
    z.object({ certificateNumber: z.string().regex(/^CC-\d+$/), branchName: text, city: text, state: text }),
  ),
});
export type BranchMap = z.infer<typeof branchMapSchema>;

export type ScopeImportResult = {
  document: "imported" | "unchanged";
  accreditations: number;
  entriesImported: number;
  entriesRetired: number;
  branchesCreated: string[];
  branchesLinked: string[];
  needsVerification: string[];
};

export async function importScope(
  db: Database,
  input: { scope: unknown; branchMap: unknown; importedBy?: string | null },
): Promise<ScopeImportResult> {
  const file = scopeFileSchema.parse(input.scope);
  const map = branchMapSchema.parse(input.branchMap);

  // Split every Discipline/Group up front — an unrecognised value stops the import.
  const unknown = new Set<string>();
  const split = new Map<string, { discipline: string; group: string }>();
  for (const entry of file.entries) {
    const parts = splitDisciplineGroup(entry.disciplineGroup);
    if (parts) split.set(entry.disciplineGroup, parts);
    else unknown.add(entry.disciplineGroup);
  }
  if (unknown.size > 0) {
    throw new Error(`Unrecognised discipline/group values — check the scope document: ${[...unknown].join(" | ")}`);
  }
  const certificates = new Set(file.accreditations.map((a) => a.certificateNumber));
  for (const entry of file.entries) {
    if (!certificates.has(entry.certificateNumber)) {
      throw new Error(`Entry refers to certificate ${entry.certificateNumber}, which the file does not describe.`);
    }
  }

  return db.transaction(async (tx) => {
    const result: ScopeImportResult = {
      document: "imported",
      accreditations: 0,
      entriesImported: 0,
      entriesRetired: 0,
      branchesCreated: [],
      branchesLinked: [],
      needsVerification: [],
    };

    // Source documents
    const documentIds = new Map<string, string>();
    let scopeDocumentIsNew = false;
    for (const source of file.sources) {
      const [existing] = await tx
        .select({ id: scopeDocuments.id })
        .from(scopeDocuments)
        .where(eq(scopeDocuments.sha256, source.sha256))
        .limit(1);
      if (existing) {
        documentIds.set(source.kind, existing.id);
        continue;
      }
      const [created] = await tx
        .insert(scopeDocuments)
        .values({
          kind: source.kind,
          fileName: source.fileName,
          sha256: source.sha256,
          generator: file.generator,
          importedBy: input.importedBy ?? null,
        })
        .returning({ id: scopeDocuments.id });
      documentIds.set(source.kind, created!.id);
      if (source.kind === "scope") scopeDocumentIsNew = true;
    }
    const scopeDocumentId = documentIds.get("scope");
    if (!scopeDocumentId) throw new Error("The file does not name its scope source document.");
    if (!scopeDocumentIsNew) result.document = "unchanged";

    // Accreditations and their (confirmed) branches
    const accreditationIds = new Map<string, string>();
    for (const accreditation of file.accreditations) {
      const link = map.branches.find((b) => b.certificateNumber === accreditation.certificateNumber);
      const branchId = link ? await ensureBranch(tx, link, accreditation.facilityAddress ?? null, result) : null;
      if (!link) result.needsVerification.push(accreditation.certificateNumber);

      const values = {
        certificateNumber: accreditation.certificateNumber,
        branchId,
        branchLinkStatus: link ? ("confirmed" as const) : ("needs_verification" as const),
        accreditationBody: accreditation.accreditationBody,
        standard: accreditation.standard ?? null,
        field: accreditation.field ?? null,
        legalEntity: accreditation.legalEntity ?? null,
        facilityAddress: accreditation.facilityAddress ?? null,
        issueDate: accreditation.issueDate ?? null,
        validFrom: accreditation.validFrom,
        validUntil: accreditation.validUntil,
        lastAmendedOn: accreditation.lastAmendedOn,
        ...(scopeDocumentIsNew ? { scopeDocumentId } : {}),
      };
      const [row] = await tx
        .insert(accreditations)
        .values({ ...values, scopeDocumentId })
        .onConflictDoUpdate({ target: accreditations.certificateNumber, set: values })
        .returning({ id: accreditations.id });
      accreditationIds.set(accreditation.certificateNumber, row!.id);
      result.accreditations += 1;
    }

    if (!scopeDocumentIsNew) return result;

    // Disciplines and groups (labels derived; names stored as printed)
    const groupIds = new Map<string, string>();
    for (const { discipline, group } of split.values()) {
      const key = `${discipline}\u0000${group}`;
      if (groupIds.has(key)) continue;
      const [disciplineRow] = await tx
        .insert(scopeDisciplines)
        .values({ name: discipline, label: scopeLabel(discipline) })
        .onConflictDoUpdate({ target: scopeDisciplines.name, set: { label: scopeLabel(discipline) } })
        .returning({ id: scopeDisciplines.id });
      const [groupRow] = await tx
        .insert(scopeGroups)
        .values({ disciplineId: disciplineRow!.id, name: group, label: scopeLabel(group) })
        .onConflictDoUpdate({ target: [scopeGroups.disciplineId, scopeGroups.name], set: { label: scopeLabel(group) } })
        .returning({ id: scopeGroups.id });
      groupIds.set(key, groupRow!.id);
    }

    // Retire rows of earlier documents for the certificates this file covers
    for (const accreditationId of accreditationIds.values()) {
      const retired = await tx
        .update(scopeEntries)
        .set({ isCurrent: false })
        .where(
          and(
            eq(scopeEntries.accreditationId, accreditationId),
            eq(scopeEntries.isCurrent, true),
            ne(scopeEntries.scopeDocumentId, scopeDocumentId),
          ),
        )
        .returning({ id: scopeEntries.id });
      result.entriesRetired += retired.length;
    }

    // Insert this document's rows
    const rows = file.entries.map((entry) => {
      const parts = split.get(entry.disciplineGroup)!;
      const searchText = searchTextOf([
        scopeLabel(parts.discipline),
        scopeLabel(parts.group),
        entry.measurandOrInstrument,
        entry.method,
        entry.range,
      ]);
      return {
        accreditationId: accreditationIds.get(entry.certificateNumber)!,
        scopeDocumentId,
        groupId: groupIds.get(`${parts.discipline}\u0000${parts.group}`)!,
        facilityType: entry.facilityType,
        serialNumber: Number(entry.serialNumber),
        measurandOrInstrument: entry.measurandOrInstrument,
        method: entry.method,
        rangeText: entry.range,
        cmcText: entry.cmc,
        pdfPage: entry.pdfPage,
        annexurePage: entry.annexurePage,
        raw: entry.raw,
        searchText,
        searchCompact: compact(searchText),
      };
    });
    for (let i = 0; i < rows.length; i += 200) {
      await tx.insert(scopeEntries).values(rows.slice(i, i + 200));
    }
    result.entriesImported = rows.length;

    const scopeSource = file.sources.find((source) => source.kind === "scope")!;
    await writeAudit(tx, {
      actorId: input.importedBy ?? null,
      action: "scope.import",
      entityType: "scope_document",
      entityId: scopeDocumentId,
      summary: `Imported ${rows.length} scope rows for ${[...accreditationIds.keys()].join(", ")} from “${scopeSource.fileName}”${
        result.entriesRetired ? ` (${result.entriesRetired} earlier rows superseded)` : ""
      }${result.needsVerification.length ? `; branch needs verification for ${result.needsVerification.join(", ")}` : ""}`,
    });
    return result;
  });
}

async function ensureBranch(
  tx: Transaction,
  link: BranchMap["branches"][number],
  facilityAddress: string | null,
  result: ScopeImportResult,
): Promise<string> {
  const [existing] = await tx
    .select({ id: branches.id, verification: branches.verification })
    .from(branches)
    .where(sql`lower(${branches.name}) = lower(${link.branchName})`)
    .limit(1);
  if (existing) {
    if (existing.verification !== "verified") {
      await tx.update(branches).set({ verification: "verified" }).where(eq(branches.id, existing.id));
    }
    result.branchesLinked.push(link.branchName);
    return existing.id;
  }
  const [created] = await tx
    .insert(branches)
    .values({
      name: link.branchName,
      city: link.city,
      state: link.state,
      addressLine: facilityAddress,
      verification: "verified",
      notes: `Accredited facility per NABL certificate ${link.certificateNumber}.`,
    })
    .returning({ id: branches.id });
  result.branchesCreated.push(link.branchName);
  return created!.id;
}
