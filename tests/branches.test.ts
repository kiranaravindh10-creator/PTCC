/**
 * Phase 2: multi-branch isolation, leads, customers, the service catalogue and CEO visibility.
 * Runs against PTCC's real scope file (Bengaluru CC-2467, Chennai CC-2822, Hosur CC-3649).
 */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Ctx } from "@/server/context";
import type { DatabaseHandle } from "@/server/db/client";
import { auditLogs, companies, companyBranches, leads, notifications, tasks, users } from "@/server/db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { createBranch, listBranches, setBranchStatus } from "@/modules/branches/service";
import { searchScope } from "@/modules/catalogue/queries";
import { getCustomer, listCustomers, suggestCompanies } from "@/modules/customers/queries";
import { createCustomer, setBranchRelationship } from "@/modules/customers/service";
import { branchComparison, marketingMetrics, marketingPerformance } from "@/modules/insights/queries";
import { getLead, getLeadRequirements, listActivities, listLeads } from "@/modules/leads/queries";
import {
  addLeadNote,
  addRequirement,
  assignLead,
  changeStage,
  createLead,
  createQuotation,
  logCall,
  markLost,
  markWon,
  scheduleFollowUp,
  setLeadBranch,
  setQuotationStatus,
} from "@/modules/leads/service";
import { getTask, listWork } from "@/modules/tasks/queries";
import { assignTask, createTask, transitionTask } from "@/modules/tasks/service";
import {
  branchIdByName,
  contextFor,
  createTestCompany,
  createTestDatabase,
  createTestUser,
  importTestScope,
} from "./support/db";

let handle: DatabaseHandle;
let bengaluru: string;
let chennai: string;
let hosur: string;

// Company level
let ceo: Ctx;
// Bengaluru
let priya: Ctx; // HR / coordinator
let sneha: Ctx; // marketing manager
let rahul: Ctx; // marketing
let arun: Ctx; // collection
let fathima: Ctx; // accounts
// Chennai
let karthik: Ctx; // HR / coordinator
let divya: Ctx; // marketing
// Hosur
let hosurCollector: Ctx;

let abcId: string; // ABC Engineering — Bengaluru customer

const audit = (entityId: string) => handle.db.select().from(auditLogs).where(eq(auditLogs.entityId, entityId));
const inbox = (ctx: Ctx) => handle.db.select().from(notifications).where(eq(notifications.recipientId, ctx.actor.id));

beforeAll(async () => {
  handle = await createTestDatabase();
  const db = handle.db;
  await importTestScope(db);
  bengaluru = await branchIdByName(db, "Bengaluru");
  chennai = await branchIdByName(db, "Chennai");
  hosur = await branchIdByName(db, "Hosur");

  const user = async (name: string, role: Parameters<typeof createTestUser>[1]["roles"][number], branchId: string | null) =>
    contextFor(db, await createTestUser(db, { name, roles: [role], branchId }));
  ceo = await user("Mohan Krishnan", "ceo", null);
  priya = await user("Priya Sharma", "hr", bengaluru);
  sneha = await user("Sneha Kulkarni", "marketing_manager", bengaluru);
  rahul = await user("Rahul Menon", "marketing", bengaluru);
  arun = await user("Arun Kumar", "collection", bengaluru);
  fathima = await user("Fathima Begum", "accounts", bengaluru);
  karthik = await user("Karthik Subramanian", "hr", chennai);
  divya = await user("Divya Raman", "marketing", chennai);
  hosurCollector = await user("Hosur Collector", "collection", hosur);

  abcId = await createTestCompany(db, {
    name: "ABC Engineering",
    area: "Peenya",
    branchIds: [bengaluru],
    contactName: "Rajesh",
    contactPhone: "9000010001",
  });
});

afterAll(async () => {
  await handle.close();
});

