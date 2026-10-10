import { boolean, check, date, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, inList, updatedAt, userRef } from "./_columns";
import { branches, users } from "./identity";

/**
 * PTCC's accredited scope as controlled reference data — docs/SERVICE_CATALOGUE.md.
 * Imported from data/scope/ptcc-nabl-scope.json (generated from PTCC's NABL scope
 * documents). Never edited by hand in the application.
 */

export const SCOPE_SOURCE_KINDS = ["scope", "certificates"] as const;
export type ScopeSourceKind = (typeof SCOPE_SOURCE_KINDS)[number];

/** A source document an import was made from, identified by its SHA-256. */
export const scopeDocuments = pgTable(
  "scope_documents",
  {
    id: id(),
    kind: text().$type<ScopeSourceKind>().notNull(),
    fileName: text().notNull(),
    sha256: text().notNull(),
    generator: text().notNull(),
    importedAt: createdAt(),
    importedBy: userRef(() => users.id),
  },
  (t) => [
    uniqueIndex("scope_documents_sha256_unique").on(t.sha256),
    check("scope_documents_kind_check", inList(t.kind, SCOPE_SOURCE_KINDS)),
  ],
);

export const BRANCH_LINK_STATUSES = ["confirmed", "needs_verification"] as const;
export type BranchLinkStatus = (typeof BRANCH_LINK_STATUSES)[number];

/** An accreditation certificate (e.g. NABL CC-2467) and the branch facility it covers. */
export const accreditations = pgTable(
  "accreditations",
  {
    id: id(),
    certificateNumber: text().notNull(),
    /** The branch this certificate's facility belongs to. null until confirmed. */
    branchId: uuid().references(() => branches.id, { onDelete: "restrict" }),
    branchLinkStatus: text().$type<BranchLinkStatus>().notNull().default("needs_verification"),
    accreditationBody: text().notNull(),
    standard: text(),
    field: text(),
    legalEntity: text(),
    facilityAddress: text(),
    issueDate: date({ mode: "string" }),
    validFrom: date({ mode: "string" }),
    validUntil: date({ mode: "string" }),
    lastAmendedOn: date({ mode: "string" }),
    /** The scope document the current entries came from. */
    scopeDocumentId: uuid().references(() => scopeDocuments.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("accreditations_certificate_unique").on(t.certificateNumber),
    check("accreditations_branch_link_check", inList(t.branchLinkStatus, BRANCH_LINK_STATUSES)),
  ],
);

export const scopeDisciplines = pgTable(
  "scope_disciplines",
  {
    id: id(),
    /** As printed in the scope, e.g. "ELECTRO-TECHNICAL". */
    name: text().notNull(),
    /** Display label, e.g. "Electro-technical". */
    label: text().notNull(),
  },
  (t) => [uniqueIndex("scope_disciplines_name_unique").on(t.name)],
);

export const scopeGroups = pgTable(
  "scope_groups",
  {
    id: id(),
    disciplineId: uuid()
      .notNull()
      .references(() => scopeDisciplines.id, { onDelete: "restrict" }),
    /** As printed, e.g. "PRESSURE INDICATING DEVICES". */
    name: text().notNull(),
    label: text().notNull(),
  },
  (t) => [uniqueIndex("scope_groups_discipline_name_unique").on(t.disciplineId, t.name)],
);

export const FACILITY_TYPES = ["permanent", "site"] as const;
export type FacilityType = (typeof FACILITY_TYPES)[number];

/**
 * One row of an accreditation's scope: what can be calibrated, how, over what range and with
 * what CMC, at which facility type. Text is stored exactly as printed (line breaks joined).
 */
export const scopeEntries = pgTable(
  "scope_entries",
  {
    id: id(),
    accreditationId: uuid()
      .notNull()
      .references(() => accreditations.id, { onDelete: "restrict" }),
    scopeDocumentId: uuid()
      .notNull()
      .references(() => scopeDocuments.id, { onDelete: "restrict" }),
    groupId: uuid()
      .notNull()
      .references(() => scopeGroups.id, { onDelete: "restrict" }),
    facilityType: text().$type<FacilityType>().notNull(),
    /** "S.No" within the facility section of the annexure. */
    serialNumber: integer().notNull(),
    /** "Measurand or Reference Material / Type of instrument … / Quantity Measured / Instrument". */
    measurandOrInstrument: text().notNull(),
    /** "Calibration or Measurement Method or procedure". */
    method: text().notNull(),
    /** "Measurement range and additional parameters where applicable (Range and Frequency)". */
    rangeText: text().notNull(),
    /** "Calibration and Measurement Capability (CMC) (±)". */
    cmcText: text().notNull(),
    pdfPage: integer().notNull(),
    annexurePage: integer(),
    /** The six table cells exactly as extracted, for traceability. */
    raw: jsonb().$type<(string | null)[]>().notNull(),
    /** Lower-cased discipline + group + instrument + method, for search. */
    searchText: text().notNull(),
    /** searchText without spaces or punctuation — tolerant of wrapped words. */
    searchCompact: text().notNull(),
    /** false once a newer amendment of the scope has replaced this row. */
    isCurrent: boolean().notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("scope_entries_source_row_unique").on(t.scopeDocumentId, t.accreditationId, t.facilityType, t.serialNumber),
    index("scope_entries_accreditation_idx").on(t.accreditationId, t.isCurrent),
    index("scope_entries_group_idx").on(t.groupId),
    check("scope_entries_facility_check", inList(t.facilityType, FACILITY_TYPES)),
  ],
);
