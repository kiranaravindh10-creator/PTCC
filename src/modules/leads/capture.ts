import { z } from "zod";
import { normalizePhone, formatPhone } from "@/lib/phone";
import { CAPTURE_LANGUAGES, type CaptureLanguage, type CaptureMethod } from "./model";

/**
 * AI lead capture — interfaces and validation only (docs/SYSTEM_ARCHITECTURE.md §7).
 * NOT CONNECTED: no speech-to-text, OCR or extraction provider exists yet
 * (src/server/integrations/ai). Pure module — nothing here reads or writes the database.
 *
 *   voice — English, Kannada, Hindi ── speech-to-text ─┐
 *   photo — visiting card, enquiry letter ── OCR ──────┼─▶ original text, kept as recognised
 *   typed or pasted text ──────────────────────────────┘          │
 *                                                       extraction (untrusted output)
 *                                                                  │ validateDraft
 *                                                                  ▼
 *                       LeadDraft — canonical fields, plus what could not be read
 *                                                                  │ draftToLeadForm
 *                                                                  ▼
 *         New lead form, prefilled ─▶ the person reviews and corrects ─▶ createLead
 *
 * - AI never creates records. The only way in is createLead, after the person confirms, with
 *   exactly the same validation, permission and branch checks as a lead typed by hand.
 * - Draft fields are language-independent: English text, E.164 phone numbers, ISO dates —
 *   whatever language was spoken. The original transcript is kept alongside, unchanged.
 * - The branch is filled in only when the capture names an active branch exactly. Otherwise
 *   it is left as "Not sure — needs assignment"; it is never guessed.
 * - Services mentioned are search hints, not scope claims. The person picks the service from
 *   PTCC's accredited scope, or the requirement shows "Scope not confirmed — verify with PTCC".
 */

export type AiCaptureMethod = Exclude<CaptureMethod, "manual">;
export type DetectedLanguage = CaptureLanguage | "unknown";

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
  /** Candidate lead fields from recognised text. The result is untrusted and always validated. */
  extract(input: { text: string; language: DetectedLanguage }): Promise<unknown>;
}

export type CaptureProviders = { speech: SpeechToText; vision: ImageToText; extractor: LeadExtractor };

export function isCaptureLanguage(value: string): value is CaptureLanguage {
  return (CAPTURE_LANGUAGES as readonly string[]).includes(value);
}

// ─── The draft ────────────────────────────────────────────────────────────────

const text = (max: number) => z.string().trim().min(1).max(max);

const DRAFT_FIELDS = {
  companyName: { label: "Company", schema: text(160) },
  contactName: { label: "Contact person", schema: text(120) },
  contactPhone: {
    label: "Phone",
    schema: z.string().transform((value, check) => {
      const phone = normalizePhone(value);
      if (!phone) check.addIssue({ code: "custom", message: "Not a phone number" });
      return phone ?? "";
    }),
  },
  contactEmail: { label: "Email", schema: z.email().max(200) },
  area: { label: "Area", schema: text(80) },
  city: { label: "City", schema: text(80) },
  requirement: { label: "Requirement", schema: text(500) },
  branchMention: { label: "Branch", schema: text(80) },
  followUpDate: { label: "Follow-up date", schema: z.iso.date() },
  followUpTime: { label: "Follow-up time", schema: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) },
  notes: { label: "Notes", schema: text(2000) },
} as const;

export type DraftField = keyof typeof DRAFT_FIELDS;

export type LeadDraft = Partial<Record<DraftField, string>> & {
  /** Instruments or services as mentioned — used to prefill the scope search, never as a scope claim. */
  serviceMentions: string[];
  /** Fields the extractor was unsure about; the form asks the person to check them. */
  uncertain: DraftField[];
};

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
  return { draft, problems };
}

/**
 * Runs a capture through recognition and extraction. Returns the original text, a validated
 * draft and any problems — it saves nothing.
 */
export async function prepareLeadDraft(
  input: CaptureInput,
  providers: CaptureProviders,
): Promise<{ original: OriginalCapture; draft: LeadDraft; problems: string[] }> {
  const recognised =
    input.method === "voice"
      ? await providers.speech.transcribe({ audio: input.audio, mimeType: input.mimeType, languageHint: input.languageHint })
      : input.method === "photo"
        ? await providers.vision.read({ image: input.image, mimeType: input.mimeType })
        : { text: input.text, language: input.languageHint ?? ("unknown" as const) };
  const original: OriginalCapture = { method: input.method, language: recognised.language, text: recognised.text.trim() };
  if (!original.text) {
    return {
      original,
      draft: { serviceMentions: [], uncertain: [] },
      problems: ["Nothing was recognised. Try again, or enter the details by hand."],
    };
  }
  const raw = await providers.extractor.extract({ text: original.text, language: original.language });
  return { original, ...validateDraft(raw) };
}

/**
 * Values that prefill the New lead form for the person to review. The branch is set only on
 * an exact match with an active branch's name; otherwise "" — "Not sure — needs assignment".
 */
export function draftToLeadForm(draft: LeadDraft, activeBranches: readonly { id: string; name: string }[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (const key of ["companyName", "contactName", "contactEmail", "area", "city", "requirement", "followUpDate", "followUpTime", "notes"] as const) {
    const value = draft[key];
    if (value) values[key] = value;
  }
  if (draft.contactPhone) values.contactPhone = formatPhone(draft.contactPhone);
  const mention = draft.branchMention?.trim().toLowerCase();
  const matches = mention ? activeBranches.filter((branch) => branch.name.trim().toLowerCase() === mention) : [];
  values.branchId = matches.length === 1 ? matches[0]!.id : "";
  return values;
}
