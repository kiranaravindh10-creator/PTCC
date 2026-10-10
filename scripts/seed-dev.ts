/**
 * DEVELOPMENT ONLY — fills the database with realistic sample data so every role's Home,
 * My Work, Leads and Customers can be explored. Usage: npm run db:seed
 * (after `npm run db:setup`, which imports PTCC's scope and creates the accredited branches).
 *
 * Everything is created through the real module services as the people who would do it, so
 * history, notifications, metrics and audit entries are genuine. Companies and people are
 * fictional; quotation amounts are illustrative only — the platform holds no PTCC prices.
 */
import { eq } from "drizzle-orm";
import { loadActor } from "@/server/access/load";
import { hashPassword } from "@/server/auth/password";
import type { Ctx } from "@/server/context";
import type { Database } from "@/server/db/client";
import { branches, companies, companyBranches, contacts, roles, userRoles, users } from "@/server/db/schema";
import { addDays, companyToday } from "@/lib/time";
import { normalizePhone } from "@/lib/phone";
import { normalizeCompanyName } from "@/lib/company";
import { searchScope } from "@/modules/catalogue/queries";
import {
  createLead,
  createQuotation,
  logCall,
  markLost,
  markWon,
  scheduleFollowUp,
  setQuotationStatus,
} from "@/modules/leads/service";
import { createTask, transitionTask, type CreateTaskInput } from "@/modules/tasks/service";
import { SAMPLE_PASSWORD, SAMPLE_PEOPLE, type SamplePersonKey } from "@/dev/sample-accounts";
import { run, withDatabase } from "./_shared";

type BranchName = "Bengaluru" | "Chennai" | "Hosur";

const SAMPLE_COMPANIES = [
  // Bengaluru
  { key: "abc", name: "ABC Engineering", industry: "Pressure gauge manufacturing", addressLine: "No. 42, 2nd Stage, Peenya Industrial Area", area: "Peenya", city: "Bengaluru", lat: "13.028500", lng: "77.519700", branches: { Bengaluru: "customer", Chennai: "prospect" }, contact: ["Rajesh", "9000010001", "Production Manager"] },
  { key: "lakshmi", name: "Sri Lakshmi Hydraulics", industry: "Hydraulic equipment", addressLine: "Plot 118, Bommasandra Industrial Area", area: "Bommasandra", city: "Bengaluru", lat: "12.815500", lng: "77.696000", branches: { Bengaluru: "customer" }, contact: ["Mahesh", "9000010002", "Quality Head"] },
  { key: "vertex", name: "Vertex Precision Tools", industry: "Precision tooling", addressLine: "EPIP Zone, Whitefield", area: "Whitefield", city: "Bengaluru", lat: "12.981000", lng: "77.728000", branches: { Bengaluru: "prospect" }, contact: ["Anitha", "9000010003", "Purchase Manager"] },
  { key: "kaveri", name: "Kaveri Pharma Labs", industry: "Pharmaceuticals", addressLine: "Plot 7, KIADB Jigani Industrial Area", area: "Jigani", city: "Bengaluru", lat: "12.785000", lng: "77.642000", branches: { Bengaluru: "customer" }, contact: ["Dr. Suresh", "9000010004", "QA Manager"] },
  { key: "nandi", name: "Nandi Auto Components", industry: "Automotive components", addressLine: "Bidadi Industrial Area, Ramanagara", area: "Bidadi", city: "Bengaluru", lat: "12.800000", lng: "77.390000", branches: { Bengaluru: "prospect" }, contact: ["Prakash", "9000010005", "Plant Manager"] },
  { key: "deccan", name: "Deccan Thermal Systems", industry: "Industrial heating", addressLine: "Electronic City Phase 1", area: "Electronic City", city: "Bengaluru", lat: "12.845000", lng: "77.660000", branches: { Bengaluru: "customer" }, contact: ["Kavya", "9000010006", "Maintenance Engineer"] },
  { key: "malnad", name: "Malnad Food Processing", industry: "Food processing", addressLine: "KIADB Hoskote Industrial Area", area: "Hoskote", city: "Bengaluru", lat: "13.070000", lng: "77.790000", branches: { Bengaluru: "customer" }, contact: ["Ramesh", "9000010007", "Plant Head"] },
  { key: "bharat", name: "Bharat Weighing Solutions", industry: "Weighing equipment", addressLine: "Rajajinagar Industrial Estate", area: "Rajajinagar", city: "Bengaluru", lat: "12.990000", lng: "77.555000", branches: { Bengaluru: "customer" }, contact: ["Imran", "9000010008", "Service Manager"] },
  // Chennai
  { key: "coromandel", name: "Coromandel Gauges", industry: "Instrument manufacturing", addressLine: "SIDCO Industrial Estate, Ambattur", area: "Ambattur", city: "Chennai", lat: "13.098000", lng: "80.162000", branches: { Chennai: "prospect" }, contact: ["Murali", "9000010009", "Works Manager"] },
  { key: "guindy", name: "Guindy Instruments", industry: "Test and measurement", addressLine: "Thiru-Vi-Ka Industrial Estate, Guindy", area: "Guindy", city: "Chennai", lat: "13.012000", lng: "80.212000", branches: { Chennai: "prospect" }, contact: ["Selvi", "9000010010", "Quality Engineer"] },
  // Hosur
  { key: "castings", name: "Hosur Precision Castings", industry: "Foundry", addressLine: "SIPCOT Industrial Complex Phase 1", area: "SIPCOT", city: "Hosur", lat: "12.738000", lng: "77.826000", branches: { Hosur: "prospect" }, contact: ["Balaji", "9000010011", "QA Head"] },
] as const satisfies ReadonlyArray<{
  key: string;
  name: string;
  industry: string;
  addressLine: string;
  area: string;
  city: string;
  lat: string;
  lng: string;
  branches: Partial<Record<BranchName, "prospect" | "customer">>;
  contact: readonly [string, string, string];
}>;

