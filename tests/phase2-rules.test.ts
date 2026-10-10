/**
 * Phase 2 verification: rules PTCC confirmed after the first build.
 * - Hyderabad is a registered branch whose NABL accreditation is NOT verified.
 * - The 807 scope rows stay intact and branch-specific.
 * - Lead routing: branch coordinators / marketing managers within their branch, Admin routes
 *   company-wide (audited, without working leads), the CEO decides unknown branches.
 * - Quotations keep the Q-1001 sequence, typed prices and their history.
 */
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Ctx } from "@/server/context";
import type { DatabaseHandle } from "@/server/db/client";
import { accreditations, auditLogs, branches, scopeEntries } from "@/server/db/schema";
import { ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { importBranchDirectory } from "@/modules/branches/import";
import { listBranches, updateBranch } from "@/modules/branches/service";
import { listAccreditations, searchScope } from "@/modules/catalogue/queries";
import { getLead, getLeadQuotations, getLeadRequirements, leadViewsFor, listActivities, listLeads } from "@/modules/leads/queries";
import { quotationRef } from "@/modules/leads/model";
import {
  assignLead,
  changeStage,
  createLead,
  createQuotation,
  logCall,
  markWon,
  setLeadBranch,
  setQuotationStatus,
} from "@/modules/leads/service";
import { branchIdByName, contextFor, createTestDatabase, createTestUser, importTestBranchDirectory, importTestScope } from "./support/db";

let handle: DatabaseHandle;
let bengaluru: string;
let chennai: string;
let hyderabad: string;

let ceo: Ctx;
let admin: Ctx;
let priya: Ctx; // Bengaluru coordinator
let sneha: Ctx; // Bengaluru marketing manager
let rahul: Ctx; // Bengaluru marketing
let kiran: Ctx; // Bengaluru marketing
let arun: Ctx; // Bengaluru collection
let divya: Ctx; // Chennai marketing
let srinivas: Ctx; // Hyderabad coordinator
let lavanya: Ctx; // Hyderabad marketing
let ravi: Ctx; // Hyderabad marketing

const auditOf = (entityId: string) =>
  handle.db.select().from(auditLogs).where(eq(auditLogs.entityId, entityId)).orderBy(auditLogs.createdAt);

beforeAll(async () => {
  handle = await createTestDatabase();
  const db = handle.db;
  await importTestScope(db);
  await importTestBranchDirectory(db);
  bengaluru = await branchIdByName(db, "Bengaluru");
  chennai = await branchIdByName(db, "Chennai");
  hyderabad = await branchIdByName(db, "Hyderabad");
  const user = async (name: string, role: Parameters<typeof createTestUser>[1]["roles"][number], branchId: string | null) =>
    contextFor(db, await createTestUser(db, { name, roles: [role], branchId }));
  ceo = await user("Mohan Krishnan", "ceo", null);
  admin = await user("Deepa Nair", "admin", null);
  priya = await user("Priya Sharma", "hr", bengaluru);
  sneha = await user("Sneha Kulkarni", "marketing_manager", bengaluru);
  rahul = await user("Rahul Menon", "marketing", bengaluru);
  kiran = await user("Kiran Shetty", "marketing", bengaluru);
  arun = await user("Arun Kumar", "collection", bengaluru);
  divya = await user("Divya Raman", "marketing", chennai);
  srinivas = await user("Srinivas Reddy", "hr", hyderabad);
  lavanya = await user("Lavanya Rao", "marketing", hyderabad);
  ravi = await user("Ravi Teja", "marketing", hyderabad);
});

afterAll(async () => {
  await handle.close();
});

describe("Hyderabad branch", () => {
  it("is registered with the details PTCC supplied", async () => {
    const [row] = await handle.db.select().from(branches).where(eq(branches.id, hyderabad));
    expect(row).toMatchObject({
      name: "Hyderabad",
      addressLine: "204, New Nagole Main Road, Kishanbag, Maruthi Nagar, Kothapet",
      city: "Hyderabad",
      state: "Telangana",
      pincode: "500102",
      phone: "+919488378156",
      email: "precisehyd@precisetcc.com",
      status: "active",
      verification: "verified",
    });
    expect(row!.mapsUrl).toMatch(/^https:\/\/www\.google\.com\/maps\/place\/204,\+New\+Nagole/);
    expect(row!.description).toContain("calibration services across Hyderabad");
    const [created] = await auditOf(hyderabad);
    expect(created).toMatchObject({ action: "branch.create", actorId: null });
  });

  it("has no accreditation and no accredited scope — not even services accredited elsewhere", async () => {
    expect((await listAccreditations(ceo)).some((a) => a.branchId === hyderabad)).toBe(false);
    expect((await listBranches(ceo)).find((b) => b.id === hyderabad)!.certificates).toEqual([]);
    for (const query of ["pressure gauge", "temperature", "weights", "hardness"]) {
      expect((await searchScope(ceo, { query, branchId: hyderabad })).groups).toEqual([]);
    }
    // A Hyderabad lead asking for a service accredited at Bengaluru is flagged, never "in scope".
    const blrRow = (await searchScope(ceo, { query: "pressure gauge", branchId: bengaluru })).groups[0]!.entries[0]!;
    const { id } = await createLead(lavanya, { companyName: "Nagole Instruments", requirement: "Pressure gauge calibration", scopeEntryIds: [blrRow.id] });
    const lead = (await getLead(lavanya, id))!;
    expect(lead.branchId).toBe(hyderabad);
    const [requirement] = await getLeadRequirements(lavanya, lead);
    expect(requirement!.status).toEqual({ kind: "other_branch", entryBranchName: "Bengaluru" });
  });

  it("re-importing never overwrites an Admin's edits, and only fills empty fields", async () => {
    const [before] = await handle.db.select().from(branches).where(eq(branches.id, hyderabad));
    await updateBranch(admin, {
      id: hyderabad,
      name: "Hyderabad",
      addressLine: before!.addressLine ?? "",
      city: before!.city ?? "",
      state: before!.state ?? "",
      pincode: before!.pincode ?? "",
      phone: "98480 22338", // changed by the Admin
      email: before!.email ?? "",
      mapsUrl: before!.mapsUrl ?? "",
      description: "", // cleared by the Admin
      notes: before!.notes ?? "",
      verified: true,
    });
    const file = JSON.parse(
      await import("node:fs").then((fs) => fs.readFileSync(new URL("../data/branches/ptcc-branches.json", import.meta.url), "utf8")),
    );
    const result = await importBranchDirectory(handle.db, file);
    expect(result).toEqual({ created: [], updated: ["Hyderabad"], unchanged: [] });
    const [after] = await handle.db.select().from(branches).where(eq(branches.id, hyderabad));
    expect(after!.phone).toBe("+919848022338");
    expect(after!.description).toContain("calibration services across Hyderabad");
    expect(await importBranchDirectory(handle.db, file)).toEqual({ created: [], updated: [], unchanged: ["Hyderabad"] });
  });

  it("is a branch like the others for people and visibility", async () => {
    // Hyderabad staff see Hyderabad leads only; Bengaluru staff can't open them.
    const { id } = await createLead(ravi, { companyName: "Kothapet Engineering", requirement: "Vernier caliper calibration" });
    expect((await getLead(srinivas, id))?.branchId).toBe(hyderabad);
    expect(await getLead(priya, id)).toBeNull();
    expect(await getLead(divya, id)).toBeNull();
    expect((await getLead(ceo, id))?.branchName).toBe("Hyderabad");
  });
});

describe("accredited scope stays intact and branch-specific", () => {
  it("keeps all 807 rows, linked to the right certificate and branch", async () => {
    const rows = await handle.db
      .select({ certificate: accreditations.certificateNumber, branchName: branches.name, link: accreditations.branchLinkStatus, n: sql<number>`count(*)::int` })
      .from(scopeEntries)
      .innerJoin(accreditations, eq(accreditations.id, scopeEntries.accreditationId))
      .leftJoin(branches, eq(branches.id, accreditations.branchId))
      .where(eq(scopeEntries.isCurrent, true))
      .groupBy(accreditations.certificateNumber, branches.name, accreditations.branchLinkStatus)
      .orderBy(accreditations.certificateNumber);
    expect(rows).toEqual([
      { certificate: "CC-2467", branchName: "Bengaluru", link: "confirmed", n: 624 },
      { certificate: "CC-2822", branchName: "Chennai", link: "confirmed", n: 97 },
      { certificate: "CC-3649", branchName: "Hosur", link: "confirmed", n: 86 },
    ]);
  });
});

describe("lead routing", () => {
  let branchless: string;
  let blrLead: string;

  beforeAll(async () => {
    ({ id: branchless } = await createLead(arun, { companyName: "Unknown City Gauges", requirement: "Gauge calibration", branchId: "" }));
    ({ id: blrLead } = await createLead(priya, { companyName: "Peenya Valves", requirement: "Torque wrench calibration" }));
  });

  it("leaves an unknown branch unknown, and only the CEO or Admin may decide it", async () => {
    expect((await getLead(ceo, branchless))!.branchId).toBeNull();
    // Branch staff can't even see a lead without a branch.
    await expect(setLeadBranch(priya, { leadId: branchless, branchId: bengaluru })).rejects.toBeInstanceOf(NotFoundError);
    await expect(setLeadBranch(sneha, { leadId: branchless, branchId: bengaluru })).rejects.toBeInstanceOf(NotFoundError);
    // …and can't move their own branch's lead elsewhere.
    await expect(setLeadBranch(priya, { leadId: blrLead, branchId: chennai })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await listLeads(ceo, { view: "needs_branch" })).map((l) => l.id)).toContain(branchless);
  });

  it("lets Admin route a lead — branch, owner, reassignment — with every action audited", async () => {
    expect(leadViewsFor(admin.actor)).toEqual(expect.arrayContaining(["all", "needs_owner", "needs_branch"]));
    expect((await listLeads(admin, { view: "needs_branch" })).map((l) => l.id)).toContain(branchless);

    await setLeadBranch(admin, { leadId: branchless, branchId: hyderabad });
    await assignLead(admin, { leadId: branchless, ownerId: lavanya.actor.id });
    await assignLead(admin, { leadId: branchless, ownerId: ravi.actor.id });
    const lead = (await getLead(admin, branchless))!;
    expect(lead).toMatchObject({ branchId: hyderabad, ownerId: ravi.actor.id });

    const audit = (await auditOf(branchless)).filter((entry) => entry.actorId === admin.actor.id);
    expect(audit.map((entry) => entry.action)).toEqual(["lead.branch", "lead.assign", "lead.assign"]);
    expect(audit[2]!.changes).toEqual({ ownerId: [lavanya.actor.id, ravi.actor.id] });
    // The routing is also in the lead's own history.
    const kinds = (await listActivities(ravi, { leadId: branchless })).map((a) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(["branch_assigned", "assigned"]));
  });

  it("does not let Admin work a lead — no calls, stages, quotations or wins", async () => {
    await expect(logCall(admin, { leadId: branchless, outcome: "connected" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(changeStage(admin, { leadId: branchless, stage: "qualification" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      createQuotation(admin, { leadId: branchless, lines: [{ description: "Gauge", quantity: 1, unitPrice: "500" }] }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(markWon(admin, { leadId: branchless })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets coordinators and marketing managers assign and reassign within their own branch only", async () => {
    await assignLead(priya, { leadId: blrLead, ownerId: rahul.actor.id });
    await assignLead(sneha, { leadId: blrLead, ownerId: kiran.actor.id });
    expect((await getLead(kiran, blrLead))!.ownerId).toBe(kiran.actor.id);
    expect((await auditOf(blrLead)).filter((e) => e.action === "lead.assign").map((e) => e.actorId)).toEqual([priya.actor.id, sneha.actor.id]);
    // Not to a marketer of another branch…
    await expect(assignLead(sneha, { leadId: blrLead, ownerId: lavanya.actor.id })).rejects.toBeInstanceOf(ValidationError);
    // …and another branch's coordinator can't reach the lead at all.
    await expect(assignLead(srinivas, { leadId: blrLead, ownerId: lavanya.actor.id })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("can't be bypassed by changing IDs or request payloads", async () => {
    // A marketer can't assign, even inside their own branch, and can't see a colleague's lead.
    await expect(assignLead(rahul, { leadId: blrLead, ownerId: rahul.actor.id })).rejects.toBeInstanceOf(NotFoundError);
    // Another branch's marketer gets "not found" for the lead and its history.
    expect(await getLead(lavanya, blrLead)).toBeNull();
    expect(await listActivities(lavanya, { leadId: blrLead })).toEqual([]);
    // Capturing for another branch is allowed (brief: anyone can pass a lead on) — choosing its owner is not.
    await expect(
      createLead(rahul, { companyName: "Kothapet Pumps", requirement: "Flow meter calibration", branchId: hyderabad, ownerId: lavanya.actor.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    const { id } = await createLead(rahul, { companyName: "Kothapet Pumps", requirement: "Flow meter calibration", branchId: hyderabad });
    expect((await getLead(rahul, id))).toMatchObject({ branchId: hyderabad, ownerId: null });
    await expect(assignLead(rahul, { leadId: id, ownerId: lavanya.actor.id })).rejects.toBeInstanceOf(ForbiddenError);
    // A made-up branch ID is refused.
    await expect(
      createLead(rahul, { companyName: "Nowhere Ltd", requirement: "Calibration", branchId: "00000000-0000-4000-8000-000000000000" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("quotations", () => {
  it("keep the Q-1001 sequence, typed prices and their full history", async () => {
    const { id: leadId } = await createLead(rahul, { companyName: "Rajajinagar Scales", requirement: "Weighing balance calibration" });
    const first = await createQuotation(rahul, { leadId, lines: [{ description: "Weighing balance", quantity: 2, unitPrice: "1,250" }] });
    const second = await createQuotation(rahul, { leadId, lines: [{ description: "Weighing balance (revised)", quantity: 2, unitPrice: "1,100" }] });
    expect(quotationRef(first.number)).toMatch(/^Q-\d+$/);
    expect(first.number).toBeGreaterThanOrEqual(1001);
    expect(second.number).toBe(first.number + 1);

    // No price list: a line without a typed price is refused.
    await expect(createQuotation(rahul, { leadId, lines: [{ description: "Weighing balance", quantity: 1, unitPrice: "" }] })).rejects.toBeInstanceOf(
      ValidationError,
    );

    await setQuotationStatus(rahul, { quotationId: first.id, status: "sent" });
    await setQuotationStatus(rahul, { quotationId: first.id, status: "rejected" });
    await setQuotationStatus(rahul, { quotationId: second.id, status: "sent" });
    await setQuotationStatus(rahul, { quotationId: second.id, status: "accepted" });
    await markWon(rahul, { leadId });

    const kept = await getLeadQuotations(rahul, leadId);
    expect(kept.map((q) => [q.number, q.status, q.totalPaise]).sort()).toEqual(
      [
        [first.number, "rejected", 250_000],
        [second.number, "accepted", 220_000],
      ].sort(),
    );
    expect((await getLead(rahul, leadId))!.wonValuePaise).toBe(220_000);
    const audit = await handle.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(and(eq(auditLogs.entityType, "quotation"), eq(auditLogs.entityId, first.id)));
    expect(audit.map((a) => a.action)).toEqual(["quotation.create", "quotation.status", "quotation.status"]);
  });
});
