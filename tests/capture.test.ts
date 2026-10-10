/**
 * Phase 3: AI-assisted lead capture with SIMULATED providers (no external service, no keys).
 * Photo, voice (English / Kannada / Hindi) and typed capture → draft → review → explicit
 * confirmation → exactly one lead through the normal lead-creation checks.
 */
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Ctx } from "@/server/context";
import type { DatabaseHandle } from "@/server/db/client";
import { auditLogs, contacts, leadCaptures, leads } from "@/server/db/schema";
import { ConflictError, ForbiddenError, NotFoundError, NotImplementedError, RateLimitError, ValidationError } from "@/server/errors";
import { captureAvailability, captureMode } from "@/server/integrations/ai";
import {
  CAPTURES_PER_HOUR,
  MAX_IMAGE_BYTES,
  confirmCapture,
  discardCapture,
  findCaptureDuplicates,
  getCaptureForReview,
  getLeadCaptureInfo,
  purgeAbandonedCaptures,
  startCapture,
  type CaptureView,
} from "@/modules/leads/capture-service";
import { getLead } from "@/modules/leads/queries";
import { createLead } from "@/modules/leads/service";
import {
  branchIdByName,
  contextFor,
  createTestCompany,
  createTestDatabase,
  createTestUser,
  importTestBranchDirectory,
  importTestScope,
} from "./support/db";

const NOW = new Date("2026-10-09T06:30:00Z"); // Friday 9 October, 12:00 in India
const SIMULATED = { mode: "simulated" as const };
const jpeg = (size = 2048) => {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
};
const webm = () => new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04]);

let handle: DatabaseHandle;
let bengaluru: string;
let hosur: string;
let hyderabad: string;
let rahul: Ctx; // Bengaluru marketing
let priya: Ctx; // Bengaluru coordinator
let arun: Ctx; // Bengaluru collection
let divya: Ctx; // Chennai marketing
let meena: Ctx; // Hosur marketing
let lavanya: Ctx; // Hyderabad marketing
let ceo: Ctx;
let nobody: Ctx; // signed in, no roles

const leadCount = async () => (await handle.db.select({ n: sql<number>`count(*)::int` }).from(leads))[0]!.n;
const captureRow = async (id: string) => (await handle.db.select().from(leadCaptures).where(eq(leadCaptures.id, id)))[0]!;
const ready = (result: Awaited<ReturnType<typeof startCapture>>): CaptureView => {
  if (result.status !== "ready") throw new Error(`expected a draft, got: ${result.message}`);
  return result.capture;
};

beforeAll(async () => {
  handle = await createTestDatabase();
  const db = handle.db;
  await importTestScope(db);
  await importTestBranchDirectory(db);
  bengaluru = await branchIdByName(db, "Bengaluru");
  hosur = await branchIdByName(db, "Hosur");
  hyderabad = await branchIdByName(db, "Hyderabad");
  const user = async (name: string, role: Parameters<typeof createTestUser>[1]["roles"][number], branchId: string | null) =>
    contextFor(db, await createTestUser(db, { name, roles: [role], branchId }), NOW);
  rahul = await user("Rahul Menon", "marketing", bengaluru);
  priya = await user("Priya Sharma", "hr", bengaluru);
  arun = await user("Arun Kumar", "collection", bengaluru);
  divya = await user("Divya Raman", "marketing", await branchIdByName(db, "Chennai"));
  meena = await user("Meena Rajan", "marketing", hosur);
  lavanya = await user("Lavanya Rao", "marketing", hyderabad);
  ceo = await user("Mohan Krishnan", "ceo", null);
  nobody = await contextFor(db, await createTestUser(db, { name: "No Roles", roles: [] }), NOW);
});

afterAll(async () => {
  await handle.close();
});

