import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Ctx } from "@/server/context";
import type { DatabaseHandle } from "@/server/db/client";
import { auditLogs, companies, companyBranches, contacts, notifications, tasks } from "@/server/db/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/server/errors";
import { normalizeCompanyName } from "@/lib/company";
import { getTask, listTaskEvents, listUnassigned, listWork } from "@/modules/tasks/queries";
import { addTaskComment, assignTask, createTask, transitionTask } from "@/modules/tasks/service";
import { contextFor, createTestBranch, createTestDatabase, createTestUser } from "./support/db";

let handle: DatabaseHandle;
let priya: Ctx; // HR / coordinator
let arun: Ctx; // collection
let manju: Ctx; // collection
let lakshmi: Ctx; // operations
let rahul: Ctx; // marketing
let companyId: string;

const notificationsFor = (ctx: Ctx) =>
  handle.db.select().from(notifications).where(eq(notifications.recipientId, ctx.actor.id));

beforeAll(async () => {
  handle = await createTestDatabase();
  const db = handle.db;
  // Everyone in this file works at one branch; cross-branch rules are in branches.test.ts.
  const branchId = await createTestBranch(db, "Bengaluru");
  const at = { branchId };
  priya = await contextFor(db, await createTestUser(db, { name: "Priya Sharma", roles: ["hr"], ...at }));
  arun = await contextFor(db, await createTestUser(db, { name: "Arun Kumar", roles: ["collection"], ...at }));
  manju = await contextFor(db, await createTestUser(db, { name: "Manjunath Gowda", roles: ["collection"], ...at }));
  lakshmi = await contextFor(db, await createTestUser(db, { name: "Lakshmi Narayan", roles: ["operations"], ...at }));
  rahul = await contextFor(db, await createTestUser(db, { name: "Rahul Menon", roles: ["marketing"], ...at }));

  const [company] = await db
    .insert(companies)
    .values({
      name: "ABC Engineering",
      normalizedName: normalizeCompanyName("ABC Engineering"),
      addressLine: "No. 42, Peenya Industrial Area",
      area: "Peenya",
      latitude: "13.028500",
      longitude: "77.519700",
      createdBy: priya.actor.id,
    })
    .returning({ id: companies.id });
  companyId = company!.id;
  await db.insert(companyBranches).values({ companyId, branchId });
  await db.insert(contacts).values({ companyId, name: "Rajesh", phone: "+919000010001", isPrimary: true });
});

afterAll(async () => {
  await handle.close();
});