describe("service catalogue (PTCC's accredited scope)", () => {
  it("finds pressure gauge calibration with the branches where it is accredited", async () => {
    const result = await searchScope(rahul, { query: "pressure gauge" });
    expect(result.groups.length).toBeGreaterThan(0);
    const branchesFound = new Set(result.groups.flatMap((g) => g.entries.map((e) => e.branchName)));
    expect(branchesFound).toEqual(new Set(["Bengaluru", "Chennai", "Hosur"]));
    for (const entry of result.groups.flatMap((g) => g.entries)) {
      expect(entry.certificateNumber).toMatch(/^CC-(2467|2822|3649)$/);
      expect(entry.rangeText).not.toBe("");
      expect(entry.cmcText).not.toBe("");
    }
  });

  it("can be narrowed to one branch", async () => {
    const result = await searchScope(rahul, { query: "pressure gauge", branchId: chennai });
    expect(result.groups.flatMap((g) => g.entries).every((e) => e.branchName === "Chennai")).toBe(true);
  });

  it("returns nothing for instruments outside PTCC's scope — it never claims accreditation", async () => {
    const result = await searchScope(rahul, { query: "spectrophotometer" });
    expect(result.groups).toEqual([]);
  });
});

describe("creating leads", () => {
  it("creates the company, contact and lead in one step, owned by the marketer, with an audit entry", async () => {
    const [service] = (await searchScope(rahul, { query: "pressure gauge", branchId: bengaluru })).groups;
    const { id } = await createLead(rahul, {
      companyName: "Vertex Precision Tools",
      area: "Whitefield",
      city: "Bengaluru",
      contactName: "Anitha",
      contactPhone: "9000010003",
      requirement: "Pressure gauge calibration, 12 nos",
      scopeEntryIds: [service!.entries[0]!.id],
      source: "phone_enquiry",
    });
    const lead = await getLead(rahul, id);
    expect(lead).toMatchObject({
      companyName: "Vertex Precision Tools",
      contactName: "Anitha",
      contactPhone: "+919000010003",
      branchName: "Bengaluru",
      ownerName: "Rahul Menon",
      stage: "new",
    });
    const [requirement] = await getLeadRequirements(rahul, lead!);
    expect(requirement!.status).toEqual({ kind: "in_scope", branchName: "Bengaluru" });
    expect((await audit(id)).map((a) => a.action)).toContain("lead.create");

    // The company is now linked to Bengaluru as a prospect.
    const [link] = await handle.db.select().from(companyBranches).where(eq(companyBranches.companyId, lead!.companyId));
    expect(link).toMatchObject({ branchId: bengaluru, relationship: "prospect" });
  });

  it("refuses to create a duplicate company and points to the existing one", async () => {
    const error = await createLead(rahul, { companyName: "M/s ABC Engineering Pvt. Ltd.", requirement: "Anything" }).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors.companyName).toContain("“ABC Engineering” (Peenya) already exists");
  });

  it("marks free-text requirements as not confirmed, never as accredited", async () => {
    const { id } = await createLead(rahul, { companyId: abcId, requirement: "Spectrophotometer verification" });
    await addRequirement(rahul, { leadId: id, description: "UV-Vis spectrophotometer" });
    const lead = await getLead(rahul, id);
    const [requirement] = await getLeadRequirements(rahul, lead!);
    expect(requirement!.status.kind).toBe("not_confirmed");
  });

  it("lets anyone capture a lead for another branch, and routes it to that branch's managers", async () => {
    const { id } = await createLead(arun, {
      companyName: "Coromandel Gauges",
      area: "Ambattur",
      requirement: "Temperature calibration",
      branchId: chennai,
    });
    const lead = await getLead(arun, id); // the capturer can still see it
    expect(lead).toMatchObject({ branchName: "Chennai", ownerId: null, capturedByName: "Arun Kumar" });
    expect((await inbox(karthik)).some((n) => n.entityId === id && n.type === "lead.needs_owner")).toBe(true);
    // …but cannot work it.
    await expect(logCall(arun, { leadId: id, outcome: "connected" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("marks an unknown branch as 'needs a branch' instead of guessing, and only the CEO can decide it", async () => {
    const { id } = await createLead(arun, { companyName: "Unknown Location Labs", requirement: "Weighing balance", branchId: "" });
    expect((await getLead(arun, id))!.branchId).toBeNull();
    expect((await inbox(ceo)).some((n) => n.entityId === id && n.type === "lead.needs_branch")).toBe(true);
    expect(await getLead(priya, id)).toBeNull(); // a branch coordinator doesn't see branch-less leads
    await expect(setLeadBranch(priya, { leadId: id, branchId: bengaluru })).rejects.toBeInstanceOf(NotFoundError);

    await setLeadBranch(ceo, { leadId: id, branchId: hosur });
    expect((await getLead(ceo, id))!.branchName).toBe("Hosur");
    expect((await audit(id)).map((a) => a.action)).toContain("lead.branch");
  });
});

describe("assigning leads", () => {
  let leadId: string;

  beforeAll(async () => {
    ({ id: leadId } = await createLead(priya, { companyId: abcId, requirement: "Torque wrench calibration" }));
  });

  it("starts without an owner when created by a coordinator", async () => {
    expect((await getLead(priya, leadId))!.ownerId).toBeNull();
    const needsOwner = await listLeads(sneha, { view: "needs_owner" });
    expect(needsOwner.map((l) => l.id)).toContain(leadId);
  });

  it("refuses follow-ups until the lead has an owner — with a message the person sees, and nothing half-saved", async () => {
    const attempt = logCall(sneha, { leadId, outcome: "connected", followUpDate: "2026-10-12" });
    await expect(attempt).rejects.toThrow("Assign the lead to someone before scheduling follow-ups.");
    // A plain message (no field errors), so every form that can trigger it displays it.
    await expect(attempt).rejects.toMatchObject({ fieldErrors: {} });
    const calls = (await listActivities(sneha, { leadId })).filter((activity) => activity.kind === "call");
    expect(calls).toHaveLength(0);
  });

  it("lets branch managers assign to marketers of the same branch only", async () => {
    await expect(assignLead(sneha, { leadId, ownerId: divya.actor.id })).rejects.toBeInstanceOf(ValidationError);
    // A marketer can't even see a lead that isn't theirs — so it is "not found", not "forbidden".
    await expect(assignLead(rahul, { leadId, ownerId: rahul.actor.id })).rejects.toBeInstanceOf(NotFoundError);
    const { ownerName } = await assignLead(sneha, { leadId, ownerId: rahul.actor.id });
    expect(ownerName).toBe("Rahul Menon");
    expect((await inbox(rahul)).some((n) => n.entityId === leadId && n.type === "lead.assigned")).toBe(true);
    expect((await audit(leadId)).map((a) => a.action)).toContain("lead.assign");
  });

  it("does not let another branch's coordinator assign it", async () => {
    await expect(assignLead(karthik, { leadId, ownerId: divya.actor.id })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("working a lead: calls, follow-ups, quotation, won → customer", () => {
  let leadId: string;
  let companyId: string;

  beforeAll(async () => {
    companyId = await createTestCompany(handle.db, { name: "Nandi Auto Components", area: "Bidadi", branchIds: [], contactName: "Prakash", contactPhone: "9000010005" });
    ({ id: leadId } = await createLead(rahul, { companyId, requirement: "Pressure gauge calibration", contactPhone: "9000010005" }));
  });

  it("records calls with outcomes and moves the lead to Contact on a connected call", async () => {
    await logCall(rahul, { leadId, outcome: "no_answer" });
    expect((await getLead(rahul, leadId))!.stage).toBe("new");
    await logCall(rahul, { leadId, outcome: "connected", notes: "Needs 12 gauges calibrated" });
    expect((await getLead(rahul, leadId))!.stage).toBe("contact");
    const calls = (await listActivities(rahul, { leadId })).filter((a) => a.kind === "call");
    expect(calls.map((c) => c.callOutcome).sort()).toEqual(["connected", "no_answer"]);
  });

  it("schedules a follow-up into the owner's My Work and moves the lead to Follow-up", async () => {
    await scheduleFollowUp(rahul, { leadId, dueDate: "2026-10-09", dueTime: "15:00" });
    const lead = await getLead(rahul, leadId);
    expect(lead!.stage).toBe("follow_up");
    expect(lead!.nextFollowUp).toMatchObject({ dueDate: "2026-10-09", dueTime: "15:00" });
    const myWork = await listWork(rahul, { scope: "mine", view: "open" });
    const followUp = myWork.find((t) => t.leadId === leadId);
    expect(followUp).toMatchObject({ kind: "follow_up", companyName: "Nandi Auto Components", branchName: "Bengaluru" });
  });

  it("completing the follow-up is written to the lead's history", async () => {
    const followUp = (await listWork(rahul, { scope: "mine", view: "open" })).find((t) => t.leadId === leadId)!;
    await transitionTask(rahul, { taskId: followUp.id, action: "complete" });
    expect((await listActivities(rahul, { leadId })).some((a) => a.kind === "follow_up_done")).toBe(true);
  });

  it("creates a quotation (prices typed by the marketer) and moves the lead to Quotation", async () => {
    const { id: quotationId } = await createQuotation(rahul, {
      leadId,
      lines: [{ description: "Pressure gauge calibration", quantity: 12, unitPrice: "1,250" }],
    });
    expect((await getLead(rahul, leadId))!.stage).toBe("quotation");
    await setQuotationStatus(rahul, { quotationId, status: "sent" });
    await setQuotationStatus(rahul, { quotationId, status: "accepted" });
    await expect(setQuotationStatus(rahul, { quotationId, status: "sent" })).rejects.toBeInstanceOf(ConflictError);
    expect((await audit(quotationId)).map((a) => a.action)).toEqual(expect.arrayContaining(["quotation.create", "quotation.status"]));
  });

  it("marking won makes the company a customer of the branch, valued from the accepted quotation", async () => {
    await markWon(rahul, { leadId });
    const lead = await getLead(rahul, leadId);
    expect(lead).toMatchObject({ stage: "won", wonValuePaise: 1_500_000 });
    const [link] = await handle.db
      .select()
      .from(companyBranches)
      .where(and(eq(companyBranches.companyId, companyId), eq(companyBranches.branchId, bengaluru)));
    expect(link!.relationship).toBe("customer");
    expect(link!.becameCustomerAt).toBeInstanceOf(Date);
    await expect(markWon(rahul, { leadId })).rejects.toBeInstanceOf(ConflictError);
    expect((await audit(leadId)).map((a) => a.action)).toContain("lead.won");
  });

  it("marking lost needs a reason and cancels open follow-ups", async () => {
    const { id } = await createLead(rahul, { companyId, requirement: "Thermocouple calibration" });
    await logCall(rahul, { leadId: id, outcome: "connected", followUpDate: "2026-10-12" });
    await expect(markLost(rahul, { leadId: id, reason: "" })).rejects.toBeInstanceOf(ValidationError);
    await markLost(rahul, { leadId: id, reason: "Chose another lab" });
    const open = await handle.db
      .select()
      .from(tasks)
      .where(and(eq(tasks.leadId, id), eq(tasks.status, "assigned")));
    expect(open).toEqual([]);
    await expect(changeStage(rahul, { leadId: id, stage: "follow_up" })).rejects.toBeInstanceOf(ConflictError);
  });
});

describe("branch isolation — changing IDs never reveals another branch", () => {
  let bengaluruLead: string;
  let bengaluruPickup: string;

  beforeAll(async () => {
    ({ id: bengaluruLead } = await createLead(rahul, { companyId: abcId, requirement: "Vernier caliper calibration" }));
    ({ id: bengaluruPickup } = await createTask(priya, {
      kind: "pickup",
      title: "Collect calipers",
      companyId: abcId,
      assigneeId: arun.actor.id,
    }));
  });

  it("hides Bengaluru leads from Chennai staff, on every path", async () => {
    expect(await getLead(divya, bengaluruLead)).toBeNull();
    expect(await getLead(karthik, bengaluruLead)).toBeNull();
    await expect(logCall(divya, { leadId: bengaluruLead, outcome: "connected" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(addLeadNote(divya, { leadId: bengaluruLead, body: "hello" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(scheduleFollowUp(karthik, { leadId: bengaluruLead, dueDate: "2026-10-10" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(createQuotation(divya, { leadId: bengaluruLead, lines: [{ description: "x", quantity: 1, unitPrice: "1" }] })).rejects.toBeInstanceOf(NotFoundError);
    expect((await listLeads(karthik, { view: "branch" })).some((l) => l.id === bengaluruLead)).toBe(false);
  });

  it("hides Bengaluru work from Chennai and Hosur staff", async () => {
    expect(await getTask(karthik, bengaluruPickup)).toBeNull();
    expect(await getTask(hosurCollector, bengaluruPickup)).toBeNull();
    const chennaiTeam = await listWork(karthik, { scope: "team", view: "open" });
    expect(chennaiTeam.some((t) => t.branchId !== chennai)).toBe(false);
    await expect(transitionTask(karthik, { taskId: bengaluruPickup, action: "cancel", reason: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(assignTask(karthik, { taskId: bengaluruPickup, assigneeId: karthik.actor.id })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("does not let a coordinator create work in another branch or assign across branches", async () => {
    await expect(createTask(karthik, { kind: "general", title: "x", branchId: bengaluru })).rejects.toBeInstanceOf(ForbiddenError);
    const error = await createTask(karthik, { kind: "general", title: "x", assigneeId: arun.actor.id }).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
  });

  it("lets the CEO see and move work across branches", async () => {
    expect(await getTask(ceo, bengaluruPickup)).not.toBeNull();
    expect(await getLead(ceo, bengaluruLead)).not.toBeNull();
    await assignTask(ceo, { taskId: bengaluruPickup, assigneeId: hosurCollector.actor.id });
    const moved = await getTask(ceo, bengaluruPickup);
    expect(moved).toMatchObject({ branchName: "Hosur", assigneeName: "Hosur Collector" });
    expect(await getTask(arun, bengaluruPickup)).toBeNull(); // no longer Arun's, no longer Bengaluru's
    expect(await getTask(priya, bengaluruPickup)).not.toBeNull(); // the creator keeps sight of work they created
    const [entry] = await handle.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, bengaluruPickup), eq(auditLogs.action, "task.assign")));
    expect(entry!.changes).toMatchObject({ branchId: [bengaluru, hosur] });
  });
});

describe("one customer record, shared across branches and departments", () => {
  it("reuses ABC Engineering for a Chennai lead instead of creating a duplicate", async () => {
    const suggestions = await suggestCompanies(divya, "abc eng");
    expect((await suggestCompanies(divya, "Engineering ABC")).some((s) => s.id === abcId)).toBe(true);
    const abc = suggestions.find((s) => s.id === abcId);
    expect(abc).toMatchObject({ name: "ABC Engineering", known: false });

    const { id } = await createLead(divya, { companyId: abc!.id, requirement: "Dial gauge calibration" });
    const lead = await getLead(divya, id);
    expect(lead!.companyId).toBe(abcId);
    const all = await handle.db.select().from(companies).where(eq(companies.normalizedName, "abc engineering"));
    expect(all).toHaveLength(1);
    const links = await handle.db.select().from(companyBranches).where(eq(companyBranches.companyId, abcId));
    expect(links.map((l) => l.branchId).sort()).toEqual([bengaluru, chennai].sort());
  });

  it("shows Chennai staff the shared company but only Chennai's relationship and business", async () => {
    const customer = await getCustomer(divya, abcId);
    expect(customer!.name).toBe("ABC Engineering");
    expect(customer!.relationships.map((r) => r.branchName)).toEqual(["Chennai"]);
    const history = await listActivities(divya, { companyId: abcId });
    expect(history.every((a) => a.branchName === "Chennai" || a.branchName === null)).toBe(true);
  });

  it("shows the CEO every branch's relationship", async () => {
    const customer = await getCustomer(ceo, abcId);
    expect(customer!.relationships.map((r) => r.branchName).sort()).toEqual(["Bengaluru", "Chennai"]);
  });

  it("is the same record a pickup, a lead and a quotation all point to", async () => {
    const pickup = await createTask(priya, { kind: "pickup", title: "Collect dial gauges", companyId: abcId, assigneeId: arun.actor.id });
    const { id: leadId } = await createLead(rahul, { companyId: abcId, requirement: "Height gauge calibration" });
    const { id: quotationId } = await createQuotation(rahul, { leadId, lines: [{ description: "Height gauge", quantity: 1, unitPrice: "900" }] });
    const [pickupRow] = await handle.db.select({ companyId: tasks.companyId }).from(tasks).where(eq(tasks.id, pickup.id));
    const [leadRow] = await handle.db.select({ companyId: leads.companyId }).from(leads).where(eq(leads.id, leadId));
    expect([pickupRow!.companyId, leadRow!.companyId]).toEqual([abcId, abcId]);
    expect(quotationId).toBeTruthy();
  });

  it("counts a company's open leads — only those the viewer may see", async () => {
    const openLeads = await handle.db
      .select({ n: sql<number>`count(*)::int` })
      .from(leads)
      .where(and(eq(leads.companyId, abcId), sql`${leads.stage} not in ('won', 'lost')`));
    const forCeo = (await listCustomers(ceo, { query: "ABC Engineering" })).find((c) => c.id === abcId)!;
    expect(forCeo.openLeads).toBe(openLeads[0]!.n);
    expect(forCeo.openLeads).toBeGreaterThanOrEqual(2);
    // Divya sees only her own Chennai lead, not Bengaluru's.
    const forDivya = (await listCustomers(divya, { query: "ABC Engineering" })).find((c) => c.id === abcId)!;
    expect(forDivya.openLeads).toBe(1);
  });

  it("creates customers with duplicate protection and links them to the creator's branch", async () => {
    const { id } = await createCustomer(divya, { name: "Guindy Instruments", area: "Guindy", relationship: "customer", contactName: "Selvi" });
    const customer = await getCustomer(divya, id);
    expect(customer!.relationships).toMatchObject([{ branchName: "Chennai", relationship: "customer" }]);
    await expect(createCustomer(divya, { name: "Guindy Instruments Pvt Ltd" })).rejects.toBeInstanceOf(ValidationError);
    await expect(createCustomer(divya, { name: "Somewhere Else", branchId: bengaluru })).rejects.toBeInstanceOf(ForbiddenError);
    // Accounts can read customers but not create them.
    await expect(createCustomer(fathima, { name: "Not allowed" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets a branch add an existing PTCC company to its own list", async () => {
    const hosurCustomers = await listCustomers(await contextFor(handle.db, await createTestUser(handle.db, { roles: ["marketing"], branchId: hosur })), {});
    expect(hosurCustomers.some((c) => c.id === abcId)).toBe(false);
    await setBranchRelationship(karthik, { companyId: abcId, relationship: "customer" });
    const links = await handle.db.select().from(companyBranches).where(eq(companyBranches.companyId, abcId));
    expect(links.find((l) => l.branchId === chennai)!.relationship).toBe("customer");
  });
});

describe("management visibility", () => {
  it("gives the CEO company-wide and per-branch marketing numbers", async () => {
    const all = await marketingMetrics(ceo, { period: "30d" });
    const blr = await marketingMetrics(ceo, { period: "30d", branchId: bengaluru });
    const chn = await marketingMetrics(ceo, { period: "30d", branchId: chennai });
    expect(all.callsMade).toBeGreaterThanOrEqual(blr.callsMade + chn.callsMade);
    expect(blr.won).toBe(1);
    expect(blr.businessValuePaise).toBe(1_500_000);
    expect(blr.winRate).toBe(0.5); // one won, one lost
    const comparison = await branchComparison(ceo, { period: "30d" });
    expect(comparison.map((row) => row.branchName)).toEqual(expect.arrayContaining(["Bengaluru", "Chennai", "Hosur"]));
    // Each row carries that branch's own numbers — the same as the branch filter shows.
    const blrRow = comparison.find((row) => row.branchId === bengaluru)!;
    expect(blrRow).toMatchObject({ newLeads: blr.newLeads, calls: blr.callsMade, won: 1, valuePaise: 1_500_000 });
    expect(blrRow.newLeads).toBeGreaterThan(0);
    const chnRow = comparison.find((row) => row.branchId === chennai)!;
    expect(chnRow).toMatchObject({ newLeads: chn.newLeads, calls: chn.callsMade, won: chn.won });
  });

  it("limits a branch marketing manager to their own branch, and others to nothing", async () => {
    const own = await marketingMetrics(sneha, { period: "30d", branchId: chennai }); // request ignored
    const blr = await marketingMetrics(ceo, { period: "30d", branchId: bengaluru });
    expect(own).toEqual(blr);
    await expect(marketingMetrics(rahul, { period: "30d" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(branchComparison(sneha, { period: "30d" })).rejects.toBeInstanceOf(ForbiddenError);
    const people = await marketingPerformance(sneha, { period: "30d" });
    expect(people.every((p) => p.branchName === "Bengaluru")).toBe(true);
    expect(people.find((p) => p.name === "Rahul Menon")!.won).toBe(1);
  });
});

describe("branch administration", () => {
  it("lists each branch with its NABL certificate and active people", async () => {
    const rows = await listBranches(ceo);
    const [people] = await handle.db
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(and(eq(users.branchId, bengaluru), eq(users.status, "active")));
    expect(rows.find((row) => row.id === bengaluru)).toMatchObject({ certificates: ["CC-2467"], activePeople: people!.n });
    expect(people!.n).toBeGreaterThan(0);
    expect(rows.find((row) => row.id === chennai)!.certificates).toEqual(["CC-2822"]);
    expect(rows.find((row) => row.id === hosur)!.certificates).toEqual(["CC-3649"]);
  });

  it("adds a branch as 'needs verification', with no accredited scope until a certificate is imported", async () => {
    const { id } = await createBranch(ceo, { name: "New branch (details awaited)" });
    expect((await listBranches(ceo)).find((row) => row.id === id)).toMatchObject({
      verification: "needs_verification",
      certificates: [],
      activePeople: 0,
    });
    expect((await searchScope(ceo, { query: "pressure gauge", branchId: id })).groups).toEqual([]);
    expect((await audit(id)).map((entry) => entry.action)).toEqual(["branch.create"]);
  });

  it("won't deactivate a branch people work at, and is only for branch managers of the platform", async () => {
    await expect(setBranchStatus(ceo, { id: bengaluru, status: "inactive" })).rejects.toBeInstanceOf(ConflictError);
    await expect(listBranches(priya)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createBranch(sneha, { name: "Somewhere" })).rejects.toBeInstanceOf(ForbiddenError);
  });
});
