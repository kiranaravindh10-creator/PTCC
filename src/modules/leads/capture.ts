import { z } from "zod";
import { normalizePhone, formatPhone } from "@/lib/phone";
import { addDays, companyToday, type IsoDate } from "@/lib/time";
import {
  CAPTURE_LANGUAGES,
  type AiCaptureMethod,
  type CaptureLanguage,
  type DetectedLanguage,
} from "./model";

/**
 * AI-assisted lead capture — interfaces, validation and review rules (docs/SYSTEM_ARCHITECTURE.md §7).
 * Pure module: nothing here reads or writes the database or calls a provider by itself.
 *
 *   voice — English, Kannada, Hindi ── speech-to-text ─┐
 *   photo — business card, company board ── OCR ───────┼─▶ original text, kept as recognised
 *   typed description ─────────────────────────────────┘          │
 *                                                       extraction (untrusted output)
 *                                                                  │ validateDraft
 *                                                                  ▼
 *                       LeadDraft — canonical fields, plus what could not be read
 *                                                                  │ draftToLeadForm
 *                                                                  ▼
 *       review form, prefilled ─▶ the employee corrects and confirms ─▶ createLead (same checks)
 *
 * - AI never creates records. The only way in is the employee's explicit confirmation, which
 *   goes through createLead with the same validation, permission and branch checks as a lead
 *   typed by hand (capture-service.ts).
 * - Draft fields are language-independent: English text, E.164 phone numbers, ISO dates —
 *   whatever language was spoken. The original transcript is kept alongside, unchanged.
 * - Nothing is invented: a field that wasn't present stays empty. A follow-up date from words
 *   like "next Tuesday" is only a suggestion the employee must accept.
 * - The branch defaults to the employee's own branch. It is never inferred from a phone number
 *   or an address; a branch named in the capture is only offered as a hint.
 * - Services mentioned are search hints, not scope claims.
 */

export type { AiCaptureMethod, DetectedLanguage };

export type CaptureInput =
  | { method: "voice"; audio: Uint8Array; mimeType: string; languageHint?: CaptureLanguage }
  | { method: "photo"; image: Uint8Array; mimeType: string }
  | { method: "text"; text: string; languageHint?: CaptureLanguage };

/** What was captured, exactly as recognised, in its original language. Stored with the lead. */
export type OriginalCapture = { method: AiCaptureMethod; language: DetectedLanguage; text: string };

export interface SpeechToText {
  /** Must handle English, Kannada and Hindi, including speech that mixes them. */
  transcribe(input: { audio: Uint8Array; mimeType: string; languageHint?: CaptureLanguage }): Promise<{
    text: string;
    language: DetectedLanguage;
  }>;
}

export interface ImageToText {
  read(input: { image: Uint8Array; mimeType: string }): Promise<{ text: string; language: DetectedLanguage }>;
}

export interface LeadExtractor {
  /**
   * Candidate lead fields from recognised text. `today` (company time zone) is for turning
   * words like "tomorrow" into explicit dates. The result is untrusted and always validated.
   */
  extract(input: { text: string; language: DetectedLanguage; today: IsoDate }): Promise<unknown>;
}

export type CaptureProviders = { speech: SpeechToText; vision: ImageToText; extractor: LeadExtractor };

export function isCaptureLanguage(value: string): value is CaptureLanguage {
  return (CAPTURE_LANGUAGES as readonly string[]).includes(value);
}

// ─── The draft ────────────────────────────────────────────────────────────────

const text = (max: number) => z.string().trim().min(1).max(max);

const WEBSITE = /^(https?:\/\/)?([a-z0-9-]+\.)+[a-z]{2,}(\/\S*)?$/i;

