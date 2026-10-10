/**
 * Phase 3 refinement, confirmed by PTCC:
 * - A new lead — from the form or a capture — goes to the employee's own branch, or "Not sure
 *   which branch" (no branch; the CEO or Admin routes it). Only the CEO and Admin may put a new
 *   lead straight into another branch. The branch is never inferred from an address, a phone
 *   number or AI output.
 * - A lead with no branch notifies the CEO and every Admin — once each, and nobody else.
 * - Routing after creation is unchanged from Phase 2 (tests/phase2-rules.test.ts) and audited.
 * - A confirmed capture keeps its transcript with the lead, visible only to people who can see
 *   the lead. No photo, recording, draft copy or log of it is kept.
 */
import { createHash } from "node:crypto";
import { and, eq, ilike, or, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Ctx } from "@/server/context";
import type { DatabaseHandle } from "@/server/db/client";
import { activities, auditLogs, companies, leadCaptures, leads, notifications, taskEvents, tasks } from "@/server/db/schema";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { confirmCapture, getLeadCaptureInfo, startCapture, type CaptureView } from "@/modules/leads/capture-service";
import { getLead } from "@/modules/leads/queries";
import { assignLead, createLead, setLeadBranch } from "@/modules/leads/service";
import { branchIdByName, contextFor, createTestDatabase, createTestUser, importTestBranchDirectory, importTestScope } from "./support/db";

const NOW = new Date("2026-10-09T06:30:00Z");
const SIMULATED = { mode: "simulated" as const };
const MADE_UP_BRANCH = "00000000-0000-4000-8000-000000000000";

let handle: DatabaseHandle;
let bengaluru: string;
let chennai: string;
let hosur: string;
let hyderabad: string;

let ceo: Ctx;
let admin: Ctx;
let priya: Ctx; // Bengaluru coordinator
let sneha: Ctx; // Bengaluru marketing manager
let rahul: Ctx; // Bengaluru marketing
let kiran: Ctx; // Bengaluru marketing
let arun: Ctx; // Bengaluru collection
let karthik: Ctx; // Chennai coordinator
let divya: Ctx; // Chennai marketing
let srinivas: Ctx; // Hyderabad coordinator
let newcomer: Ctx; // Bengaluru-bound marketer whose branch is not set yet

const leadCount = async () => (await handle.db.select({ n: sql<number>`count(*)::int` }).from(leads))[0]!.n;
const captureRow = async (id: string) => (await handle.db.select().from(leadCaptures).where(eq(leadCaptures.id, id)))[0]!;
const auditOf = (entityId: string, action: string) =>
  handle.db.select().from(auditLogs).where(and(eq(auditLogs.entityId, entityId), eq(auditLogs.action, action)));
const inbox = (ctx: Ctx, leadId: string) =>
  handle.db.select({ type: notifications.type }).from(notifications).where(and(eq(notifications.recipientId, ctx.actor.id), eq(notifications.entityId, leadId)));
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
  chennai = await branchIdByName(db, "Chennai");
  hosur = await branchIdByName(db, "Hosur");
  hyderabad = await branchIdByName(db, "Hyderabad");
  const user = async (name: string, role: Parameters<typeof createTestUser>[1]["roles"][number], branchId: string | null) =>
    contextFor(db, await createTestUser(db, { name, roles: [role], branchId }), NOW);
  ceo = await user("Mohan Krishnan", "ceo", null);
  admin = await user("Deepa Nair", "admin", null);
  priya = await user("Priya Sharma", "hr", bengaluru);
  sneha = await user("Sneha Kulkarni", "marketing_manager", bengaluru);
  rahul = await user("Rahul Menon", "marketing", bengaluru);
  kiran = await user("Kiran Shetty", "marketing", bengaluru);
  arun = await user("Arun Kumar", "collection", bengaluru);
  karthik = await user("Karthik Iyer", "hr", chennai);
  divya = await user("Divya Raman", "marketing", chennai);
  srinivas = await user("Srinivas Reddy", "hr", hyderabad);
  newcomer = await user("New Joiner", "marketing", null);
});