type CompanyKey = (typeof SAMPLE_COMPANIES)[number]["key"];

type SampleTask = {
  by: SamplePersonKey;
  to: SamplePersonKey | null;
  kind: CreateTaskInput["kind"];
  title: string;
  company?: CompanyKey;
  day?: number;
  time?: string;
  priority?: CreateTaskInput["priority"];
  details?: string;
  branch?: BranchName;
  then?: Array<[SamplePersonKey, string]>;
};

const SAMPLE_TASKS: SampleTask[] = [
  // Bengaluru collections
  { by: "hr", to: "arun", kind: "pickup", company: "abc", title: "Collect pressure gauges for calibration", day: 0, time: "10:30", details: "6 pressure gauges (0–40 bar). Ask Rajesh for the instrument list." },
  { by: "hr", to: "arun", kind: "pickup", company: "nandi", title: "Collect torque wrenches", day: 0, time: "14:00", priority: "high", details: "Customer needs them back within the week." },
  { by: "hr", to: "arun", kind: "delivery", company: "bharat", title: "Deliver calibrated weighing scales and certificates", day: 0, time: "16:30" },
  { by: "hr", to: "arun", kind: "pickup", company: "lakshmi", title: "Collect hydraulic pressure gauges", day: -1, time: "15:00" },
  { by: "hr", to: "arun", kind: "delivery", company: "kaveri", title: "Return temperature data loggers", day: 1, time: "11:00" },
  { by: "hr", to: "arun", kind: "pickup", company: "deccan", title: "Collect thermocouples", day: -1, time: "11:00", then: [["arun", "start"], ["arun", "mark_collected"], ["hr", "receive"]] },
  { by: "hr", to: "manju", kind: "pickup", company: "vertex", title: "Collect micrometers and vernier callipers", day: 0, time: "11:30", then: [["manju", "start"]] },
  { by: "hr", to: "manju", kind: "delivery", company: "malnad", title: "Deliver calibrated thermometers", day: 0, time: "15:00" },
  { by: "hr", to: "manju", kind: "pickup", company: "deccan", title: "Collect furnace controllers", day: 1, time: "10:00" },
  { by: "hr", to: null, kind: "pickup", company: "kaveri", title: "Collect 3 temperature data loggers", day: 1, time: "10:00", priority: "high", details: "Customer called this morning requesting pickup." },
  { by: "hr", to: null, kind: "delivery", company: "abc", title: "Deliver calibrated gauges (batch from last week)", day: 0 },
  // Bengaluru marketing calls (planned)
  { by: "rahul", to: "rahul", kind: "call", company: "vertex", title: "Call Anitha about torque wrench calibration", day: 0 },
  { by: "rahul", to: "rahul", kind: "call", company: "malnad", title: "Introduce temperature calibration services", day: 0, time: "15:30" },
  { by: "rahul", to: "rahul", kind: "general", title: "Prepare list of Peenya prospects" },
  // Bengaluru lab, accounts, coordinator
  { by: "lakshmi", to: "lakshmi", kind: "general", company: "deccan", title: "Inspect incoming thermocouples", day: 0, then: [["lakshmi", "start"]] },
  { by: "hr", to: "lakshmi", kind: "general", company: "bharat", title: "Prepare calibration certificates", day: 0, time: "12:00" },
  { by: "fathima", to: "fathima", kind: "call", company: "malnad", title: "Payment follow-up: ₹48,500 due", day: 0, priority: "high" },
  { by: "fathima", to: "fathima", kind: "general", company: "vertex", title: "Send invoice for last month's calibration", day: 1 },
  { by: "hr", to: "hr", kind: "general", title: "Plan next week's pickup schedule", day: 0 },
  // Chennai
  { by: "karthik", to: "senthil", kind: "pickup", company: "coromandel", title: "Collect pressure gauges", day: 0, time: "11:00" },
  { by: "karthik", to: "senthil", kind: "delivery", company: "guindy", title: "Deliver calibrated dial gauges", day: 1, time: "12:30" },
  { by: "karthik", to: null, kind: "pickup", company: "abc", title: "Collect dial gauges from ABC's Chennai unit", day: 2, details: "Address to be confirmed with Rajesh." },
  // CEO
  { by: "ceo", to: "ceo", kind: "general", title: "Review quarterly calibration targets", day: 3, branch: "Bengaluru" },
];