const DRAFT_FIELDS = {
  companyName: { label: "Company", schema: text(160) },
  contactName: { label: "Contact person", schema: text(120) },
  contactDesignation: { label: "Job title", schema: text(120) },
  contactPhone: {
    label: "Phone",
    schema: z.string().transform((value, check) => {
      const phone = normalizePhone(value);
      if (!phone) check.addIssue({ code: "custom", message: "Not a phone number" });
      return phone ?? "";
    }),
  },
  contactEmail: { label: "Email", schema: z.email().max(200).transform((value) => value.toLowerCase()) },
  companyWebsite: { label: "Website", schema: z.string().trim().max(200).regex(WEBSITE) },
  addressLine: { label: "Address", schema: text(300) },
  area: { label: "Area", schema: text(80) },
  city: { label: "City", schema: text(80) },
  industry: { label: "Industry", schema: text(120) },
  requirement: { label: "Requirement", schema: text(500) },
  branchMention: { label: "Branch", schema: text(80) },
  followUpDate: { label: "Follow-up date", schema: z.iso.date() },
  followUpTime: { label: "Follow-up time", schema: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) },
  followUpPhrase: { label: "Follow-up", schema: text(80) },
  notes: { label: "Notes", schema: text(2000) },
} as const;

export type DraftField = keyof typeof DRAFT_FIELDS;
export const DRAFT_FIELD_KEYS = Object.keys(DRAFT_FIELDS) as DraftField[];
export const DRAFT_FIELD_LABEL = Object.fromEntries(DRAFT_FIELD_KEYS.map((key) => [key, DRAFT_FIELDS[key].label])) as Record<
  DraftField,
  string
>;

export type LeadDraft = Partial<Record<DraftField, string>> & {
  /** Instruments or services as mentioned — used to prefill the scope search, never as a scope claim. */
  serviceMentions: string[];
  /** Fields the extractor was unsure about; the review form asks the employee to check them. */
  uncertain: DraftField[];
};

export const EMPTY_DRAFT: LeadDraft = { serviceMentions: [], uncertain: [] };

/**
 * Validates untrusted extractor output field by field. A field that fails is dropped and
 * reported, so one bad value never blocks the rest; unknown fields are ignored.
 */
export function validateDraft(raw: unknown): { draft: LeadDraft; problems: string[] } {
  const draft: LeadDraft = { serviceMentions: [], uncertain: [] };
  const problems: string[] = [];
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { draft, problems: ["Nothing usable was extracted. Enter the details by hand."] };
  }
  const input = raw as Record<string, unknown>;

  for (const [key, { label, schema }] of Object.entries(DRAFT_FIELDS) as [DraftField, (typeof DRAFT_FIELDS)[DraftField]][]) {
    const value = input[key];
    if (value === undefined || value === null || value === "") continue;
    const parsed = schema.safeParse(value);
    if (parsed.success) draft[key] = parsed.data;
    else problems.push(`${label} couldn't be read — please check it.`);
  }
  if (draft.followUpTime && !draft.followUpDate) {
    delete draft.followUpTime;
    problems.push("A follow-up time was heard without a date — please choose the date.");
  }

  const mentions = z.array(text(120)).max(10).safeParse(input.serviceMentions ?? []);
  if (mentions.success) draft.serviceMentions = mentions.data;
  else problems.push("The services mentioned couldn't be read — search for them below.");

  const uncertain = z.array(z.string()).safeParse(input.uncertain ?? []);
  if (uncertain.success) {
    draft.uncertain = uncertain.data.filter((field): field is DraftField => Object.hasOwn(DRAFT_FIELDS, field));
  }
  // A follow-up date always needs the employee's explicit "yes" — it is never certain.
  if (draft.followUpDate && !draft.uncertain.includes("followUpDate")) draft.uncertain.push("followUpDate");
  const extraProblems = z.array(text(300)).max(10).safeParse(input.problems ?? []);
  if (extraProblems.success) problems.push(...extraProblems.data);
  return { draft, problems };
}

/**
 * Runs a capture through recognition and extraction. Returns the original text, a validated
 * draft and any problems — it saves nothing.
 */
