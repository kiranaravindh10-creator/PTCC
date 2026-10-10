import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, gte, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { canAny } from "@/server/access/actor";
import type { Ctx } from "@/server/context";
import type { Database } from "@/server/db/client";
import { branches, companies, contacts, leadCaptures, leads, users } from "@/server/db/schema";
import {
  AppError,
  CaptureProcessingError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  NotImplementedError,
  RateLimitError,
  ValidationError,
} from "@/server/errors";
import { captureMode, providersFor, type CaptureMode } from "@/server/integrations/ai";
import { sampleLabel } from "@/server/integrations/ai/simulated";
import { optionalText, parseInput, uuidField } from "@/server/validation";
import { normalizeCompanyName } from "@/lib/company";
import { normalizePhone } from "@/lib/phone";
import { companyToday } from "@/lib/time";
import { companyVisibility } from "@/modules/customers/visibility";
import { editedFieldsOf, prepareLeadDraft, validateDraft, type CaptureInput, type LeadDraft } from "./capture";
import { AUDIO_TYPES, IMAGE_TYPES, MAX_AUDIO_BYTES, MAX_IMAGE_BYTES, MAX_TEXT_LENGTH } from "./capture-limits";
import {
  AI_CAPTURE_METHODS,
  CAPTURE_LANGUAGES,
  type AiCaptureMethod,
  type CaptureLanguage,
  type CaptureStatus,
  type DetectedLanguage,
  type LeadStage,
} from "./model";
import { leadVisibility } from "./queries";
import { createLeadInTx, createLeadSchema, type CreateLeadInput } from "./service";

/**
 * AI-assisted lead capture (Phase 3) — docs/SYSTEM_ARCHITECTURE.md §7.
 *
 *   startCapture   photo / voice / text → recognised text + validated draft. Saves a DRAFT
 *                  capture, never a lead. Photos and recordings are checked and fingerprinted,
 *                  then dropped — they are not stored.
 *   confirmCapture the employee's explicit confirmation. Creates exactly one lead through the
 *                  same core as the manual form (createLeadInTx) and marks the capture
 *                  confirmed in the same transaction. Repeating it returns the same lead.
 *   discardCapture cancels a draft and clears its captured text.
 */

export { AUDIO_TYPES, IMAGE_TYPES, MAX_AUDIO_BYTES, MAX_IMAGE_BYTES, MAX_TEXT_LENGTH } from "./capture-limits";
/** Abuse control: captures (including failed ones) per person per hour. */
export const CAPTURES_PER_HOUR = 30;
/** Drafts nobody confirmed or cancelled are cleared after this many days. */
export const ABANDONED_DRAFT_DAYS = 7;

export type CaptureFile = { bytes: Uint8Array; type: string };

export type StartCaptureInput = {
  method: string;
  language?: string;
  /** Simulated mode only: which built-in sample to use. */
  sample?: string;
  text?: string;
  file?: CaptureFile | null;
};

export type CaptureView = {
  id: string;
  method: AiCaptureMethod;
  language: DetectedLanguage;
  simulated: boolean;
  /** Simulated captures: the sample the result came from. */
  sampleLabel: string | null;
  originalText: string;
  draft: LeadDraft;
  problems: string[];
  /** A photo or recording was checked, fingerprinted and dropped (not stored). */
  mediaChecked: boolean;
};

export type StartCaptureResult = { status: "ready"; capture: CaptureView } | { status: "failed"; message: string };

const baseType = (type: string) => type.split(";")[0]!.trim().toLowerCase();

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  bytes.length >= offset + signature.length && signature.every((byte, i) => bytes[offset + i] === byte);
const ascii = (value: string) => [...value].map((char) => char.charCodeAt(0));

/** Does the file's content match its declared type? (A renamed file is refused.) */
export function contentMatchesType(bytes: Uint8Array, type: string): boolean {
  switch (baseType(type)) {
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "image/png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/webp":
      return startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8);
    case "audio/webm":
      return startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3]);
    case "audio/ogg":
      return startsWith(bytes, ascii("OggS"));
    case "audio/mp4":
    case "audio/aac":
      return startsWith(bytes, ascii("ftyp"), 4) || startsWith(bytes, [0xff, 0xf1]) || startsWith(bytes, [0xff, 0xf9]);
    case "audio/mpeg":
      return startsWith(bytes, ascii("ID3")) || (bytes.length > 1 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0);
    case "audio/wav":
    case "audio/x-wav":
      return startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WAVE"), 8);
    default:
      return false;
  }
}