describe("provider selection", () => {
  it("is simulated outside production, off when asked, and never simulated in production", () => {
    expect(captureMode({ NODE_ENV: "development" })).toBe("simulated");
    expect(captureMode({ NODE_ENV: "test", CAPTURE_PROVIDER: "off" })).toBe("off");
    expect(captureMode({ NODE_ENV: "production", CAPTURE_PROVIDER: "simulated" })).toBe("off");
    expect(captureAvailability("off")).toEqual({ mode: "off", simulated: false, photo: false, voice: false, text: false });
  });

  it("refuses to capture when no provider is connected — nothing is pretended", async () => {
    await expect(startCapture(rahul, { method: "text", text: "Visited ABC" }, { mode: "off" })).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("is only for people who may add leads", async () => {
    await expect(startCapture(nobody, { method: "text", text: "Visited ABC" }, SIMULATED)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("photo capture", () => {
  it("returns a clearly simulated draft, keeps only a fingerprint of the photo, and creates no lead", async () => {
    const before = await leadCount();
    const image = jpeg();
    const capture = ready(await startCapture(rahul, { method: "photo", sample: "business-card", file: { bytes: image, type: "image/jpeg" } }, SIMULATED));
    expect(capture).toMatchObject({ method: "photo", simulated: true, sampleLabel: "Sample business card", mediaChecked: true });
    expect(capture.draft).toMatchObject({
      companyName: "Sri Lakshmi Industries",
      contactName: "Ravi Kumar",
      contactDesignation: "Maintenance Manager",
      contactPhone: "+919000090001",
      contactEmail: "ravi.kumar@srilakshmi.example",
      companyWebsite: "www.srilakshmi.example",
      city: "Hosur",
    });
    expect(capture.draft.requirement).toBeUndefined(); // not on a business card — not invented
    const row = await captureRow(capture.id);
    expect(row).toMatchObject({
      status: "draft",
      simulated: true,
      provider: "simulated",
      mediaType: "image/jpeg",
      mediaBytes: image.length,
      mediaSha256: createHash("sha256").update(image).digest("hex"),
      leadId: null,
    });
    expect(await leadCount()).toBe(before);
  });

  it("reads a company board as a name and an address only — no person, phone or email invented", async () => {
    const { draft } = ready(await startCapture(rahul, { method: "photo", sample: "company-board", file: { bytes: jpeg(), type: "image/jpeg" } }, SIMULATED));
    expect(draft.companyName).toBe("Kaveri Precision Forgings Pvt. Ltd.");
    expect([draft.contactName, draft.contactPhone, draft.contactEmail]).toEqual([undefined, undefined, undefined]);
  });

  it("refuses unsupported, oversized, empty and disguised files on the server", async () => {
    const count = async () => (await handle.db.select({ n: sql<number>`count(*)::int` }).from(leadCaptures))[0]!.n;
    const before = await count();
    const attempt = (file: { bytes: Uint8Array; type: string } | null) =>
      startCapture(rahul, { method: "photo", sample: "business-card", file }, SIMULATED);
    await expect(attempt({ bytes: jpeg(), type: "image/gif" })).rejects.toBeInstanceOf(ValidationError);
    await expect(attempt({ bytes: jpeg(MAX_IMAGE_BYTES + 1), type: "image/jpeg" })).rejects.toThrow("too large");
    await expect(attempt({ bytes: new TextEncoder().encode("not a photo"), type: "image/jpeg" })).rejects.toThrow("isn't a valid photo");
    await expect(attempt(null)).rejects.toThrow("Add a photo first.");
    expect(await count()).toBe(before);
  });

  it("reports a failed reading plainly and creates nothing", async () => {
    const before = await leadCount();
    const result = await startCapture(rahul, { method: "photo", sample: "blurred", file: { bytes: jpeg(), type: "image/jpeg" } }, SIMULATED);
    expect(result).toEqual({ status: "failed", message: expect.stringContaining("too blurred to read") });
    const [failed] = await handle.db
      .select()
      .from(leadCaptures)
      .where(and(eq(leadCaptures.capturedBy, rahul.actor.id), eq(leadCaptures.status, "failed")));
    expect(failed).toMatchObject({ originalText: null, draft: null, leadId: null });
    expect(await leadCount()).toBe(before);
  });
});

describe("voice capture in English, Kannada and Hindi", () => {
  it("keeps the original transcript in its language and gives language-independent fields", async () => {
    const results = await Promise.all(
      (["en", "kn", "hi"] as const).map(async (language) =>
        ready(await startCapture(meena, { method: "voice", language, sample: `${language}-visit`, file: { bytes: webm(), type: "audio/webm;codecs=opus" } }, SIMULATED)),
      ),
    );
    const [en, kn, hi] = results;
    expect(en).toMatchObject({ language: "en", draft: { companyName: "Deccan Gauges and Valves", contactDesignation: "Quality Manager" } });
    expect(kn!.originalText).toContain("ಹೊಸೂರಿನ"); // kept in Kannada
    expect(kn!.draft).toMatchObject({ companyName: "Sri Lakshmi Industries", requirement: "Torque wrench calibration", city: "Hosur" });
    expect(hi!.originalText).toContain("कैलिब्रेशन"); // kept in Hindi
    expect(hi!.draft).toMatchObject({ companyName: "Kaveri Pumps", requirement: "Temperature sensor calibration" });
    // "next Tuesday" said on Friday 9 October → an explicit date the employee must confirm.
    expect(kn!.draft).toMatchObject({ followUpDate: "2026-10-13", followUpPhrase: "next tuesday" });
    expect(kn!.draft.uncertain).toContain("followUpDate");
    expect(hi!.draft.followUpDate).toBeUndefined(); // nothing said about a follow-up — none invented
    expect(results.every((capture) => capture.simulated && capture.mediaChecked)).toBe(true);
  });

  it("needs a language, reports nothing recognised, and can run on a sample without a recording", async () => {
    await expect(startCapture(meena, { method: "voice", sample: "en-visit" }, SIMULATED)).rejects.toThrow("Choose the language");
    await expect(startCapture(meena, { method: "voice", language: "ta", sample: "en-visit" }, SIMULATED)).rejects.toBeInstanceOf(ValidationError);
    expect(await startCapture(meena, { method: "voice", language: "hi", sample: "hi-silence" }, SIMULATED)).toEqual({
      status: "failed",
      message: "Nothing was recognised. Try again, or type the details instead.",
    });
    const withoutRecording = ready(await startCapture(meena, { method: "voice", language: "en", sample: "en-visit" }, SIMULATED));
    expect(withoutRecording.mediaChecked).toBe(false);
    await expect(
      startCapture(meena, { method: "voice", language: "en", sample: "en-visit", file: { bytes: jpeg(), type: "audio/webm" } }, SIMULATED),
    ).rejects.toThrow("isn't a valid recording");
  });
});

describe("typed capture", () => {
  it("prepares the sample texts and detects their language", async () => {
    const en = ready(await startCapture(arun, { method: "text", text: "Visited ABC Manufacturing in Hosur. Spoke to Ravi from maintenance. Interested in calibration services. Call him next Tuesday." }, SIMULATED));
    expect(en).toMatchObject({ language: "en", draft: { companyName: "ABC Manufacturing", requirement: "Calibration services", followUpDate: "2026-10-13" } });
    expect(en.draft.uncertain).toEqual(expect.arrayContaining(["contactName", "followUpDate"]));
    const kn = ready(await startCapture(arun, { method: "text", text: "ಪೀಣ್ಯದ ವಿನಾಯಕ ಎಂಜಿನಿಯರಿಂಗ್‌ನ ಮಂಜುನಾಥ್ ಅವರಿಗೆ ವರ್ನಿಯರ್ ಕ್ಯಾಲಿಪರ್ ಕ್ಯಾಲಿಬ್ರೇಶನ್ ಬೇಕು. ಫೋನ್ 90000 90004." }, SIMULATED));
    expect(kn).toMatchObject({ language: "kn", draft: { companyName: "Vinayaka Engineering", contactPhone: "+919000090004" } });
  });

  it("gives other text only what a pattern can find for certain — no names or requirements invented", async () => {
    const capture = ready(await startCapture(arun, { method: "text", text: "Met a buyer at the fair. Call 98765 43210 tomorrow." }, SIMULATED));
    expect(capture.draft).toEqual({
      contactPhone: "+919876543210",
      followUpDate: "2026-10-10",
      followUpPhrase: "tomorrow",
      serviceMentions: [],
      uncertain: ["followUpDate"],
    });
    await expect(startCapture(arun, { method: "text", text: "  " }, SIMULATED)).rejects.toThrow("Describe the lead");
    await expect(startCapture(arun, { method: "text", text: "x".repeat(2001) }, SIMULATED)).rejects.toThrow("under 2000");
  });
});

describe("confirmation", () => {
  let existingCompany: string;

  beforeAll(async () => {
    existingCompany = await createTestCompany(handle.db, { name: "Sri Lakshmi Industries", branchIds: [hosur], area: "SIPCOT", contactName: "Ravi Kumar", contactPhone: "90000 90001" });
  });

  const reviewed = (overrides: Record<string, string | undefined> = {}) => ({
    companyName: "Sri Lakshmi Industries",
    contactName: "Ravi Kumar",
    contactDesignation: "Maintenance Manager",
    contactPhone: "90000 90001",
    contactEmail: "ravi.kumar@srilakshmi.example",
    companyWebsite: "www.srilakshmi.example",
    addressLine: "Plot 14, SIPCOT Phase II, Hosur 635109",
    area: "SIPCOT",
    city: "Hosur",
    requirement: "Pressure gauge calibration",
    ...overrides,
  });

  it("saves nothing until confirmed; a duplicate company is refused rather than created twice", async () => {
    const before = await leadCount();
    const capture = ready(await startCapture(rahul, { method: "photo", sample: "business-card", file: { bytes: jpeg(), type: "image/jpeg" } }, SIMULATED));
    expect(await leadCount()).toBe(before);
    // Typing the same company again would duplicate it — the existing record must be chosen.
    await expect(confirmCapture(rahul, { captureId: capture.id, lead: reviewed() })).rejects.toBeInstanceOf(ValidationError);
    expect((await captureRow(capture.id)).status).toBe("draft");
    expect(await leadCount()).toBe(before);
  });

  it("creates exactly one lead, in the employee's branch, with the capture recorded and audited", async () => {
    const capture = ready(await startCapture(rahul, { method: "photo", sample: "business-card", file: { bytes: jpeg(), type: "image/jpeg" } }, SIMULATED));
    const before = await leadCount();
    const { leadId, alreadyConfirmed } = await confirmCapture(rahul, {
      captureId: capture.id,
      lead: reviewed({ companyId: existingCompany, contactName: "Ravi K." }),
    });
    expect(alreadyConfirmed).toBe(false);
    expect(await leadCount()).toBe(before + 1);
    const lead = (await getLead(rahul, leadId))!;
    // The company is in Hosur, but the branch is the employee's own — never inferred from an address.
    expect(lead).toMatchObject({ branchId: bengaluru, companyId: existingCompany, ownerId: rahul.actor.id, captureMethod: "photo" });
    expect(await captureRow(capture.id)).toMatchObject({ status: "confirmed", leadId, editedFields: ["contactName", "requirement"] });
    const [audit] = await handle.db.select().from(auditLogs).where(and(eq(auditLogs.entityId, leadId), eq(auditLogs.action, "lead.create")));
    expect(audit!.summary).toContain("(captured by photo, simulated)");
    expect(audit!.changes).toMatchObject({ captureId: [null, capture.id], captureMethod: [null, "photo"], simulated: [null, true] });
    // An existing customer's records are not changed by the capture.
    const [ravi] = await handle.db.select().from(contacts).where(eq(contacts.companyId, existingCompany));
    expect(ravi!.designation).toBeNull();
    // The lead page shows how it was captured, to people who can see the lead only.
    expect(await getLeadCaptureInfo(rahul, leadId)).toMatchObject({ method: "photo", simulated: true, originalText: expect.stringContaining("SRI LAKSHMI") });
    expect(await getLeadCaptureInfo(divya, leadId)).toBeNull();
  });

  it("returns the same lead when confirmed again or twice at once — never a second lead", async () => {
    const capture = ready(await startCapture(meena, { method: "voice", language: "en", sample: "en-visit" }, SIMULATED));
    const before = await leadCount();
    const input = { captureId: capture.id, lead: { companyName: "Deccan Gauges and Valves", requirement: "Pressure gauge calibration", contactName: "Suresh" } };
    const [first, second] = await Promise.all([confirmCapture(meena, input), confirmCapture(meena, input)]);
    expect(first.leadId).toBe(second.leadId);
    expect([first.alreadyConfirmed, second.alreadyConfirmed].sort()).toEqual([false, true]);
    expect((await confirmCapture(meena, input)).leadId).toBe(first.leadId);
    expect(await leadCount()).toBe(before + 1);
  });

  it("schedules a suggested follow-up only when the employee confirms the date", async () => {
    const capture = ready(await startCapture(meena, { method: "voice", language: "kn", sample: "kn-visit" }, SIMULATED));
    const lead = { companyName: "Sri Lakshmi Industries Hosur Unit 2", requirement: "Torque wrench calibration" };
    const { leadId } = await confirmCapture(meena, { captureId: capture.id, lead });
    expect((await getLead(meena, leadId))!.nextFollowUp).toBeNull(); // the suggestion alone schedules nothing

    const accepted = ready(await startCapture(meena, { method: "voice", language: "kn", sample: "kn-visit" }, SIMULATED));
    const confirmed = await confirmCapture(meena, {
      captureId: accepted.id,
      editedTranscript: `${accepted.originalText} (corrected)`,
      lead: { ...lead, companyName: "Sri Lakshmi Industries Hosur Unit 3", followUpDate: accepted.draft.followUpDate },
    });
    expect((await getLead(meena, confirmed.leadId))!.nextFollowUp).toMatchObject({ dueDate: "2026-10-13" });
    expect(await captureRow(accepted.id)).toMatchObject({ originalText: accepted.originalText, editedText: `${accepted.originalText} (corrected)` });
  });

  it("cancelling creates nothing, clears the captured text, and can't be undone into a lead", async () => {
    const capture = ready(await startCapture(arun, { method: "text", text: "Call 98765 43210 tomorrow about gauges." }, SIMULATED));
    const before = await leadCount();
    await discardCapture(arun, capture.id);
    await discardCapture(arun, capture.id); // safe to repeat
    expect(await captureRow(capture.id)).toMatchObject({ status: "discarded", originalText: null, draft: null });
    await expect(confirmCapture(arun, { captureId: capture.id, lead: { companyName: "Gauge Buyer", requirement: "Gauges" } })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(await getCaptureForReview(arun, capture.id)).toBeNull();
    expect(await leadCount()).toBe(before);
  });

  it("keeps a capture private to the person who made it", async () => {
    const capture = ready(await startCapture(rahul, { method: "text", text: "Call 98765 43210 tomorrow." }, SIMULATED));
    expect(await getCaptureForReview(rahul, capture.id)).toMatchObject({ id: capture.id });
    expect(await getCaptureForReview(divya, capture.id)).toBeNull();
    expect(await getCaptureForReview(priya, capture.id)).toBeNull(); // not even the branch coordinator
    await expect(confirmCapture(divya, { captureId: capture.id, lead: { companyName: "X Ltd", requirement: "Y" } })).rejects.toBeInstanceOf(NotFoundError);
    await expect(discardCapture(divya, capture.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("branch rules on confirmation", () => {
  it("applies the same branch and owner checks as the manual form — payload changes don't get through", async () => {
    const capture = ready(await startCapture(rahul, { method: "text", text: "Call 98765 43211 tomorrow." }, SIMULATED));
    const lead = { companyName: "Payload Test Engineering", requirement: "Gauge calibration" };
    // Another branch — with or without its owner — is refused for an ordinary employee.
    await expect(confirmCapture(rahul, { captureId: capture.id, lead: { ...lead, branchId: hyderabad, ownerId: lavanya.actor.id } })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(confirmCapture(rahul, { captureId: capture.id, lead: { ...lead, branchId: hyderabad } })).rejects.toBeInstanceOf(ForbiddenError);
    // A made-up branch is refused too.
    await expect(
      confirmCapture(rahul, { captureId: capture.id, lead: { ...lead, branchId: "00000000-0000-4000-8000-000000000000" } }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await captureRow(capture.id)).status).toBe("draft"); // nothing half-saved
    // "Not sure" follows the existing unassigned-lead process: no branch, decided by the CEO or Admin.
    const { leadId } = await confirmCapture(rahul, { captureId: capture.id, lead: { ...lead, branchId: "" } });
    expect((await getLead(ceo, leadId))!.branchId).toBeNull();
  });
});

describe("duplicate detection", () => {
  let hosurCompany: string;
  let hosurLead: string;

  beforeAll(async () => {
    hosurCompany = await createTestCompany(handle.db, { name: "Hosur Gauge Works", branchIds: [hosur], contactName: "Gopal", contactPhone: "90000 90009" });
    await handle.db.update(contacts).set({ email: "gopal@hgw.example" }).where(eq(contacts.companyId, hosurCompany));
    ({ id: hosurLead } = await createLead(meena, { companyId: hosurCompany, requirement: "Dial gauge calibration" }));
  });

  it("finds a company by name, phone and email — another branch's company by name and place only", async () => {
    const forRahul = await findCaptureDuplicates(rahul, { companyName: "Hosur Gauge", phone: "90000 90009", email: "GOPAL@hgw.example" });
    expect(forRahul.companies).toEqual([
      expect.objectContaining({ id: hosurCompany, name: "Hosur Gauge Works", known: false, matchedOn: ["name", "phone", "email"], contactName: null }),
    ]);
    expect(forRahul.leads).toEqual([]); // Hosur's lead is not Rahul's to see
  });

  it("shows the branch's own staff and the CEO the contact and the open lead", async () => {
    const forMeena = await findCaptureDuplicates(meena, { phone: "+91 90000 90009" });
    expect(forMeena.companies[0]).toMatchObject({ id: hosurCompany, known: true, matchedOn: ["phone"], contactName: "Gopal" });
    expect(forMeena.leads.map((lead) => lead.id)).toEqual([hosurLead]);
    expect((await findCaptureDuplicates(ceo, { companyName: "hosur gauge works" })).leads.map((lead) => lead.id)).toEqual([hosurLead]);
    expect(await findCaptureDuplicates(rahul, { companyName: "zz" })).toEqual({ companies: [], leads: [] });
  });
});

describe("privacy and abuse controls", () => {
  it("clears drafts nobody confirmed or cancelled after 7 days", async () => {
    const capture = ready(await startCapture(lavanya, { method: "text", text: "Call 98765 43212 tomorrow." }, SIMULATED));
    await handle.db.update(leadCaptures).set({ createdAt: new Date(NOW.getTime() - 8 * 24 * 60 * 60 * 1000) }).where(eq(leadCaptures.id, capture.id));
    expect(await purgeAbandonedCaptures(handle.db, NOW)).toBeGreaterThanOrEqual(1);
    expect(await captureRow(capture.id)).toMatchObject({ status: "discarded", originalText: null, draft: null });
  });

  it(`limits each person to ${CAPTURES_PER_HOUR} captures an hour`, async () => {
    const busy = await contextFor(handle.db, await createTestUser(handle.db, { name: "Busy Person", roles: ["marketing"], branchId: bengaluru }), NOW);
    for (let i = 0; i < CAPTURES_PER_HOUR; i++) {
      await startCapture(busy, { method: "text", text: `Call 98765 4321${i % 10} tomorrow.` }, SIMULATED);
    }
    await expect(startCapture(busy, { method: "text", text: "One more" }, SIMULATED)).rejects.toBeInstanceOf(RateLimitError);
  });
});
