/**
 * Marketing vocabulary shared by the database schema, services and UI. Pure module.
 *
 * Pipeline (as confirmed by PTCC):
 *   New lead → Qualification → Contact → Follow-up → Requirement → Quotation → Won / Lost → Customer
 * "Customer" is not a lead stage: winning a lead makes the company a customer of the lead's branch.
 */

export const LEAD_STAGES = [
  "new",
  "qualification",
  "contact",
  "follow_up",
  "requirement",
  "quotation",
  "won",
  "lost",
] as const;
export type LeadStage = (typeof LEAD_STAGES)[number];

export const OPEN_LEAD_STAGES = ["new", "qualification", "contact", "follow_up", "requirement", "quotation"] as const;
export type OpenLeadStage = (typeof OPEN_LEAD_STAGES)[number];

export function isOpenStage(stage: LeadStage): stage is OpenLeadStage {
  return (OPEN_LEAD_STAGES as readonly string[]).includes(stage);
}

export const STAGE_LABEL: Record<LeadStage, string> = {
  new: "New",
  qualification: "Qualification",
  contact: "Contact",
  follow_up: "Follow-up",
  requirement: "Requirement",
  quotation: "Quotation",
  won: "Won",
  lost: "Lost",
};

/** Position in the pipeline, used to move leads forward automatically (never backwards). */
export const STAGE_ORDER: Record<LeadStage, number> = {
  new: 0,
  qualification: 1,
  contact: 2,
  follow_up: 3,
  requirement: 4,
  quotation: 5,
  won: 6,
  lost: 6,
};

/**
 * The stage a lead should be in after something happened, moving forward only.
 * Closed leads (won/lost) never move automatically.
 */
export function advancedStage(current: LeadStage, reached: OpenLeadStage): LeadStage {
  if (!isOpenStage(current)) return current;
  return STAGE_ORDER[reached] > STAGE_ORDER[current] ? reached : current;
}

export const LEAD_SOURCES = [
  "employee",
  "phone_enquiry",
  "email_enquiry",
  "walk_in",
  "referral",
  "existing_customer",
  "website",
  "other",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const SOURCE_LABEL: Record<LeadSource, string> = {
  employee: "Found by a PTCC employee",
  phone_enquiry: "Phone enquiry",
  email_enquiry: "Email enquiry",
  walk_in: "Walk-in",
  referral: "Referral",
  existing_customer: "Existing customer",
  website: "Website",
  other: "Other",
};

/** How a lead entered the system. Photo/voice/text are AI-assisted capture (Phase 3). */
export const CAPTURE_METHODS = ["manual", "photo", "voice", "text"] as const;
export type CaptureMethod = (typeof CAPTURE_METHODS)[number];

export const AI_CAPTURE_METHODS = ["photo", "voice", "text"] as const;
export type AiCaptureMethod = (typeof AI_CAPTURE_METHODS)[number];

export const CAPTURE_METHOD_LABEL: Record<CaptureMethod, string> = {
  manual: "Typed into the form",
  photo: "Photo",
  voice: "Voice",
  text: "Typed description",
};

/** Languages voice capture must support (Phase 3). Stored data is language-independent. */
export const CAPTURE_LANGUAGES = ["en", "kn", "hi"] as const;
export type CaptureLanguage = (typeof CAPTURE_LANGUAGES)[number];
export const LANGUAGE_LABEL: Record<CaptureLanguage, string> = { en: "English", kn: "Kannada", hi: "Hindi" };
/** How each language names itself — shown next to the English name when choosing. */
export const LANGUAGE_NATIVE: Record<CaptureLanguage, string> = { en: "English", kn: "ಕನ್ನಡ", hi: "हिन्दी" };

/** A capture's language: chosen or detected; "unknown" when neither. */
export const DETECTED_LANGUAGES = ["en", "kn", "hi", "unknown"] as const;
export type DetectedLanguage = (typeof DETECTED_LANGUAGES)[number];

/**
 * A capture is a draft until the employee confirms it (exactly one lead is created) or
 * cancels it. "failed" = recognition or extraction failed; nothing was created.
 */
export const CAPTURE_STATUSES = ["draft", "confirmed", "discarded", "failed"] as const;
export type CaptureStatus = (typeof CAPTURE_STATUSES)[number];

export const CALL_OUTCOMES = ["connected", "no_answer", "busy", "switched_off", "wrong_number"] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const CALL_OUTCOME_LABEL: Record<CallOutcome, string> = {
  connected: "Connected",
  no_answer: "No answer",
  busy: "Busy",
  switched_off: "Switched off",
  wrong_number: "Wrong number",
};

export const ACTIVITY_KINDS = [
  "call",
  "note",
  "lead_created",
  "stage_changed",
  "assigned",
  "branch_assigned",
  "follow_up_scheduled",
  "follow_up_done",
  "requirement_added",
  "quotation_created",
  "quotation_status",
  "won",
  "lost",
  "reopened",
  "customer_linked",
] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const QUOTATION_STATUSES = ["draft", "sent", "accepted", "rejected"] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

export const QUOTATION_STATUS_LABEL: Record<QuotationStatus, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  rejected: "Rejected",
};

export function leadRef(number: number): string {
  return `L-${number}`;
}

export function quotationRef(number: number): string {
  return `Q-${number}`;
}