function checkFile(file: CaptureFile | null | undefined, kind: "photo" | "recording"): CaptureFile & { type: string } {
  const allowed: readonly string[] = kind === "photo" ? IMAGE_TYPES : AUDIO_TYPES;
  const max = kind === "photo" ? MAX_IMAGE_BYTES : MAX_AUDIO_BYTES;
  if (!file || file.bytes.length === 0) {
    throw new ValidationError(`Add a ${kind} first.`, { file: `Add a ${kind} first.` });
  }
  const type = baseType(file.type);
  if (!allowed.includes(type)) {
    const message = kind === "photo" ? "Use a JPEG, PNG or WebP photo." : "This recording format isn't supported. Record again in the app.";
    throw new ValidationError(message, { file: message });
  }
  if (file.bytes.length > max) {
    const message = `The ${kind} is too large (over ${Math.round(max / 1024 / 1024)} MB).`;
    throw new ValidationError(message, { file: message });
  }
  if (!contentMatchesType(file.bytes, type)) {
    const message = `This file isn't a valid ${kind}.`;
    throw new ValidationError(message, { file: message });
  }
  return { bytes: file.bytes, type };
}

function requireCapturePermission(ctx: Pick<Ctx, "actor">) {
  if (!canAny(ctx.actor, "lead.capture", "marketing.work")) throw new ForbiddenError();
}

/** Clears the text of drafts nobody confirmed or cancelled within ABANDONED_DRAFT_DAYS. */
export async function purgeAbandonedCaptures(db: Database, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - ABANDONED_DRAFT_DAYS * 24 * 60 * 60 * 1000);
  const cleared = await db
    .update(leadCaptures)
    .set({ status: "discarded", originalText: null, editedText: null, draft: null, problems: null, discardedAt: now })
    .where(and(eq(leadCaptures.status, "draft"), lt(leadCaptures.createdAt, cutoff)))
    .returning({ id: leadCaptures.id });
  return cleared.length;
}

/**
 * Recognises a photo, recording or typed description and saves a DRAFT capture for review.
 * Never creates a lead. `options.mode` is for tests; normally from CAPTURE_PROVIDER.
 */
