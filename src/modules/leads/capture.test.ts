import { describe, expect, it, vi } from "vitest";
import {
  detectLanguage,
  draftToLeadForm,
  editedFieldsOf,
  extractByPattern,
  prepareLeadDraft,
  resolveRelativeDate,
  validateDraft,
  type CaptureProviders,
} from "./capture";

const BRANCHES = [
  { id: "b-blr", name: "Bengaluru" },
  { id: "b-che", name: "Chennai" },
  { id: "b-hos", name: "Hosur" },
  { id: "b-hyd", name: "Hyderabad" },
];
const FRIDAY = "2026-10-09"; // a Friday in company time

function fakeProviders(overrides: Partial<{ transcript: string; language: "en" | "kn" | "hi" | "unknown"; extracted: unknown }> = {}) {
  const providers: CaptureProviders = {
    speech: { transcribe: vi.fn(async () => ({ text: overrides.transcript ?? "", language: overrides.language ?? "unknown" })) },
    vision: { read: vi.fn(async () => ({ text: overrides.transcript ?? "", language: overrides.language ?? "unknown" })) },
    extractor: { extract: vi.fn(async () => overrides.extracted) },
  };
  return providers;
}

describe("validateDraft", () => {
  it("keeps valid fields in canonical form and ignores unknown ones", () => {
    const { draft, problems } = validateDraft({
      companyName: "  ABC Engineering ",
      contactPhone: "098450 12345",
      contactEmail: "Ravi@ABC.example",
      contactDesignation: "Maintenance Manager",
      companyWebsite: "www.abc.example",
      requirement: "Pressure gauge calibration, 12 gauges",
      serviceMentions: ["pressure gauge"],
      uncertain: ["contactPhone", "notARealField"],
      createdBy: "someone-else", // not a draft field — dropped
    });
    expect(problems).toEqual([]);
    expect(draft).toEqual({
      companyName: "ABC Engineering",
      contactPhone: "+919845012345",
      contactEmail: "ravi@abc.example",
      contactDesignation: "Maintenance Manager",
      companyWebsite: "www.abc.example",
      requirement: "Pressure gauge calibration, 12 gauges",
      serviceMentions: ["pressure gauge"],
      uncertain: ["contactPhone"],
    });
  });

  it("drops and reports bad fields without losing the good ones", () => {
    const { draft, problems } = validateDraft({
      companyName: "Sri Lakshmi Industries",
      contactPhone: "12345",
      contactEmail: "not-an-email",
      companyWebsite: "not a website",
      followUpDate: "next Tuesday",
      requirement: "x".repeat(501),
    });
    expect(draft.companyName).toBe("Sri Lakshmi Industries");
    expect([draft.contactPhone, draft.contactEmail, draft.companyWebsite, draft.followUpDate, draft.requirement]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(problems).toHaveLength(5);
  });

  it("treats every follow-up date as needing the employee's confirmation", () => {
    expect(validateDraft({ followUpDate: "2026-10-13" }).draft.uncertain).toContain("followUpDate");
    expect(validateDraft({ followUpTime: "10:30" }).draft.followUpTime).toBeUndefined();
  });

  it("refuses output that isn't an object", () => {
    expect(validateDraft("ABC Engineering wants calibration").problems).toEqual(["Nothing usable was extracted. Enter the details by hand."]);
    expect(validateDraft(null).draft).toEqual({ serviceMentions: [], uncertain: [] });
  });
});

describe("prepareLeadDraft", () => {
  it("keeps the original Kannada transcript and passes today to the extractor", async () => {
    const transcript = "ಎಬಿಸಿ ಎಂಜಿನಿಯರಿಂಗ್, ಪ್ರೆಶರ್ ಗೇಜ್ ಕ್ಯಾಲಿಬ್ರೇಶನ್ ಬೇಕು";
    const providers = fakeProviders({ transcript, language: "kn", extracted: { companyName: "ABC Engineering" } });
    const result = await prepareLeadDraft({ method: "voice", audio: new Uint8Array([1]), mimeType: "audio/webm", languageHint: "kn" }, providers, {
      today: FRIDAY,
    });
    expect(result.original).toEqual({ method: "voice", language: "kn", text: transcript });
    expect(result.draft.companyName).toBe("ABC Engineering");
    expect(providers.extractor.extract).toHaveBeenCalledWith({ text: transcript, language: "kn", today: FRIDAY });
  });

  it("stops before extraction when nothing was recognised", async () => {
    const providers = fakeProviders({ transcript: "   ", language: "hi" });
    const result = await prepareLeadDraft({ method: "voice", audio: new Uint8Array([1]), mimeType: "audio/webm" }, providers);
    expect(result.problems).toHaveLength(1);
    expect(providers.extractor.extract).not.toHaveBeenCalled();
  });

  it("detects the language of typed text when none is chosen", async () => {
    const providers = fakeProviders({ extracted: {} });
    const result = await prepareLeadDraft({ method: "text", text: "हैदराबाद की श्री साई टूल्स" }, providers, { today: FRIDAY });
    expect(result.original.language).toBe("hi");
    expect(providers.speech.transcribe).not.toHaveBeenCalled();
  });
});

describe("language, dates and patterns", () => {
  it("detects Kannada, Hindi and English by script", () => {
    expect(detectLanguage("ಪೀಣ್ಯದ ವಿನಾಯಕ ಎಂಜಿನಿಯರಿಂಗ್ 90000 90004")).toBe("kn");
    expect(detectLanguage("उन्हें तापमान सेंसर का कैलिब्रेशन ABC")).toBe("hi");
    expect(detectLanguage("Visited ABC Manufacturing")).toBe("en");
    expect(detectLanguage("90000 90004")).toBe("unknown");
  });

  it("turns 'when' words into explicit dates, flagging the ambiguous ones", () => {
    expect(resolveRelativeDate("today", FRIDAY)).toEqual({ date: "2026-10-09", ambiguous: false });
    expect(resolveRelativeDate("Tomorrow", FRIDAY)).toEqual({ date: "2026-10-10", ambiguous: false });
    expect(resolveRelativeDate("day after tomorrow", FRIDAY)).toEqual({ date: "2026-10-11", ambiguous: false });
    expect(resolveRelativeDate("in 3 days", FRIDAY)).toEqual({ date: "2026-10-12", ambiguous: false });
    expect(resolveRelativeDate("next Tuesday", FRIDAY)).toEqual({ date: "2026-10-13", ambiguous: true });
    expect(resolveRelativeDate("this friday", FRIDAY)).toEqual({ date: "2026-10-09", ambiguous: false });
    expect(resolveRelativeDate("next friday", FRIDAY)).toEqual({ date: "2026-10-16", ambiguous: true });
    expect(resolveRelativeDate("sometime soon", FRIDAY)).toBeNull();
    expect(resolveRelativeDate("in 99 days", FRIDAY)).toBeNull();
  });

  it("finds phones, emails, websites and dates — never names or requirements", () => {
    const found = extractByPattern("Met a buyer at the trade fair. Call 98765 43210 tomorrow, or mail info@acme.example — see www.acme.example.", FRIDAY);
    expect(found).toEqual({
      contactPhone: "+919876543210",
      contactEmail: "info@acme.example",
      companyWebsite: "www.acme.example",
      followUpDate: "2026-10-10",
      followUpPhrase: "tomorrow",
      uncertain: ["followUpDate"],
      problems: [],
    });
    expect(found).not.toHaveProperty("companyName");
    expect(found).not.toHaveProperty("contactName");
    expect(found).not.toHaveProperty("requirement");
  });

  it("flags several phone numbers instead of choosing silently", () => {
    const found = extractByPattern("Numbers: 98765 43210 and 91234 56780", FRIDAY);
    expect(found.contactPhone).toBe("+919876543210");
    expect(found.uncertain).toContain("contactPhone");
    expect(found.problems).toEqual(["2 phone numbers were found — check which one is the contact's."]);
  });
});

describe("draftToLeadForm", () => {
  const base = { serviceMentions: [], uncertain: [] };

  it("defaults to the employee's own branch — never inferred from the capture", () => {
    expect(draftToLeadForm({ ...base, city: "Hosur" }, BRANCHES, "b-blr")).toMatchObject({ branchId: "b-blr", branchHint: null });
    // Not from an address or a phone number either.
    const chennaiDetails = { ...base, addressLine: "12 Ambattur Industrial Estate, Chennai 600058", city: "Chennai", contactPhone: "+914426250000" };
    expect(draftToLeadForm(chennaiDetails, BRANCHES, "b-blr")).toMatchObject({ branchId: "b-blr", branchHint: null });
    // A branch named in the capture is only offered as a hint.
    expect(draftToLeadForm({ ...base, branchMention: "hyderabad" }, BRANCHES, "b-blr")).toMatchObject({
      branchId: "b-blr",
      branchHint: { id: "b-hyd", name: "Hyderabad" },
    });
    expect(draftToLeadForm({ ...base, branchMention: "Bangalore" }, BRANCHES, "b-blr").branchHint).toBeNull();
    expect(draftToLeadForm({ ...base, branchMention: "Bengaluru" }, BRANCHES, "b-blr").branchHint).toBeNull();
    expect(draftToLeadForm(base, BRANCHES, "").branchId).toBe("");
  });

  it("formats the phone and keeps a follow-up as a suggestion, not a value", () => {
    const form = draftToLeadForm(
      { ...base, companyName: "ABC Engineering", contactPhone: "+919845012345", followUpDate: "2026-10-13", followUpPhrase: "next tuesday", uncertain: ["followUpDate"] },
      BRANCHES,
      "b-blr",
    );
    expect(form.values).toMatchObject({ companyName: "ABC Engineering", contactPhone: "98450 12345", requirement: "" });
    expect(form.suggestedFollowUp).toEqual({ date: "2026-10-13", time: null, phrase: "next tuesday" });
  });
});

describe("editedFieldsOf", () => {
  it("lists what the employee changed, comparing phones normalised", () => {
    const draft = { companyName: "ABC Engineering", contactPhone: "+919845012345", serviceMentions: [], uncertain: [] };
    expect(editedFieldsOf(draft, { companyName: "ABC Engineering", contactPhone: "98450 12345", requirement: "Gauge calibration" })).toEqual([
      "requirement",
    ]);
    expect(editedFieldsOf(draft, { companyName: "ABC Engg", contactPhone: "98450 12345" })).toEqual(["companyName"]);
  });
});