afterAll(async () => {
  await handle.close();
});

describe("adding a lead with the form", () => {
  it("puts it in my own branch — by default or when I choose it", async () => {
    const { id } = await createLead(rahul, { companyName: "Peenya Precision", requirement: "Vernier calibration" });
    expect(await getLead(rahul, id)).toMatchObject({ branchId: bengaluru, ownerId: rahul.actor.id });
    const [audit] = await auditOf(id, "lead.create");
    expect(audit!.changes).toMatchObject({ branchId: [null, bengaluru] });

    const chosen = await createLead(arun, { companyName: "Bommasandra Tools", requirement: "Torque wrench calibration", branchId: bengaluru });
    expect(await getLead(arun, chosen.id)).toMatchObject({ branchId: bengaluru, ownerId: null }); // waits for the branch to assign it
    expect(await inbox(priya, chosen.id)).toEqual([{ type: "lead.needs_owner" }]);
  });

  it("refuses another branch for everyone working at branch level — employees, coordinators, marketing managers — and saves nothing", async () => {
    const before = await leadCount();
    for (const [i, ctx] of [arun, rahul, priya, sneha].entries()) {
      await expect(
        createLead(ctx, { companyName: `Elsewhere Instruments ${i}`, requirement: "Pressure gauge calibration", branchId: chennai }),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    // Naming that branch's marketer as owner doesn't get it through either.
    await expect(
      createLead(rahul, { companyName: "Elsewhere Instruments", requirement: "Pressure gauge calibration", branchId: chennai, ownerId: divya.actor.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await leadCount()).toBe(before);
    expect(await handle.db.select().from(companies).where(ilike(companies.name, "Elsewhere Instruments%"))).toEqual([]);
  });

  it("“Not sure which branch” saves it without a branch and without an owner, for the CEO or Admin to route", async () => {
    const { id } = await createLead(rahul, { companyName: "Ambattur Gauges", requirement: "Dial gauge calibration", branchId: "" });
    expect(await getLead(rahul, id)).toMatchObject({ branchId: null, ownerId: null, capturedByName: "Rahul Menon" });
    const [audit] = await auditOf(id, "lead.create");
    expect(audit!.changes).toMatchObject({ branchId: [null, null] });
    expect(await inbox(ceo, id)).toEqual([{ type: "lead.needs_branch" }]);
    expect(await inbox(admin, id)).toEqual([{ type: "lead.needs_branch" }]);
    // Admin sees it to route it; branch managers don't see branch-less leads.
    expect(await getLead(admin, id)).not.toBeNull();
    expect(await getLead(priya, id)).toBeNull();
    expect(await getLead(karthik, id)).toBeNull();
    // An owner can't be chosen before the branch is known.
    await expect(
      createLead(rahul, { companyName: "Ambattur Gauges 2", requirement: "Dial gauge calibration", branchId: "", ownerId: rahul.actor.id }),
    ).rejects.toMatchObject({ fieldErrors: { ownerId: expect.any(String) } });
  });

  it("refuses made-up and malformed branch IDs", async () => {
    const lead = { companyName: "Nowhere Ltd", requirement: "Calibration" };
    await expect(createLead(rahul, { ...lead, branchId: MADE_UP_BRANCH })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createLead(ceo, { ...lead, branchId: MADE_UP_BRANCH })).rejects.toBeInstanceOf(ValidationError);
    const malformed = { fieldErrors: { branchId: expect.any(String) } };
    await expect(createLead(rahul, { ...lead, branchId: "Chennai" })).rejects.toMatchObject(malformed);
    await expect(createLead(ceo, { ...lead, branchId: "Chennai" })).rejects.toMatchObject(malformed);
  });

  it("someone whose branch isn't set yet can only add a lead whose branch is unknown", async () => {
    const { id } = await createLead(newcomer, { companyName: "Jigani Labs", requirement: "Thermometer calibration" });
    expect(await getLead(newcomer, id)).toMatchObject({ branchId: null, ownerId: null });
    await expect(createLead(newcomer, { companyName: "Jigani Labs 2", requirement: "Thermometer calibration", branchId: bengaluru })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("lets the CEO and Admin add a lead straight to any branch — recorded in the audit log", async () => {
    const byCeo = await createLead(ceo, { companyName: "Kothapet Pumps", requirement: "Flow meter calibration", branchId: hyderabad });
    expect(await getLead(ceo, byCeo.id)).toMatchObject({ branchId: hyderabad, ownerId: null });
    expect((await auditOf(byCeo.id, "lead.create"))[0]).toMatchObject({ actorId: ceo.actor.id, changes: { branchId: [null, hyderabad] } });
    expect(await inbox(srinivas, byCeo.id)).toEqual([{ type: "lead.needs_owner" }]);

    const byAdmin = await createLead(admin, { companyName: "Guindy Meters", requirement: "Multimeter calibration", branchId: chennai });
    expect(await getLead(admin, byAdmin.id)).toMatchObject({ branchId: chennai, ownerId: null });
    expect((await auditOf(byAdmin.id, "lead.create"))[0]).toMatchObject({ actorId: admin.actor.id, changes: { branchId: [null, chennai] } });
    expect(await inbox(karthik, byAdmin.id)).toEqual([{ type: "lead.needs_owner" }]);
  });
});

describe("adding a lead by capture", () => {
  it("applies the same rule on confirmation — another branch is refused and the draft stays a draft", async () => {
    const capture = ready(await startCapture(rahul, { method: "text", text: "Met the buyer at a Chennai plant, call 98765 43201 tomorrow." }, SIMULATED));
    const lead = { companyName: "Chennai Plant Co", requirement: "Pressure gauge calibration" };
    const before = await leadCount();
    await expect(confirmCapture(rahul, { captureId: capture.id, lead: { ...lead, branchId: chennai } })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      confirmCapture(rahul, { captureId: capture.id, lead: { ...lead, branchId: chennai, ownerId: divya.actor.id } }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(confirmCapture(rahul, { captureId: capture.id, lead: { ...lead, branchId: MADE_UP_BRANCH } })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await captureRow(capture.id)).toMatchObject({ status: "draft", leadId: null });
    expect(await leadCount()).toBe(before);
    // Left as it is, the lead goes to my own branch — the place named in the capture changes nothing.
    const { leadId } = await confirmCapture(rahul, { captureId: capture.id, lead });
    expect(await getLead(rahul, leadId)).toMatchObject({ branchId: bengaluru, ownerId: rahul.actor.id, captureMethod: "text" });
  });

  it("“Not sure which branch” sends a captured lead through the same routing — audited", async () => {
    const capture = ready(await startCapture(arun, { method: "text", text: "Hosur customer wants weights calibrated, call 98765 43202 tomorrow." }, SIMULATED));
    const { leadId } = await confirmCapture(arun, { captureId: capture.id, lead: { companyName: "Hosur Weights", requirement: "Weights calibration", branchId: "" } });
    expect(await getLead(arun, leadId)).toMatchObject({ branchId: null, ownerId: null });
    expect((await auditOf(leadId, "lead.create"))[0]!.changes).toMatchObject({ branchId: [null, null], captureId: [null, capture.id] });
    expect(await inbox(ceo, leadId)).toEqual([{ type: "lead.needs_branch" }]);
    expect(await inbox(admin, leadId)).toEqual([{ type: "lead.needs_branch" }]);

    await setLeadBranch(admin, { leadId, branchId: hosur });
    expect((await auditOf(leadId, "lead.branch"))[0]).toMatchObject({ actorId: admin.actor.id, changes: { branchId: [null, hosur] } });
  });

  it("lets the CEO confirm a capture into any branch", async () => {
    const capture = ready(await startCapture(ceo, { method: "text", text: "Hyderabad visit: call 98765 43203 tomorrow." }, SIMULATED));
    const { leadId } = await confirmCapture(ceo, { captureId: capture.id, lead: { companyName: "Nagole Valves", requirement: "Valve testing", branchId: hyderabad } });
    expect(await getLead(ceo, leadId)).toMatchObject({ branchId: hyderabad });
  });
});

describe("routing after a lead is added (unchanged from Phase 2)", () => {
  it("Admin decides the branch of a “Not sure” lead, then that branch's coordinator assigns it — each step audited", async () => {
    const { id } = await createLead(rahul, { companyName: "Ambattur Forge", requirement: "Hardness tester calibration", branchId: "" });
    await expect(setLeadBranch(rahul, { leadId: id, branchId: chennai })).rejects.toBeInstanceOf(ForbiddenError); // the capturer can't
    await expect(setLeadBranch(priya, { leadId: id, branchId: bengaluru })).rejects.toBeInstanceOf(NotFoundError); // not in her branch

    await setLeadBranch(admin, { leadId: id, branchId: chennai });
    expect((await auditOf(id, "lead.branch"))[0]).toMatchObject({ actorId: admin.actor.id, changes: { branchId: [null, chennai] } });
    expect(await inbox(karthik, id)).toEqual([{ type: "lead.needs_owner" }]);

    await assignLead(karthik, { leadId: id, ownerId: divya.actor.id });
    expect((await auditOf(id, "lead.assign"))[0]).toMatchObject({ actorId: karthik.actor.id, changes: { ownerId: [null, divya.actor.id] } });
    expect(await inbox(divya, id)).toEqual([{ type: "lead.assigned" }]);
    await expect(assignLead(sneha, { leadId: id, ownerId: rahul.actor.id })).rejects.toBeInstanceOf(NotFoundError); // another branch's manager
  });

  it("branch managers assign within their branch; Admin reassigns anywhere; only the CEO and Admin move a lead between branches", async () => {
    const { id } = await createLead(rahul, { companyName: "Whitefield Scales", requirement: "Weighing scale calibration" });
    await assignLead(sneha, { leadId: id, ownerId: kiran.actor.id });
    expect((await auditOf(id, "lead.assign"))[0]).toMatchObject({ actorId: sneha.actor.id, changes: { ownerId: [rahul.actor.id, kiran.actor.id] } });
    await expect(assignLead(priya, { leadId: id, ownerId: divya.actor.id })).rejects.toBeInstanceOf(ValidationError); // not a Bengaluru marketer
    await expect(assignLead(rahul, { leadId: id, ownerId: rahul.actor.id })).rejects.toBeInstanceOf(ForbiddenError);

    await assignLead(admin, { leadId: id, ownerId: rahul.actor.id });
    expect((await auditOf(id, "lead.assign")).map((row) => row.actorId)).toContain(admin.actor.id);

    await expect(setLeadBranch(priya, { leadId: id, branchId: chennai })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setLeadBranch(sneha, { leadId: id, branchId: chennai })).rejects.toBeInstanceOf(ForbiddenError);
    await setLeadBranch(ceo, { leadId: id, branchId: hyderabad });
    expect((await auditOf(id, "lead.branch"))[0]).toMatchObject({
      actorId: ceo.actor.id,
      changes: { branchId: [bengaluru, hyderabad], ownerId: [rahul.actor.id, null] },
    });
  });
});

describe("captured transcripts", () => {
  const MARKER = "QX-7731";
  let leadId: string;
  let captureId: string;

  beforeAll(async () => {
    const consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method));
    try {
      const capture = ready(
        await startCapture(rahul, { method: "text", text: `Visited the stores at Yelahanka, reference ${MARKER}, call 98765 43204 tomorrow.` }, SIMULATED),
      );
      captureId = capture.id;
      ({ leadId } = await confirmCapture(rahul, {
        captureId,
        editedTranscript: `Visited the stores at Yelahanka, reference ${MARKER}-corrected, call 98765 43204 tomorrow.`,
        lead: { companyName: "Yelahanka Stores", requirement: "Thermometer calibration", followUpDate: "2026-10-10" },
      }));
      // Nothing about the capture was written to the server log.
      for (const spy of consoleSpies) {
        expect(spy.mock.calls.flat().some((arg) => String(arg).includes(MARKER))).toBe(false);
      }
    } finally {
      for (const spy of consoleSpies) spy.mockRestore();
    }
  });

  it("stay with the confirmed lead — no photo, recording or draft copy is kept", async () => {
    expect(await captureRow(captureId)).toMatchObject({
      status: "confirmed",
      leadId,
      originalText: expect.stringContaining(MARKER),
      editedText: expect.stringContaining(`${MARKER}-corrected`),
      draft: null,
      problems: null,
    });
    // A photo leaves only its fingerprint.
    const bytes = new Uint8Array(2048);
    bytes.set([0xff, 0xd8, 0xff, 0xe0]);
    const photo = ready(await startCapture(kiran, { method: "photo", sample: "business-card", file: { bytes, type: "image/jpeg" } }, SIMULATED));
    const { leadId: photoLead } = await confirmCapture(kiran, { captureId: photo.id, lead: { companyName: "Sri Lakshmi Industries", requirement: "Gauge calibration" } });
    const row = await captureRow(photo.id);
    expect(row).toMatchObject({ leadId: photoLead, mediaType: "image/jpeg", mediaBytes: 2048, draft: null });
    expect(row.mediaSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(Object.values(row).some((value) => value instanceof Uint8Array)).toBe(false);
  });

  it("are shown only to people who can see the lead — and follow the lead when it changes branch", async () => {
    for (const ctx of [rahul, priya, sneha, ceo, admin]) {
      expect(await getLeadCaptureInfo(ctx, leadId)).toMatchObject({ originalText: expect.stringContaining(MARKER) });
    }
    for (const ctx of [kiran, arun, karthik, divya, srinivas]) {
      expect(await getLeadCaptureInfo(ctx, leadId)).toBeNull();
    }
    await setLeadBranch(ceo, { leadId, branchId: chennai });
    expect(await getLeadCaptureInfo(karthik, leadId)).not.toBeNull();
    expect(await getLeadCaptureInfo(priya, leadId)).toBeNull();
    expect(await getLeadCaptureInfo(sneha, leadId)).toBeNull();
    expect(await getLeadCaptureInfo(rahul, leadId)).not.toBeNull(); // the person who captured it
  });

  it("are not copied into the lead's history, tasks, notifications or the audit log", async () => {
    const like = `%${MARKER}%`;
    const copies = await Promise.all([
      handle.db.select({ id: activities.id }).from(activities).where(or(ilike(activities.body, like), sql`${activities.meta}::text ilike ${like}`)),
      handle.db.select({ id: tasks.id }).from(tasks).where(or(ilike(tasks.title, like), ilike(tasks.details, like))),
      handle.db
        .select({ id: taskEvents.id })
        .from(taskEvents)
        .innerJoin(tasks, eq(tasks.id, taskEvents.taskId))
        .where(and(eq(tasks.leadId, leadId), sql`${taskEvents}::text ilike ${like}`)),
      handle.db.select({ id: notifications.id }).from(notifications).where(or(ilike(notifications.title, like), ilike(notifications.body, like))),
      handle.db.select({ id: auditLogs.id }).from(auditLogs).where(or(ilike(auditLogs.summary, like), sql`${auditLogs.changes}::text ilike ${like}`)),
      handle.db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, leadId), sql`${leads}::text ilike ${like}`)),
    ]);
    expect(copies).toEqual([[], [], [], [], [], []]);
    // The follow-up exists — so the task tables were really checked.
    expect(await handle.db.select({ id: tasks.id }).from(tasks).where(eq(tasks.leadId, leadId))).toHaveLength(1);
  });
});

describe("who is told about a lead with no branch", () => {
  let secondAdmin: Ctx;
  let bothRoles: Ctx; // holds the CEO and the Admin role
  let formerAdmin: string; // deactivated

  const recipientsOf = async (leadId: string, type: string) =>
    (
      await handle.db
        .select({ recipientId: notifications.recipientId })
        .from(notifications)
        .where(and(eq(notifications.entityId, leadId), eq(notifications.type, type)))
    )
      .map((row) => row.recipientId)
      .sort();
  const ids = (...people: Ctx[]) => people.map((ctx) => ctx.actor.id).sort();

  beforeAll(async () => {
    const db = handle.db;
    secondAdmin = await contextFor(db, await createTestUser(db, { name: "Second Admin", roles: ["admin"] }), NOW);
    bothRoles = await contextFor(db, await createTestUser(db, { name: "Both Roles", roles: ["ceo", "admin"] }), NOW);
    formerAdmin = await createTestUser(db, { name: "Former Admin", roles: ["admin"], status: "inactive" });
  });

  it("tells the CEO and every active Admin, once each, when an employee chooses “Not sure which branch” — and nobody else", async () => {
    const { id } = await createLead(rahul, { companyName: "Unsure Gauges", requirement: "Gauge calibration", branchId: "" });
    const sent = await handle.db
      .select({ recipientId: notifications.recipientId, type: notifications.type, title: notifications.title, body: notifications.body, href: notifications.href })
      .from(notifications)
      .where(eq(notifications.entityId, id));
    // Exactly one notice per company-wide router (the person with both roles too); none for branch staff or the former Admin.
    expect(sent.map((row) => row.recipientId).sort()).toEqual(ids(ceo, admin, secondAdmin, bothRoles));
    expect(sent.map((row) => row.recipientId)).not.toContain(formerAdmin);
    // Admin's notice is the same as the CEO's: the lead, what they need, and a link to route it.
    for (const row of sent) {
      expect(row).toMatchObject({ type: "lead.needs_branch", title: "New lead: Unsure Gauges — needs a branch", href: `/leads/${id}` });
      expect(row.body).toContain("Gauge calibration");
    }
  });

  it("does the same when a capture is confirmed with “Not sure which branch”", async () => {
    const capture = ready(await startCapture(divya, { method: "text", text: "Met a buyer at the expo, call 98765 43205 tomorrow." }, SIMULATED));
    const { leadId } = await confirmCapture(divya, {
      captureId: capture.id,
      lead: { companyName: "Expo Buyer Co", requirement: "Pressure gauge calibration", branchId: "" },
    });
    expect(await recipientsOf(leadId, "lead.needs_branch")).toEqual(ids(ceo, admin, secondAdmin, bothRoles));
    expect(await recipientsOf(leadId, "lead.needs_owner")).toEqual([]);
  });

  it("is only for leads with no branch, and never tells someone about a lead they added", async () => {
    // A lead with a branch goes to that branch's lead managers — not to the CEO or Admin.
    const known = await createLead(arun, { companyName: "Branch Known Ltd", requirement: "Weights calibration" });
    expect(await recipientsOf(known.id, "lead.needs_branch")).toEqual([]);
    expect(await recipientsOf(known.id, "lead.needs_owner")).toEqual(ids(priya, sneha));
    // An Admin who adds a lead with no branch isn't told about their own lead; the others are.
    const byAdmin = await createLead(admin, { companyName: "Admin Unsure Ltd", requirement: "Calibration", branchId: "" });
    expect(await recipientsOf(byAdmin.id, "lead.needs_branch")).toEqual(ids(ceo, secondAdmin, bothRoles));
  });

  it("leaves routing as it was: once Admin sets the branch, that branch's managers are asked for an owner", async () => {
    const { id } = await createLead(kiran, { companyName: "Route Me Ltd", requirement: "Torque wrench calibration", branchId: "" });
    await setLeadBranch(secondAdmin, { leadId: id, branchId: chennai });
    expect((await auditOf(id, "lead.branch"))[0]).toMatchObject({ actorId: secondAdmin.actor.id, changes: { branchId: [null, chennai] } });
    expect(await recipientsOf(id, "lead.needs_owner")).toEqual(ids(karthik));
    expect(await recipientsOf(id, "lead.needs_branch")).toEqual(ids(ceo, admin, secondAdmin, bothRoles)); // no second round
    await assignLead(karthik, { leadId: id, ownerId: divya.actor.id });
    expect((await auditOf(id, "lead.assign"))[0]).toMatchObject({ actorId: karthik.actor.id, changes: { ownerId: [null, divya.actor.id] } });
    expect(await recipientsOf(id, "lead.assigned")).toEqual(ids(divya));
  });
});