export async function startCapture(ctx: Ctx, input: StartCaptureInput, options: { mode?: CaptureMode } = {}): Promise<StartCaptureResult> {
  requireCapturePermission(ctx);
  const mode = options.mode ?? captureMode();
  if (mode === "off") throw new NotImplementedError("Lead capture isn't connected yet. Add the lead with the form instead.");

  const method = (AI_CAPTURE_METHODS as readonly string[]).includes(input.method) ? (input.method as AiCaptureMethod) : null;
  if (!method) throw new ValidationError("Choose photo, voice or text.");
  const language =
    input.language && (CAPTURE_LANGUAGES as readonly string[]).includes(input.language) ? (input.language as CaptureLanguage) : undefined;
  if (input.language && !language) throw new ValidationError("Choose English, Kannada or Hindi.", { language: "Choose a language." });

  const since = new Date(ctx.now.getTime() - 60 * 60 * 1000);
  const [recent] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(leadCaptures)
    .where(and(eq(leadCaptures.capturedBy, ctx.actor.id), gte(leadCaptures.createdAt, since)));
  if ((recent?.n ?? 0) >= CAPTURES_PER_HOUR) throw new RateLimitError();
  await purgeAbandonedCaptures(ctx.db, ctx.now);

  // Build the recognition input; files are checked here and never stored.
  let captureInput: CaptureInput;
  let media: { type: string; bytes: number; sha256: string } | null = null;
  const fingerprint = (file: CaptureFile) => ({
    type: file.type,
    bytes: file.bytes.length,
    sha256: createHash("sha256").update(file.bytes).digest("hex"),
  });
  if (method === "photo") {
    const file = checkFile(input.file, "photo");
    media = fingerprint(file);
    captureInput = { method, image: file.bytes, mimeType: file.type };
  } else if (method === "voice") {
    if (!language) throw new ValidationError("Choose the language you'll speak.", { language: "Choose a language." });
    // Simulated mode can run without a recording (a chosen sample); a real provider needs one.
    const hasRecording = Boolean(input.file && input.file.bytes.length > 0);
    if (!hasRecording && mode !== "simulated") throw new ValidationError("Record the lead details first.", { file: "Record first." });
    const file = hasRecording ? checkFile(input.file, "recording") : null;
    if (file) media = fingerprint(file);
    captureInput = { method, audio: file?.bytes ?? new Uint8Array(), mimeType: file?.type ?? "audio/webm", languageHint: language };
  } else {
    const text = (input.text ?? "").trim();
    if (text.length < 3) throw new ValidationError("Describe the lead in a few words first.", { text: "Describe the lead first." });
    if (text.length > MAX_TEXT_LENGTH) {
      throw new ValidationError(`Keep it under ${MAX_TEXT_LENGTH} characters.`, { text: `Keep it under ${MAX_TEXT_LENGTH} characters.` });
    }
    captureInput = { method, text, languageHint: language };
  }

  const simulated = mode === "simulated";
  const base = {
    capturedBy: ctx.actor.id,
    branchId: ctx.actor.branchId,
    method,
    provider: mode,
    simulated,
    sample: simulated ? (input.sample ?? null) : null,
    mediaType: media?.type ?? null,
    mediaBytes: media?.bytes ?? null,
    mediaSha256: media?.sha256 ?? null,
  };
  const fail = async (message: string, language: DetectedLanguage = "unknown"): Promise<StartCaptureResult> => {
    await ctx.db.insert(leadCaptures).values({ ...base, language, status: "failed", error: message });
    return { status: "failed", message };
  };

  let prepared: Awaited<ReturnType<typeof prepareLeadDraft>>;
  try {
    prepared = await prepareLeadDraft(captureInput, providersFor(mode, { sample: input.sample }), { today: companyToday(ctx.now) });
  } catch (error) {
    if (error instanceof CaptureProcessingError) return fail(error.message, language ?? "unknown");
    if (error instanceof AppError) throw error; // validation (e.g. no sample chosen), not connected…
    // Unexpected: log without the captured content, tell the person plainly.
    console.error("[capture] provider failed", error instanceof Error ? error.name : "unknown error");
    return fail("Something went wrong while reading this. Try again, or type the details instead.", language ?? "unknown");
  }
  if (!prepared.original.text) return fail("Nothing was recognised. Try again, or type the details instead.", prepared.original.language);

  const [row] = await ctx.db
    .insert(leadCaptures)
    .values({
      ...base,
      language: prepared.original.language,
      originalText: prepared.original.text,
      draft: prepared.draft as unknown as Record<string, unknown>,
      problems: prepared.problems,
      status: "draft",
    })
    .returning({ id: leadCaptures.id });
  return {
    status: "ready",
    capture: {
      id: row!.id,
      method,
      language: prepared.original.language,
      simulated,
      sampleLabel: simulated ? sampleLabel(input.sample) : null,
      originalText: prepared.original.text,
      draft: prepared.draft,
      problems: prepared.problems,
      mediaChecked: media !== null,
    },
  };
}

/** One of my own draft captures, for the review screen (null if not mine or not a draft). */
export async function getCaptureForReview(ctx: Pick<Ctx, "db" | "actor">, captureId: string): Promise<CaptureView | null> {
  if (!z.uuid().safeParse(captureId).success) return null;
  const [row] = await ctx.db
    .select()
    .from(leadCaptures)
    .where(and(eq(leadCaptures.id, captureId), eq(leadCaptures.capturedBy, ctx.actor.id), eq(leadCaptures.status, "draft")))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    method: row.method,
    language: row.language,
    simulated: row.simulated,
    sampleLabel: row.simulated ? sampleLabel(row.sample) : null,
    originalText: row.originalText ?? "",
    draft: validateDraft(row.draft).draft,
    problems: row.problems ?? [],
    mediaChecked: row.mediaSha256 !== null,
  };
}

const confirmSchema = z.object({ captureId: uuidField, editedTranscript: optionalText(4000) });

/**
 * The employee's explicit confirmation: creates exactly one lead from the reviewed values,
 * through the same validation, permission and branch checks as the manual form. Confirming
 * again (double tap, retry, second tab) returns the same lead. Nothing is saved if anything fails.
 */