export async function prepareLeadDraft(
  input: CaptureInput,
  providers: CaptureProviders,
  options: { today?: IsoDate } = {},
): Promise<{ original: OriginalCapture; draft: LeadDraft; problems: string[] }> {
  const recognised =
    input.method === "voice"
      ? await providers.speech.transcribe({ audio: input.audio, mimeType: input.mimeType, languageHint: input.languageHint })
      : input.method === "photo"
        ? await providers.vision.read({ image: input.image, mimeType: input.mimeType })
        : { text: input.text, language: input.languageHint ?? detectLanguage(input.text) };
  const original: OriginalCapture = { method: input.method, language: recognised.language, text: recognised.text.trim() };
  if (!original.text) {
    return {
      original,
      draft: { serviceMentions: [], uncertain: [] },
      problems: ["Nothing was recognised. Try again, or enter the details by hand."],
    };
  }
  const raw = await providers.extractor.extract({
    text: original.text,
    language: original.language,
    today: options.today ?? companyToday(),
  });
  return { original, ...validateDraft(raw) };
}

// ─── Language, dates and patterns (deterministic) ────────────────────────────

/** The script a text is mostly written in: Kannada, Devanagari (Hindi) or Latin (English). */
export function detectLanguage(value: string): DetectedLanguage {
  let kannada = 0;
  let devanagari = 0;
  let latin = 0;
  for (const char of value) {
    const code = char.codePointAt(0)!;
    if (code >= 0x0c80 && code <= 0x0cff) kannada++;
    else if (code >= 0x0900 && code <= 0x097f) devanagari++;
    else if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) latin++;
  }
  const max = Math.max(kannada, devanagari, latin);
  if (max === 0) return "unknown";
  if (max === kannada) return "kn";
  if (max === devanagari) return "hi";
  return "en";
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

function weekdayOf(date: IsoDate): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/**
 * Turns words about when into an explicit date, relative to `today` (company time zone).
 * `ambiguous` = people mean different days by it (e.g. "next Tuesday"), so the employee must
 * confirm. Anything not understood returns null — never a guess.
 */
export function resolveRelativeDate(phrase: string, today: IsoDate): { date: IsoDate; ambiguous: boolean } | null {
  const p = phrase.trim().toLowerCase().replace(/\s+/g, " ");
  if (p === "today") return { date: today, ambiguous: false };
  if (p === "tomorrow") return { date: addDays(today, 1), ambiguous: false };
  if (p === "day after tomorrow" || p === "the day after tomorrow") return { date: addDays(today, 2), ambiguous: false };
  const inDays = /^in (\d{1,2}) days?$/.exec(p);
  if (inDays) {
    const n = Number(inDays[1]);
    return n >= 1 && n <= 60 ? { date: addDays(today, n), ambiguous: false } : null;
  }
  const weekday = /^(this|next|on)? ?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)$/.exec(p);
  if (weekday) {
    const target = WEEKDAYS.indexOf(weekday[2] as (typeof WEEKDAYS)[number]);
    const current = weekdayOf(today);
    let ahead = (target - current + 7) % 7;
    if (weekday[1] === "this") return { date: addDays(today, ahead), ambiguous: false };
    if (ahead === 0) ahead = 7;
    // "next Tuesday" said on a Friday may mean the coming Tuesday or the one after.
    return { date: addDays(today, ahead), ambiguous: true };
  }
  return null;
}

const DATE_PHRASE =
  /\b(today|tomorrow|(?:the )?day after tomorrow|in \d{1,2} days?|(?:this|next|on) (?:sunday|monday|tuesday|wednesday|thursday|friday|saturday))\b/i;
const PHONE = /(?:\+91[\s-]?)?(?:0)?[6-9]\d{4}[\s-]?\d{5}\b/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_LIKE = /\b(?:https?:\/\/[^\s,;]+|www\.[^\s,;]+)/gi;

/**
 * Local, deterministic extraction of what a pattern can find for certain: phone numbers,
 * email addresses, websites and clear "when" words. It never guesses names, companies or
 * requirements — those stay for the employee to fill in.
 */
