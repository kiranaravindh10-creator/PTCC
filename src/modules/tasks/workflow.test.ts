import { describe, expect, it } from "vitest";
import type { Actor } from "@/server/access/actor";
import type { PermissionKey } from "@/server/access/permissions";
import { ROLES, type RoleKey } from "@/server/access/roles";
import { availableActions, canAssign, checkTransition, type WorkflowTask } from "./workflow";

function actorWith(id: string, role: RoleKey, branchId = "bengaluru"): Actor {
  return {
    id,
    name: id,
    roleKeys: [role],
    permissions: new Set<PermissionKey>(ROLES[role].permissions),
    mustChangePassword: false,
    branchId,
    branchName: branchId,
  };
}

const arun = actorWith("arun", "collection");
const manju = actorWith("manju", "collection");
const priya = actorWith("priya", "hr");
const rahul = actorWith("rahul", "marketing");

const pickup = (status: WorkflowTask["status"], assigneeId: string | null = "arun"): WorkflowTask => ({
  kind: "pickup",
  status,
  assigneeId,
  createdBy: "priya",
  branchId: "bengaluru",
});

describe("pickup workflow", () => {
  it("lets the assignee start and collect", () => {
    expect(availableActions(pickup("assigned"), arun).map((a) => a.action)).toEqual(["start", "mark_collected"]);
    expect(availableActions(pickup("in_progress"), arun).map((a) => a.action)).toEqual(["mark_collected"]);
  });

  it("does not let a colleague act on someone else's pickup", () => {
    expect(availableActions(pickup("assigned"), manju)).toEqual([]);
    expect(checkTransition(pickup("assigned"), "mark_collected", manju)).toEqual({ ok: false, reason: "forbidden" });
  });

  it("lets only a manager mark a collected pickup as received", () => {
    expect(availableActions(pickup("collected"), arun)).toEqual([]);
    expect(checkTransition(pickup("collected"), "receive", priya)).toMatchObject({ ok: true, to: "completed" });
  });

  it("rejects transitions that don't apply to the current status", () => {
    expect(checkTransition(pickup("completed"), "mark_collected", arun)).toEqual({ ok: false, reason: "invalid_state" });
    expect(checkTransition(pickup("assigned"), "mark_delivered", arun)).toEqual({ ok: false, reason: "invalid_state" });
  });

  it("uses kind-specific labels", () => {
    expect(availableActions(pickup("assigned"), arun)[0]?.label).toBe("Start pickup");
  });
});

describe("calls and follow-ups", () => {
  const call: WorkflowTask = { kind: "call", status: "assigned", assigneeId: "rahul", createdBy: "rahul", branchId: "bengaluru" };

  it("have no 'start' step — just done or cancel", () => {
    expect(availableActions(call, rahul).map((a) => a.action)).toEqual(["complete", "cancel"]);
  });
});

describe("cancelling", () => {
  it("is allowed for the creator and managers, not the assignee", () => {
    expect(checkTransition(pickup("assigned"), "cancel", arun)).toEqual({ ok: false, reason: "forbidden" });
    expect(checkTransition(pickup("assigned"), "cancel", priya)).toMatchObject({ ok: true, to: "cancelled" });
  });

  it("is not possible once work is finished", () => {
    expect(checkTransition(pickup("completed"), "cancel", priya)).toEqual({ ok: false, reason: "invalid_state" });
  });
});

describe("branch scope", () => {
  const chennaiCoordinator = actorWith("karthik", "hr", "chennai");
  const ceo = actorWith("ceo", "ceo", "");

  it("lets a coordinator manage work in their own branch only", () => {
    expect(checkTransition(pickup("collected"), "receive", priya)).toMatchObject({ ok: true });
    expect(checkTransition(pickup("collected"), "receive", chennaiCoordinator)).toEqual({ ok: false, reason: "forbidden" });
    expect(canAssign(pickup("pending", null), chennaiCoordinator)).toBe(false);
  });

  it("lets the CEO manage and assign work in every branch", () => {
    expect(checkTransition(pickup("collected"), "receive", ceo)).toMatchObject({ ok: true });
    expect(canAssign(pickup("pending", null), ceo)).toBe(true);
  });
});

describe("assignment", () => {
  it("requires task.assign and open work", () => {
    expect(canAssign(pickup("pending", null), priya)).toBe(true);
    expect(canAssign(pickup("in_progress"), priya)).toBe(true);
    expect(canAssign(pickup("collected"), priya)).toBe(false);
    expect(canAssign(pickup("pending", null), arun)).toBe(false);
  });
});
