import { describe, expect, it, vi } from "vitest";
import { draftToLeadForm, prepareLeadDraft, validateDraft, type CaptureProviders } from "./capture";

const BRANCHES = [
  { id: "b-blr", name: "Bengaluru" },
  { id: "b-che", name: "Chennai" },
  { id: "b-hos", name: "Hosur" },
];

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
      requirement: "Pressure gauge calibration, 12 gauges",
      followUpDate: "2026-10-12",
      followUpTime: "15:00",
      serviceMentions: ["pressure gauge"],
      uncertain: ["contactPhone", "notARealField"],
      createdBy: "someone-else", // not a draft field — dropped
    });
    expect(problems).toEqual([]);
    expect(draft).toEqual({
      companyName: "ABC Engineering",
      contactPhone: "+919845012345",
      requirement: "Pressure gauge calibration, 12 gauges",
      followUpDate: "2026-10-12",
      followUpTime: "15:00",
      serviceMentions: ["pressure gauge"],
      uncertain: ["contactPhone"],
    });
  });

  it("drops and reports bad fields without losing the good ones", () => {
    const { draft, problems } = validateDraft({
      companyName: "Sri Lakshmi Industries",
      contactPhone: "12345",
      contactEmail: "not-an-email",
      followUpDate: "next Tuesday",
      requirement: "x".repeat(501),
    });
    expect(draft.companyName).toBe("Sri Lakshmi Industries");
    expect(draft.contactPhone).toBeUndefined();
    expect(draft.contactEmail).toBeUndefined();
    expect(draft.followUpDate).toBeUndefined();
    expect(draft.requirement).toBeUndefined();
    expect(problems).toHaveLength(4);
  });

  it("refuses a time without a date, and output that isn't an object", () => {
    expect(validateDraft({ followUpTime: "10:30" }).draft.followUpTime).toBeUndefined();
    expect(validateDraft("ABC Engineering wants calibration").problems).toEqual([
      "Nothing usable was extracted. Enter the details by hand.",
    ]);
    expect(validateDraft(null).draft).toEqual({ serviceMentions: [], uncertain: [] });
  });
});

describe("prepareLeadDraft", () => {
  it("keeps the original Kannada transcript and returns a language-independent draft", async () => {
    const transcript = "ಎಬಿಸಿ ಎಂಜಿನಿಯರಿಂಗ್, ಪ್ರೆಶರ್ ಗೇಜ್ ಕ್ಯಾಲಿಬ್ರೇಶನ್ ಬೇಕು";
    const providers = fakeProviders({
      transcript,
      language: "kn",
      extracted: { companyName: "ABC Engineering", requirement: "Pressure gauge calibration", branchMention: "Bengaluru" },
    });
    const result = await prepareLeadDraft({ method: "voice", audio: new Uint8Array([1]), mimeType: "audio/webm", languageHint: "kn" }, providers);
    expect(result.original).toEqual({ method: "voice", language: "kn", text: transcript });
    expect(result.draft.companyName).toBe("ABC Engineering");
    expect(providers.extractor.extract).toHaveBeenCalledWith({ text: transcript, language: "kn" });
  });

  it("stops before extraction when nothing was recognised", async () => {
    const providers = fakeProviders({ transcript: "   ", language: "hi" });
    const result = await prepareLeadDraft({ method: "voice", audio: new Uint8Array([1]), mimeType: "audio/webm" }, providers);
    expect(result.problems).toHaveLength(1);
    expect(providers.extractor.extract).not.toHaveBeenCalled();
  });

  it("uses typed text as it is, and photos through OCR", async () => {
    const typed = fakeProviders({ extracted: { companyName: "XYZ Forgings" } });
    const fromText = await prepareLeadDraft({ method: "text", text: "XYZ Forgings needs torque wrench calibration", languageHint: "en" }, typed);
    expect(fromText.original).toEqual({ method: "text", language: "en", text: "XYZ Forgings needs torque wrench calibration" });
    expect(typed.speech.transcribe).not.toHaveBeenCalled();

    const photo = fakeProviders({ transcript: "Ravi Kumar\nQuality Manager\n98450 12345", language: "en", extracted: { contactName: "Ravi Kumar" } });
    const fromPhoto = await prepareLeadDraft({ method: "photo", image: new Uint8Array([1]), mimeType: "image/jpeg" }, photo);
    expect(photo.vision.read).toHaveBeenCalledOnce();
    expect(fromPhoto.draft.contactName).toBe("Ravi Kumar");
  });
});

describe("draftToLeadForm", () => {
  it("sets the branch only on an exact match with an active branch", () => {
    const base = { serviceMentions: [], uncertain: [] };
    expect(draftToLeadForm({ ...base, branchMention: "bengaluru" }, BRANCHES).branchId).toBe("b-blr");
    // Not an active branch, a nickname, or nothing said: never guessed — "needs assignment".
    expect(draftToLeadForm({ ...base, branchMention: "Mysuru" }, BRANCHES).branchId).toBe("");
    expect(draftToLeadForm({ ...base, branchMention: "Bangalore" }, BRANCHES).branchId).toBe("");
    expect(draftToLeadForm(base, BRANCHES).branchId).toBe("");
  });

  it("formats the phone for the form and leaves services to the scope search", () => {
    const values = draftToLeadForm(
      { companyName: "ABC Engineering", contactPhone: "+919845012345", serviceMentions: ["pressure gauge"], uncertain: [] },
      BRANCHES,
    );
    expect(values).toEqual({ companyName: "ABC Engineering", contactPhone: "98450 12345", branchId: "" });
  });
});