export function extractByPattern(value: string, today: IsoDate): Record<string, unknown> {
  const result: Record<string, unknown> = { uncertain: [] as string[], problems: [] as string[] };
  const uncertain = result.uncertain as string[];
  const problems = result.problems as string[];

  const phones = [...new Set((value.match(PHONE) ?? []).map((raw) => normalizePhone(raw)).filter((p): p is string => Boolean(p)))];
  if (phones.length > 0) {
    result.contactPhone = phones[0];
    if (phones.length > 1) {
      uncertain.push("contactPhone");
      problems.push(`${phones.length} phone numbers were found — check which one is the contact's.`);
    }
  }
  const emails = [...new Set((value.match(EMAIL) ?? []).map((email) => email.toLowerCase()))];
  if (emails.length > 0) {
    result.contactEmail = emails[0];
    if (emails.length > 1) {
      uncertain.push("contactEmail");
      problems.push(`${emails.length} email addresses were found — check which one is the contact's.`);
    }
  }
  const website = (value.match(URL_LIKE) ?? [])[0]?.replace(/[.)]+$/, "");
  if (website) result.companyWebsite = website;

  const when = DATE_PHRASE.exec(value);
  if (when) {
    const resolved = resolveRelativeDate(when[1]!, today);
    if (resolved) {
      result.followUpDate = resolved.date;
      result.followUpPhrase = when[1];
      uncertain.push("followUpDate");
    }
  }
  return result;
}

// ─── Review form ────────────────────────────────────────────────────────────────

/** Draft fields that map to an input of the review form, in display order. */
export const REVIEW_FIELDS = [
  "companyName",
  "contactName",
  "contactDesignation",
  "contactPhone",
  "contactEmail",
  "companyWebsite",
  "addressLine",
  "area",
  "city",
  "industry",
  "requirement",
  "notes",
] as const satisfies readonly DraftField[];
export type ReviewField = (typeof REVIEW_FIELDS)[number];

export type ReviewForm = {
  /** Initial input values, as the employee will see them. */
  values: Record<ReviewField, string>;
  /** The employee's own branch — never inferred from the capture. "" for company-level people. */
  branchId: string;
  /** An active branch the capture explicitly named, if it differs from `branchId` — offered, not applied. */
  branchHint: { id: string; name: string } | null;
  /** A follow-up the capture suggested; applied only if the employee accepts it. */
  suggestedFollowUp: { date: IsoDate; time: string | null; phrase: string | null } | null;
};

/** Initial review-form values from a validated draft. */
export function draftToLeadForm(
  draft: LeadDraft,
  activeBranches: readonly { id: string; name: string }[],
  defaultBranchId: string,
): ReviewForm {
  const values = Object.fromEntries(REVIEW_FIELDS.map((key) => [key, draft[key] ?? ""])) as Record<ReviewField, string>;
  if (draft.contactPhone) values.contactPhone = formatPhone(draft.contactPhone);
  const mention = draft.branchMention?.trim().toLowerCase();
  const named = mention ? activeBranches.filter((branch) => branch.name.trim().toLowerCase() === mention) : [];
  const hint = named.length === 1 && named[0]!.id !== defaultBranchId ? { id: named[0]!.id, name: named[0]!.name } : null;
  return {
    values,
    branchId: defaultBranchId,
    branchHint: hint,
    suggestedFollowUp: draft.followUpDate
      ? { date: draft.followUpDate, time: draft.followUpTime ?? null, phrase: draft.followUpPhrase ?? null }
      : null,
  };
}

/**
 * Which review fields the employee changed before confirming, compared with the stored draft
 * (phone numbers compared normalised). Used for accuracy tracking — never shown as blame.
 */
export function editedFieldsOf(draft: LeadDraft, submitted: Partial<Record<ReviewField, string | undefined>>): ReviewField[] {
  return REVIEW_FIELDS.filter((key) => {
    const before = (draft[key] ?? "").trim();
    const raw = (submitted[key] ?? "").trim();
    const after = key === "contactPhone" ? (normalizePhone(raw) ?? raw) : key === "contactEmail" ? raw.toLowerCase() : raw;
    return before !== after;
  });
}