async function seed(db: Database) {
  const [existing] = await db.select({ id: users.id }).from(users).limit(1);
  if (existing) {
    throw new Error("The database already has people in it. Use `npm run db:reset` (local database) to start fresh.");
  }

  // Branches are real PTCC data: Bengaluru, Chennai and Hosur from the NABL certificates (scope
  // import), Hyderabad from PTCC's branch directory (branches import). Nothing is invented here.
  const branchRows = await db.select({ id: branches.id, name: branches.name }).from(branches);
  const branchId = (name: string) => {
    const found = branchRows.find((row) => row.name === name);
    if (!found) throw new Error(`Branch "${name}" is missing. Run \`npm run db:setup\` (it imports the scope and the branch directory) first.`);
    return found.id;
  };
  ["Bengaluru", "Chennai", "Hosur", "Hyderabad"].forEach(branchId);

  const roleRows = await db.select({ id: roles.id, key: roles.key }).from(roles);
  if (roleRows.length === 0) throw new Error("Roles are missing. Run `npm run db:setup` first.");

  // People
  const passwordHash = await hashPassword(SAMPLE_PASSWORD);
  const userIds = new Map<SamplePersonKey, string>();
  for (const person of SAMPLE_PEOPLE) {
    const [user] = await db
      .insert(users)
      .values({
        name: person.name,
        phone: normalizePhone(person.phone)!,
        email: `${person.key}@ptcc.example`,
        designation: person.designation,
        branchId: person.branch ? branchId(person.branch) : null,
        passwordHash,
      })
      .returning({ id: users.id });
    userIds.set(person.key, user!.id);
    for (const roleKey of person.roles) {
      await db.insert(userRoles).values({ userId: user!.id, roleId: roleRows.find((row) => row.key === roleKey)!.id });
    }
  }
  const adminId = userIds.get("admin")!;

  // Customers — one record each, linked to the branches they deal with
  const companyIds = new Map<CompanyKey, string>();
  for (const company of SAMPLE_COMPANIES) {
    const [row] = await db
      .insert(companies)
      .values({
        name: company.name,
        normalizedName: normalizeCompanyName(company.name),
        industry: company.industry,
        addressLine: company.addressLine,
        area: company.area,
        city: company.city,
        state: company.city === "Bengaluru" ? "Karnataka" : "Tamil Nadu",
        latitude: company.lat,
        longitude: company.lng,
        createdBy: adminId,
        updatedBy: adminId,
      })
      .returning({ id: companies.id });
    companyIds.set(company.key, row!.id);
    for (const [branch, relationship] of Object.entries(company.branches)) {
      await db.insert(companyBranches).values({
        companyId: row!.id,
        branchId: branchId(branch),
        relationship,
        becameCustomerAt: relationship === "customer" ? new Date() : null,
        createdBy: adminId,
      });
    }
    const [name, phone, designation] = company.contact;
    await db.insert(contacts).values({ companyId: row!.id, name, phone: normalizePhone(phone), designation, isPrimary: true, createdBy: adminId });
  }

  const contexts = new Map<SamplePersonKey, Ctx>();
  const as = async (key: SamplePersonKey): Promise<Ctx> => {
    if (!contexts.has(key)) {
      const actor = await loadActor(db, userIds.get(key)!);
      if (!actor) throw new Error(`Could not load ${key}`);
      contexts.set(key, { db, actor, meta: { ip: null, userAgent: "seed-dev" }, now: new Date() });
    }
    return contexts.get(key)!;
  };
  const today = companyToday();
  const day = (offset: number) => addDays(today, offset);

  // Work
  for (const sample of SAMPLE_TASKS) {
    const ctx = await as(sample.by);
    const { id } = await createTask(ctx, {
      kind: sample.kind,
      title: sample.title,
      details: sample.details,
      priority: sample.priority ?? "normal",
      companyId: sample.company ? companyIds.get(sample.company) : undefined,
      dueDate: sample.day === undefined ? undefined : day(sample.day),
      dueTime: sample.time,
      assigneeId: sample.to === null ? "" : sample.to === sample.by ? undefined : userIds.get(sample.to),
      branchId: sample.branch ? branchId(sample.branch) : undefined,
    });
    for (const [person, action] of sample.then ?? []) {
      await transitionTask(await as(person), { taskId: id, action });
    }
  }

  // Leads — requirements linked to real rows of PTCC's scope for the lead's branch
  const scopeRow = async (ctx: Ctx, query: string, branch: BranchName) => {
    const result = await searchScope(ctx, { query, branchId: branchId(branch) });
    const entry = result.groups[0]?.entries[0];
    if (!entry) throw new Error(`No scope entry for "${query}" at ${branch}`);
    return entry.id;
  };
  const lead = async (
    key: SamplePersonKey,
    input: Parameters<typeof createLead>[1] & { company?: CompanyKey; scope?: [string, BranchName] },
  ) => {
    const ctx = await as(key);
    const { company, scope, ...rest } = input;
    return createLead(ctx, {
      ...rest,
      companyId: company ? companyIds.get(company) : rest.companyId,
      scopeEntryIds: scope ? [await scopeRow(ctx, scope[0], scope[1])] : [],
    });
  };
  const rahul = await as("rahul");
  const sneha = await as("sneha");
  const divya = await as("divya");
  const meena = await as("meena");

  // Bengaluru
  const abc = await lead("rahul", { company: "abc", requirement: "Pressure gauge calibration, 12 nos", source: "existing_customer", scope: ["pressure gauge", "Bengaluru"] });
  await logCall(rahul, { leadId: abc.id, outcome: "no_answer" });
  await logCall(rahul, { leadId: abc.id, outcome: "connected", notes: "Rajesh wants a quote after checking the instrument list.", followUpDate: day(0), followUpTime: "15:00" });

  const vertex = await lead("rahul", { company: "vertex", requirement: "Micrometer and vernier caliper calibration", source: "phone_enquiry", scope: ["micrometer", "Bengaluru"] });
  await logCall(rahul, { leadId: vertex.id, outcome: "connected", notes: "6 micrometers, 4 callipers." });
  const vertexQuote = await createQuotation(rahul, {
    leadId: vertex.id,
    lines: [
      { description: "Outside micrometer calibration", quantity: 6, unitPrice: "450" },
      { description: "Vernier caliper calibration", quantity: 4, unitPrice: "350" },
    ],
    notes: "Illustrative sample amounts (development data).",
  });
  await setQuotationStatus(rahul, { quotationId: vertexQuote.id, status: "sent" });
  await scheduleFollowUp(rahul, { leadId: vertex.id, dueDate: day(1), dueTime: "11:00", note: "Check if the quotation was approved" });

  const nandi = await lead("sneha", { company: "nandi", requirement: "Torque wrench calibration, 8 nos", source: "referral", scope: ["torque wrench", "Bengaluru"] });
  await logCall(sneha, { leadId: nandi.id, outcome: "connected" });
  const nandiQuote = await createQuotation(sneha, { leadId: nandi.id, lines: [{ description: "Torque wrench calibration", quantity: 8, unitPrice: "900" }] });
  await setQuotationStatus(sneha, { quotationId: nandiQuote.id, status: "sent" });
  await setQuotationStatus(sneha, { quotationId: nandiQuote.id, status: "accepted" });
  await markWon(sneha, { leadId: nandi.id });

  await lead("rahul", { company: "malnad", requirement: "RTD and thermometer calibration", source: "existing_customer", scope: ["rtd", "Bengaluru"] });
  await lead("rahul", { companyName: "Bidadi Forgings", area: "Bidadi", city: "Bengaluru", contactName: "Naveen", contactPhone: "9000010012", requirement: "Hardness tester calibration", source: "employee", scope: ["hardness", "Hosur"] });
  // ↑ Bengaluru is not accredited for hardness testers (Hosur is): the lead shows "In Hosur's scope, not this branch's".

  const kaveri = await lead("sneha", { company: "kaveri", requirement: "Data logger calibration", source: "existing_customer" });
  await logCall(sneha, { leadId: kaveri.id, outcome: "connected" });
  await markLost(sneha, { leadId: kaveri.id, reason: "Customer chose in-house calibration this year" });

  const deccan = await lead("rahul", { company: "deccan", requirement: "Furnace temperature uniformity survey at site", source: "existing_customer", scope: ["furnace", "Bengaluru"] });
  await logCall(rahul, { leadId: deccan.id, outcome: "connected", followUpDate: day(-1), followUpTime: "16:00" });
  await logCall(rahul, { leadId: deccan.id, outcome: "busy" });

  // Captured by a collection employee in the field — waits for Bengaluru to assign an owner.
  await lead("arun", { companyName: "Sri Balaji Hydraulics", area: "Peenya", city: "Bengaluru", contactName: "Venu", contactPhone: "9000010013", requirement: "Saw a board for hydraulic gauge repair — may need calibration", source: "employee", notes: "Spotted near the Peenya 2nd Stage bus stop." });

  // Chennai
  const abcChennai = await lead("divya", { company: "abc", requirement: "Dial gauge calibration for the Chennai unit", source: "existing_customer", scope: ["dial gauge", "Chennai"] });
  await logCall(divya, { leadId: abcChennai.id, outcome: "connected", followUpDate: day(0), followUpTime: "12:00" });
  await lead("divya", { company: "coromandel", requirement: "Pressure gauge calibration", source: "phone_enquiry", scope: ["pressure gauge", "Chennai"] });
  const guindy = await lead("divya", { company: "guindy", requirement: "Dial gauge and plunger dial calibration", source: "referral", scope: ["dial gauge", "Chennai"] });
  await logCall(divya, { leadId: guindy.id, outcome: "connected" });
  const guindyQuote = await createQuotation(divya, { leadId: guindy.id, lines: [{ description: "Dial gauge calibration", quantity: 10, unitPrice: "600" }] });
  await setQuotationStatus(divya, { quotationId: guindyQuote.id, status: "sent" });
  await setQuotationStatus(divya, { quotationId: guindyQuote.id, status: "accepted" });
  await markWon(divya, { leadId: guindy.id });

  // Hosur
  const castings = await lead("meena", { company: "castings", requirement: "Rockwell hardness tester calibration", source: "walk_in", scope: ["rockwell", "Hosur"] });
  await logCall(meena, { leadId: castings.id, outcome: "connected", followUpDate: day(2) });

  // Branch unknown — the CEO decides where it goes.
  await lead("fathima", { companyName: "Sundaram Valves", contactName: "Sundaram", contactPhone: "9000010014", requirement: "Enquiry at a trade fair: valve test-bench pressure gauges", source: "other", branchId: "" });

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, adminId));
  return { people: SAMPLE_PEOPLE.length, companies: SAMPLE_COMPANIES.length + 3, tasks: SAMPLE_TASKS.length, leads: 15 };
}

run(async () => {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed sample data in production.");
  await withDatabase(async ({ db }) => {
    const result = await seed(db);
    console.log(
      `✓ Sample data: ${result.people} people in 4 branches, ${result.companies} customers, ${result.tasks} work items, ${result.leads} leads`,
    );
    console.log(`  Sign in with any sample phone number (e.g. 90000 00004 for Rahul, Marketing) and password "${SAMPLE_PASSWORD}".`);
  });
});
