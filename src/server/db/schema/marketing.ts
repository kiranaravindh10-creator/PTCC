import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import {
  ACTIVITY_KINDS,
  AI_CAPTURE_METHODS,
  CALL_OUTCOMES,
  CAPTURE_METHODS,
  CAPTURE_STATUSES,
  DETECTED_LANGUAGES,
  LEAD_SOURCES,
  LEAD_STAGES,
  QUOTATION_STATUSES,
  type ActivityKind,
  type AiCaptureMethod,
  type CallOutcome,
  type CaptureMethod,
  type CaptureStatus,
  type DetectedLanguage,
  type LeadSource,
  type LeadStage,
  type QuotationStatus,
} from "@/modules/leads/model";
import { createdAt, id, inList, updatedAt, userRef } from "./_columns";
import { scopeEntries } from "./catalogue";
import { companies, contacts } from "./customers";
import { branches, users } from "./identity";

/**
 * Marketing — docs/DATABASE_ARCHITECTURE.md §7. A lead is one sales opportunity with one
 * company. It belongs to a branch (null = "needs branch assignment"); a won lead is a deal.
 * The next follow-up is not a column: it is the earliest open follow-up task for the lead.
 */
export const leads = pgTable(
  "leads",
  {
    id: id(),
    /** Human reference: L-1001. */
    number: integer().notNull().generatedAlwaysAsIdentity({ startWith: 1001 }),
    /** null = the branch is not known yet ("Needs assignment"). Never guessed. */
    branchId: uuid().references(() => branches.id, { onDelete: "restrict" }),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    contactId: uuid().references(() => contacts.id, { onDelete: "restrict" }),
    /** What the customer needs, in their words: "Pressure gauge calibration, 12 nos". */
    requirement: text().notNull(),
    source: text().$type<LeadSource>().notNull().default("employee"),
    captureMethod: text().$type<CaptureMethod>().notNull().default("manual"),
    stage: text().$type<LeadStage>().notNull().default("new"),
    stageChangedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    /** The marketer responsible. null = waiting for the branch to assign someone. */
    ownerId: userRef(() => users.id),
    assignedBy: userRef(() => users.id),
    assignedAt: timestamp({ withTimezone: true }),
    /** Who found the lead (credit), whoever they are. */
    capturedBy: userRef(() => users.id).notNull(),
    wonValuePaise: bigint({ mode: "number" }),
    wonAt: timestamp({ withTimezone: true }),
    lostAt: timestamp({ withTimezone: true }),
    lostReason: text(),
    closedBy: userRef(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdBy: userRef(() => users.id).notNull(),
    updatedBy: userRef(() => users.id),
  },
  (t) => [
    index("leads_branch_stage_idx").on(t.branchId, t.stage),
    index("leads_owner_stage_idx").on(t.ownerId, t.stage),
    index("leads_company_idx").on(t.companyId),
    index("leads_captured_by_idx").on(t.capturedBy),
    check("leads_stage_check", inList(t.stage, LEAD_STAGES)),
    check("leads_source_check", inList(t.source, LEAD_SOURCES)),
    check("leads_capture_method_check", inList(t.captureMethod, CAPTURE_METHODS)),
    check("leads_won_check", sql`${t.stage} <> 'won' or ${t.wonAt} is not null`),
    check("leads_lost_check", sql`${t.stage} <> 'lost' or (${t.lostAt} is not null and ${t.lostReason} is not null)`),
    check("leads_won_value_check", sql`${t.wonValuePaise} is null or ${t.wonValuePaise} >= 0`),
  ],
);

/**
 * What the customer wants calibrated. Linked to a row of PTCC's accredited scope when one
 * was chosen; free text otherwise ("Scope not confirmed — verify with PTCC").
 */
export const leadRequirements = pgTable(
  "lead_requirements",
  {
    id: id(),
    leadId: uuid()
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    scopeEntryId: uuid().references(() => scopeEntries.id, { onDelete: "restrict" }),
    description: text().notNull(),
    quantity: integer(),
    createdAt: createdAt(),
    createdBy: userRef(() => users.id).notNull(),
  },
  (t) => [
    index("lead_requirements_lead_idx").on(t.leadId),
    check("lead_requirements_quantity_check", sql`${t.quantity} is null or ${t.quantity} > 0`),
  ],
);

/**
 * Interaction log and history for customers and leads: calls (with outcome), notes, stage
 * changes, assignments… Marketing numbers (calls made, connected) are counted from here.
 */
export const activities = pgTable(
  "activities",
  {
    id: id(),
    /** Insertion order — several activities written in one transaction share created_at. */
    seq: bigint({ mode: "number" }).notNull().generatedAlwaysAsIdentity(),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    leadId: uuid().references(() => leads.id, { onDelete: "restrict" }),
    contactId: uuid().references(() => contacts.id, { onDelete: "restrict" }),
    /** The branch the activity belongs to (from the lead, or the actor's branch). */
    branchId: uuid().references(() => branches.id, { onDelete: "restrict" }),
    actorId: userRef(() => users.id).notNull(),
    kind: text().$type<ActivityKind>().notNull(),
    callOutcome: text().$type<CallOutcome>(),
    body: text(),
    meta: jsonb().$type<Record<string, unknown>>(),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    index("activities_company_idx").on(t.companyId, t.seq),
    index("activities_lead_idx").on(t.leadId, t.seq),
    index("activities_branch_kind_idx").on(t.branchId, t.kind, t.occurredAt),
    index("activities_actor_idx").on(t.actorId, t.occurredAt),
    check("activities_kind_check", inList(t.kind, ACTIVITY_KINDS)),
    check("activities_call_outcome_check", sql`${t.callOutcome} is null or ${inList(t.callOutcome, CALL_OUTCOMES)}`),
    check("activities_call_needs_outcome_check", sql`${t.kind} <> 'call' or ${t.callOutcome} is not null`),
  ],
);

/**
 * Quotations. Prices are entered by people — the platform holds no price list.
 * Amounts are in paise, before tax; tax and invoicing stay in Tally.
 * Numbering (Q-1001) is internal; PTCC's official quotation numbering is a "Needs verification" item.
 */
export const quotations = pgTable(
  "quotations",
  {
    id: id(),
    number: integer().notNull().generatedAlwaysAsIdentity({ startWith: 1001 }),
    branchId: uuid()
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    leadId: uuid()
      .notNull()
      .references(() => leads.id, { onDelete: "restrict" }),
    companyId: uuid()
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    contactId: uuid().references(() => contacts.id, { onDelete: "restrict" }),
    status: text().$type<QuotationStatus>().notNull().default("draft"),
    validUntil: date({ mode: "string" }),
    notes: text(),
    totalPaise: bigint({ mode: "number" }).notNull().default(0),
    sentAt: timestamp({ withTimezone: true }),
    decidedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdBy: userRef(() => users.id).notNull(),
    updatedBy: userRef(() => users.id),
  },
  (t) => [
    index("quotations_lead_idx").on(t.leadId),
    index("quotations_branch_status_idx").on(t.branchId, t.status),
    check("quotations_status_check", inList(t.status, QUOTATION_STATUSES)),
    check("quotations_total_check", sql`${t.totalPaise} >= 0`),
  ],
);

export const quotationLines = pgTable(
  "quotation_lines",
  {
    id: id(),
    quotationId: uuid()
      .notNull()
      .references(() => quotations.id, { onDelete: "cascade" }),
    position: integer().notNull(),
    scopeEntryId: uuid().references(() => scopeEntries.id, { onDelete: "restrict" }),
    description: text().notNull(),
    quantity: integer().notNull(),
    unitPricePaise: bigint({ mode: "number" }).notNull(),
    amountPaise: bigint({ mode: "number" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("quotation_lines_quotation_idx").on(t.quotationId, t.position),
    check("quotation_lines_quantity_check", sql`${t.quantity} > 0`),
    check("quotation_lines_amount_check", sql`${t.unitPricePaise} >= 0 and ${t.amountPaise} = ${t.unitPricePaise} * ${t.quantity}`),
  ],
);

/**
 * AI-assisted lead captures (Phase 3) — docs/DATABASE_ARCHITECTURE.md §10. A capture stays a
 * draft until the employee confirms it; confirming creates exactly one lead (lead_id is unique).
 * Photos and recordings are NOT stored: only a fingerprint (type, size, SHA-256) is kept.
 * The recognised text is kept with a confirmed lead (shown only to people who can see the lead)
 * and cleared when a draft is cancelled or abandoned. Keeping it with the lead indefinitely is
 * PROVISIONAL — PTCC has not approved a retention policy yet (docs/DATABASE_ARCHITECTURE.md §10).
 */
export const leadCaptures = pgTable(
  "lead_captures",
  {
    id: id(),
    capturedBy: userRef(() => users.id).notNull(),
    /** The capturer's home branch at the time (not the lead's branch, which they confirm). */
    branchId: uuid().references(() => branches.id, { onDelete: "restrict" }),
    method: text().$type<AiCaptureMethod>().notNull(),
    language: text().$type<DetectedLanguage>().notNull().default("unknown"),
    /** "simulated", or the name of a real provider once one is connected. */
    provider: text().notNull(),
    simulated: boolean().notNull(),
    /** Simulated captures only: which built-in sample produced the result. */
    sample: text(),
    mediaType: text(),
    mediaBytes: integer(),
    mediaSha256: text(),
    /** Exactly as recognised or typed, in its original language. */
    originalText: text(),
    /** The employee's correction of a transcript, if any. */
    editedText: text(),
    draft: jsonb().$type<Record<string, unknown>>(),
    problems: jsonb().$type<string[]>(),
    /** Fields the employee changed before confirming (for accuracy tracking). */
    editedFields: jsonb().$type<string[]>(),
    status: text().$type<CaptureStatus>().notNull().default("draft"),
    error: text(),
    leadId: uuid().references(() => leads.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    confirmedAt: timestamp({ withTimezone: true }),
    discardedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    uniqueIndex("lead_captures_lead_unique").on(t.leadId),
    index("lead_captures_captured_by_idx").on(t.capturedBy, t.createdAt),
    index("lead_captures_status_idx").on(t.status, t.createdAt),
    check("lead_captures_method_check", inList(t.method, AI_CAPTURE_METHODS)),
    check("lead_captures_language_check", inList(t.language, DETECTED_LANGUAGES)),
    check("lead_captures_status_check", inList(t.status, CAPTURE_STATUSES)),
    check("lead_captures_confirmed_check", sql`${t.status} <> 'confirmed' or ${t.leadId} is not null`),
    check("lead_captures_media_bytes_check", sql`${t.mediaBytes} is null or ${t.mediaBytes} > 0`),
  ],
);