export async function confirmCapture(
  ctx: Ctx,
  input: { captureId: string; editedTranscript?: string; lead: CreateLeadInput },
): Promise<{ leadId: string; alreadyConfirmed: boolean }> {
  requireCapturePermission(ctx);
  const { captureId, editedTranscript } = parseInput(confirmSchema, input);
  const data = parseInput(createLeadSchema, input.lead);

  return ctx.db.transaction(async (tx) => {
    const [capture] = await tx
      .select()
      .from(leadCaptures)
      .where(and(eq(leadCaptures.id, captureId), eq(leadCaptures.capturedBy, ctx.actor.id)))
      .for("update")
      .limit(1);
    if (!capture) throw new NotFoundError();
    if (capture.status === "confirmed" && capture.leadId) return { leadId: capture.leadId, alreadyConfirmed: true };
    if (capture.status !== "draft") throw new ConflictError("This capture was cancelled or couldn't be read. Start a new capture.");

    const draft = validateDraft(capture.draft).draft;
    const submitted = input.lead;
    const editedFields = editedFieldsOf(draft, {
      companyName: submitted.companyName,
      contactName: submitted.contactName,
      contactDesignation: submitted.contactDesignation,
      contactPhone: submitted.contactPhone,
      contactEmail: submitted.contactEmail,
      companyWebsite: submitted.companyWebsite,
      addressLine: submitted.addressLine,
      area: submitted.area,
      city: submitted.city,
      industry: submitted.industry,
      requirement: submitted.requirement,
      notes: submitted.notes,
    });
    const lead = await createLeadInTx(tx, ctx, data, {
      capture: {
        id: capture.id,
        method: capture.method,
        language: capture.language,
        provider: capture.provider,
        simulated: capture.simulated,
        editedFields,
      },
    });
    const corrected = editedTranscript && editedTranscript.trim() !== (capture.originalText ?? "").trim() ? editedTranscript.trim() : null;
    // The transcript stays with the lead; the draft (a second copy of its details) is no longer needed.
    await tx
      .update(leadCaptures)
      .set({ status: "confirmed", leadId: lead.id, confirmedAt: ctx.now, editedText: corrected, editedFields, draft: null, problems: null })
      .where(eq(leadCaptures.id, capture.id));
    return { leadId: lead.id, alreadyConfirmed: false };
  });
}

/** Cancels one of my draft captures and clears its captured text. Safe to repeat. */
export async function discardCapture(ctx: Ctx, captureId: string): Promise<void> {
  requireCapturePermission(ctx);
  const id = parseInput(uuidField, captureId);
  const [row] = await ctx.db
    .select({ status: leadCaptures.status })
    .from(leadCaptures)
    .where(and(eq(leadCaptures.id, id), eq(leadCaptures.capturedBy, ctx.actor.id)))
    .limit(1);
  if (!row) throw new NotFoundError();
  if (row.status !== "draft") return;
  await ctx.db
    .update(leadCaptures)
    .set({ status: "discarded", originalText: null, editedText: null, draft: null, problems: null, discardedAt: ctx.now })
    .where(and(eq(leadCaptures.id, id), eq(leadCaptures.status, "draft")));
}

// ─── Duplicates ────────────────────────────────────────────────────────────────

export type DuplicateCompany = {
  id: string;
  name: string;
  area: string | null;
  city: string | null;
  /** The employee may open this company; otherwise only its name and place are shown. */
  known: boolean;
  matchedOn: ("name" | "phone" | "email")[];
  /** Only for companies the employee may see. */
  contactName: string | null;
};

export type DuplicateLead = {
  id: string;
  number: number;
  companyId: string;
  companyName: string;
  stage: LeadStage;
  ownerName: string | null;
  branchName: string | null;
};

/**
 * Possible duplicates of a capture, by company name, phone and email. Companies are central
 * records, so a match in another branch is shown by name and place only (to reuse it, never to
 * reveal its business); open leads are shown only if the employee may see them. Nothing is
 * merged — the employee decides.
 */