describe("creating work", () => {
  it("fills in where and who from the customer, and notifies the assignee", async () => {
    const { id } = await createTask(priya, {
      kind: "pickup",
      title: "Collect pressure gauges",
      companyId,
      dueDate: "2026-10-08",
      dueTime: "10:30",
      assigneeId: arun.actor.id,
    });
    const task = await getTask(arun, id);
    expect(task).toMatchObject({
      status: "assigned",
      locationArea: "Peenya",
      locationAddress: "No. 42, Peenya Industrial Area",
      latitude: "13.028500",
      contactName: "Rajesh",
      contactPhone: "+919000010001",
      dueTime: "10:30",
      assigneeName: "Arun Kumar",
    });
    const inbox = await notificationsFor(arun);
    const assigned = inbox.find((n) => n.entityId === id && n.type === "task.assigned");
    expect(assigned?.title).toBe("New pickup: ABC Engineering");
    // Stored text uses absolute dates — "Today" would be wrong tomorrow.
    expect(assigned?.body).toBe("Collect pressure gauges · Thu, 8 Oct, 10:30 AM");

    // History reads in the order things happened, even within one transaction.
    const history = await listTaskEvents(priya, id);
    expect(history.map((e) => e.type)).toEqual(["created", "assigned"]);
    expect(history[1]?.assigneeName).toBe("Arun Kumar");
  });

  it("assigns work to the creator by default", async () => {
    const { id } = await createTask(rahul, { kind: "call", title: "Call Rajesh", companyId });
    expect((await getTask(rahul, id))?.assigneeId).toBe(rahul.actor.id);
  });

  it("does not let people without task.assign create work for others", async () => {
    await expect(
      createTask(rahul, { kind: "call", title: "Call for Arun", assigneeId: arun.actor.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createTask(rahul, { kind: "call", title: "Unassigned", assigneeId: "" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("does not let collection staff create work at all", async () => {
    await expect(createTask(arun, { kind: "general", title: "Anything" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("validates input with field-level messages", async () => {
    const error = await createTask(priya, { kind: "pickup", title: "  ", dueTime: "10:00" }).catch((e) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fieldErrors).toMatchObject({
      title: "Say what needs to be done.",
      dueDate: "Choose a date for this time.",
    });
  });

  it("lets coordinators leave work unassigned for later", async () => {
    const { id } = await createTask(priya, { kind: "delivery", title: "Deliver gauges", companyId, assigneeId: "" });
    expect((await getTask(priya, id))?.status).toBe("pending");
    expect((await listUnassigned(priya)).some((t) => t.id === id)).toBe(true);
  });
});

describe("who can see what", () => {
  let arunsPickup: string;
  let rahulsCall: string;

  beforeAll(async () => {
    arunsPickup = (await createTask(priya, { kind: "pickup", title: "Arun's pickup", companyId, assigneeId: arun.actor.id })).id;
    rahulsCall = (await createTask(rahul, { kind: "call", title: "Rahul's private call", companyId })).id;
  });

  it("hides a colleague's work, even when its ID is put in the URL", async () => {
    expect(await getTask(manju, arunsPickup)).toBeNull();
    expect(await listTaskEvents(manju, arunsPickup)).toEqual([]);
    await expect(transitionTask(manju, { taskId: arunsPickup, action: "mark_collected" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(addTaskComment(manju, { taskId: arunsPickup, body: "hi" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("treats malformed IDs as not found rather than erroring", async () => {
    expect(await getTask(arun, "not-a-uuid")).toBeNull();
    expect(await getTask(arun, "../../etc/passwd")).toBeNull();
  });

  it("lets operations see every pickup and delivery, but not marketing's calls", async () => {
    expect(await getTask(lakshmi, arunsPickup)).not.toBeNull();
    expect(await getTask(lakshmi, rahulsCall)).toBeNull();
  });

  it("lets coordinators see everything", async () => {
    expect(await getTask(priya, rahulsCall)).not.toBeNull();
    const team = await listWork(priya, { scope: "team", view: "open" });
    expect(team.map((t) => t.id)).toEqual(expect.arrayContaining([arunsPickup, rahulsCall]));
  });

  it("refuses the team view to people without company-wide access", async () => {
    await expect(listWork(rahul, { scope: "team", view: "open" })).rejects.toBeInstanceOf(ForbiddenError);
    // Collection staff may not list all pickups either.
    await expect(listWork(arun, { scope: "team", view: "open", kinds: ["pickup", "delivery"] })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    // …but operations may.
    await expect(listWork(lakshmi, { scope: "team", view: "open", kinds: ["pickup", "delivery"] })).resolves.toBeInstanceOf(
      Array,
    );
  });
});

describe("the pickup hand-off", () => {
  it("runs from assignment to received at PTCC, notifying each side", async () => {
    const { id } = await createTask(priya, {
      kind: "pickup",
      title: "Collect thermocouples",
      companyId,
      assigneeId: arun.actor.id,
    });

    await transitionTask(arun, { taskId: id, action: "start" });
    expect((await getTask(arun, id))?.status).toBe("in_progress");

    await transitionTask(arun, { taskId: id, action: "mark_collected" });
    const mine = await listWork(arun, { scope: "mine", view: "open" });
    expect(mine.some((t) => t.id === id)).toBe(false); // Arun's part is done
    const done = await listWork(arun, { scope: "mine", view: "done" });
    expect(done.some((t) => t.id === id)).toBe(true);
    expect((await notificationsFor(priya)).some((n) => n.entityId === id && n.type === "task.progress")).toBe(true);

    // The collector cannot close it; the coordinator receives it.
    await expect(transitionTask(arun, { taskId: id, action: "receive" })).rejects.toBeInstanceOf(ForbiddenError);
    await transitionTask(priya, { taskId: id, action: "receive" });
    const task = await getTask(priya, id);
    expect(task?.status).toBe("completed");
    expect(task?.completedAt).toBeInstanceOf(Date);
    const closed = (await notificationsFor(arun)).find((n) => n.entityId === id && n.type === "task.closed");
    expect(closed?.title).toBe(`Pickup #${task?.number} received at PTCC: ABC Engineering`);

    const events = await listTaskEvents(priya, id);
    expect(events.map((e) => e.toStatus).filter(Boolean)).toEqual(["assigned", "in_progress", "collected", "completed"]);
    const audit = await handle.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, id), eq(auditLogs.action, "task.status_change")));
    expect(audit).toHaveLength(3);
  });

  it("answers a repeated tap with a clear conflict instead of changing anything", async () => {
    const { id } = await createTask(priya, { kind: "pickup", title: "Double tap", assigneeId: arun.actor.id });
    await transitionTask(arun, { taskId: id, action: "mark_collected" });
    await expect(transitionTask(arun, { taskId: id, action: "mark_collected" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("requires a reason to cancel, and only the creator or a manager may cancel", async () => {
    const { id } = await createTask(priya, { kind: "pickup", title: "To cancel", assigneeId: arun.actor.id });
    await expect(transitionTask(arun, { taskId: id, action: "cancel", reason: "busy" })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(transitionTask(priya, { taskId: id, action: "cancel" })).rejects.toBeInstanceOf(ValidationError);
    await transitionTask(priya, { taskId: id, action: "cancel", reason: "Customer postponed" });
    const task = await getTask(priya, id);
    expect(task).toMatchObject({ status: "cancelled", cancelReason: "Customer postponed" });
  });
});

describe("reassigning", () => {
  it("moves the work and tells both people", async () => {
    const { id } = await createTask(priya, { kind: "pickup", title: "Reassign me", assigneeId: arun.actor.id });
    await transitionTask(arun, { taskId: id, action: "start" });
    await assignTask(priya, { taskId: id, assigneeId: manju.actor.id });

    const task = await getTask(priya, id);
    expect(task).toMatchObject({ assigneeId: manju.actor.id, status: "assigned", startedAt: null });
    expect(await getTask(arun, id)).toBeNull(); // no longer Arun's
    expect((await notificationsFor(manju)).some((n) => n.entityId === id && n.type === "task.assigned")).toBe(true);
    expect((await notificationsFor(arun)).some((n) => n.entityId === id && n.type === "task.reassigned")).toBe(true);
  });

  it("is refused once the work is finished, and for people without task.assign", async () => {
    const { id } = await createTask(priya, { kind: "pickup", title: "Finished", assigneeId: arun.actor.id });
    await expect(assignTask(rahul, { taskId: id, assigneeId: manju.actor.id })).rejects.toBeInstanceOf(ForbiddenError);
    await transitionTask(arun, { taskId: id, action: "mark_collected" });
    await expect(assignTask(priya, { taskId: id, assigneeId: manju.actor.id })).rejects.toBeInstanceOf(ConflictError);
  });

  it("refuses inactive people as assignees", async () => {
    const inactiveId = await createTestUser(handle.db, { roles: ["collection"], status: "inactive" });
    const { id } = await createTask(priya, { kind: "pickup", title: "Needs someone", assigneeId: "" });
    await expect(assignTask(priya, { taskId: id, assigneeId: inactiveId })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("notes", () => {
  it("are added to the history and notify the other people on the work", async () => {
    const { id } = await createTask(priya, { kind: "pickup", title: "With a note", assigneeId: arun.actor.id });
    await addTaskComment(arun, { taskId: id, body: "Security gate needs the PO number." });
    const events = await listTaskEvents(priya, id);
    expect(events.at(-1)).toMatchObject({ type: "comment", body: "Security gate needs the PO number.", actorName: "Arun Kumar" });
    expect((await notificationsFor(priya)).some((n) => n.entityId === id && n.type === "task.comment")).toBe(true);
    // The author is not notified about their own note.
    expect((await notificationsFor(arun)).some((n) => n.entityId === id && n.type === "task.comment")).toBe(false);
  });
});

describe("database constraints", () => {
  it("reject statuses that don't match the kind of work", async () => {
    const { id } = await createTask(rahul, { kind: "call", title: "Constraint check" });
    await expect(handle.db.update(tasks).set({ status: "collected" }).where(eq(tasks.id, id))).rejects.toThrow();
  });
});