export async function findCaptureDuplicates(
  ctx: Pick<Ctx, "db" | "actor">,
  input: { companyName?: string; phone?: string; email?: string },
): Promise<{ companies: DuplicateCompany[]; leads: DuplicateLead[] }> {
  requireCapturePermission(ctx);
  const visible = companyVisibility(ctx.actor);
  const knownSql = visible ? sql<boolean>`${visible}` : sql<boolean>`true`;
  const found = new Map<string, DuplicateCompany>();
  const add = (row: { id: string; name: string; area: string | null; city: string | null; known: boolean }, on: DuplicateCompany["matchedOn"][number]) => {
    const existing = found.get(row.id);
    if (existing) {
      if (!existing.matchedOn.includes(on)) existing.matchedOn.push(on);
    } else {
      found.set(row.id, { ...row, matchedOn: [on], contactName: null });
    }
  };
  const columns = { id: companies.id, name: companies.name, area: companies.area, city: companies.city, known: knownSql };

  const words = normalizeCompanyName(input.companyName ?? "").split(" ").filter((word) => word.length >= 2);
  if (words.length > 0) {
    const rows = await ctx.db
      .select(columns)
      .from(companies)
      .where(and(isNull(companies.archivedAt), ...words.map((word) => sql`${companies.normalizedName} like ${`%${word.replace(/[%_\\]/g, "\\$&")}%`}`)))
      .orderBy(asc(companies.name))
      .limit(6);
    rows.forEach((row) => add(row, "name"));
  }
  const phone = input.phone ? normalizePhone(input.phone) : null;
  const email = input.email?.trim().toLowerCase() || null;
  for (const [on, value, companyColumn, contactColumn] of [
    ["phone", phone, companies.phone, contacts.phone],
    ["email", email, companies.email, contacts.email],
  ] as const) {
    if (!value) continue;
    const rows = await ctx.db
      .select(columns)
      .from(companies)
      .where(
        and(
          isNull(companies.archivedAt),
          or(eq(companyColumn, value), sql`exists (select 1 from ${contacts} where ${contacts.companyId} = ${companies.id} and lower(${contactColumn}) = lower(${value}))`),
        ),
      )
      .limit(6);
    rows.forEach((row) => add(row, on));
  }

  const result = [...found.values()].slice(0, 8);
  // Contact names only where the employee may see the company.
  const knownIds = result.filter((company) => company.known).map((company) => company.id);
  if (knownIds.length > 0 && (phone || email)) {
    const matches = await ctx.db
      .select({ companyId: contacts.companyId, name: contacts.name })
      .from(contacts)
      .where(and(inArray(contacts.companyId, knownIds), or(phone ? eq(contacts.phone, phone) : undefined, email ? sql`lower(${contacts.email}) = ${email}` : undefined)));
    for (const match of matches) {
      const company = found.get(match.companyId);
      if (company && !company.contactName) company.contactName = match.name;
    }
  }

  const ids = result.map((company) => company.id);
  const owner = alias(users, "duplicate_owner");
  const openLeads =
    ids.length === 0
      ? []
      : await ctx.db
          .select({
            id: leads.id,
            number: leads.number,
            companyId: leads.companyId,
            companyName: companies.name,
            stage: leads.stage,
            ownerName: owner.name,
            branchName: branches.name,
          })
          .from(leads)
          .innerJoin(companies, eq(companies.id, leads.companyId))
          .leftJoin(owner, eq(owner.id, leads.ownerId))
          .leftJoin(branches, eq(branches.id, leads.branchId))
          .where(and(inArray(leads.companyId, ids), notInArray(leads.stage, ["won", "lost"]), leadVisibility(ctx.actor)))
          .orderBy(asc(leads.number))
          .limit(10);
  return { companies: result, leads: openLeads };
}

// ─── The lead page ───────────────────────────────────────────────────────────

export type LeadCaptureInfo = {
  method: AiCaptureMethod;
  language: DetectedLanguage;
  simulated: boolean;
  sampleLabel: string | null;
  originalText: string | null;
  editedText: string | null;
  editedFields: string[];
  capturedByName: string;
  createdAt: Date;
};

/** How a lead was captured, for people who can see the lead. */
export async function getLeadCaptureInfo(ctx: Pick<Ctx, "db" | "actor">, leadId: string): Promise<LeadCaptureInfo | null> {
  if (!z.uuid().safeParse(leadId).success) return null;
  const capturer = alias(users, "capturer");
  const [row] = await ctx.db
    .select({
      method: leadCaptures.method,
      language: leadCaptures.language,
      simulated: leadCaptures.simulated,
      sample: leadCaptures.sample,
      originalText: leadCaptures.originalText,
      editedText: leadCaptures.editedText,
      editedFields: leadCaptures.editedFields,
      capturedByName: capturer.name,
      createdAt: leadCaptures.createdAt,
    })
    .from(leadCaptures)
    .innerJoin(leads, eq(leads.id, leadCaptures.leadId))
    .innerJoin(capturer, eq(capturer.id, leadCaptures.capturedBy))
    .where(and(eq(leadCaptures.leadId, leadId), eq(leadCaptures.status, "confirmed" satisfies CaptureStatus), leadVisibility(ctx.actor)))
    .limit(1);
  if (!row) return null;
  return {
    method: row.method,
    language: row.language,
    simulated: row.simulated,
    sampleLabel: row.simulated ? sampleLabel(row.sample) : null,
    originalText: row.originalText,
    editedText: row.editedText,
    editedFields: row.editedFields ?? [],
    capturedByName: row.capturedByName,
    createdAt: row.createdAt,
  };
}
