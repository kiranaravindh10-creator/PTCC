/**
 * The work (task) state machine — the single definition of which status changes are
 * possible, for which kinds of work, and who may make them.
 *
 * The UI asks `availableActions()` what to show; the server validates every change
 * with `checkTransition()`. Both read the same table, so they cannot disagree.
 * Diagram: docs/DATABASE_ARCHITECTURE.md §5.
 */

import { can, coversBranch, type Actor } from "@/server/access/actor";
import type { TaskKind, TaskStatus } from "./model";

export const TASK_ACTIONS = [
  "start",
  "mark_collected",
  "mark_delivered",
  "complete",
  "receive",
  "close",
  "cancel",
] as const;
export type TaskAction = (typeof TASK_ACTIONS)[number];

/**
 * Who may perform a transition:
 * - `assignee`: the person assigned (with task.work), or a manager of the task's branch
 * - `manager`: task.manage covering the task's branch (task.manage.branch / .all)
 * - `creator`: whoever created the work, or a manager of the task's branch
 */
type Performer = "assignee" | "manager" | "creator";

type Transition = {
  action: TaskAction;
  kinds: readonly TaskKind[];
  from: readonly TaskStatus[];
  to: TaskStatus;
  by: Performer;
  label: string | Partial<Record<TaskKind, string>> & { default: string };
  /** What happened, for notifications: "Pickup #1042 received at PTCC". */
  past: string;
};

const ALL_KINDS: readonly TaskKind[] = ["general", "call", "follow_up", "pickup", "delivery"];
const OPEN: readonly TaskStatus[] = ["pending", "assigned", "in_progress"];

/** Order matters: it is the order actions are offered in, most natural next step first. */
const TRANSITIONS: readonly Transition[] = [
  {
    action: "start",
    kinds: ["general", "pickup", "delivery"],
    from: ["assigned"],
    to: "in_progress",
    by: "assignee",
    label: { default: "Start", pickup: "Start pickup", delivery: "Start delivery" },
    past: "started",
  },
  {
    action: "mark_collected",
    kinds: ["pickup"],
    from: ["assigned", "in_progress"],
    to: "collected",
    by: "assignee",
    label: "Mark collected",
    past: "collected",
  },
  {
    action: "mark_delivered",
    kinds: ["delivery"],
    from: ["assigned", "in_progress"],
    to: "delivered",
    by: "assignee",
    label: "Mark delivered",
    past: "delivered",
  },
  {
    action: "complete",
    kinds: ["general", "call", "follow_up"],
    from: ["assigned", "in_progress"],
    to: "completed",
    by: "assignee",
    label: "Mark done",
    past: "completed",
  },
  {
    action: "receive",
    kinds: ["pickup"],
    from: ["collected"],
    to: "completed",
    by: "manager",
    label: "Received at PTCC",
    past: "received at PTCC",
  },
  {
    action: "close",
    kinds: ["delivery"],
    from: ["delivered"],
    to: "completed",
    by: "manager",
    label: "Close delivery",
    past: "closed",
  },
  {
    action: "cancel",
    kinds: ALL_KINDS,
    from: OPEN,
    to: "cancelled",
    by: "creator",
    label: "Cancel",
    past: "cancelled",
  },
];

export type WorkflowTask = {
  kind: TaskKind;
  status: TaskStatus;
  assigneeId: string | null;
  createdBy: string;
  branchId: string;
};

export type AvailableAction = {
  action: TaskAction;
  label: string;
  to: TaskStatus;
};

function labelFor(transition: Transition, kind: TaskKind): string {
  if (typeof transition.label === "string") return transition.label;
  return transition.label[kind] ?? transition.label.default;
}

function findTransition(task: WorkflowTask, action: TaskAction): Transition | undefined {
  return TRANSITIONS.find(
    (t) => t.action === action && t.kinds.includes(task.kind) && t.from.includes(task.status),
  );
}

function mayPerform(transition: Transition, task: WorkflowTask, actor: Actor): boolean {
  if (coversBranch(actor, "task.manage", task.branchId)) return true;
  switch (transition.by) {
    case "assignee":
      return task.assigneeId === actor.id && can(actor, "task.work");
    case "creator":
      return task.createdBy === actor.id;
    case "manager":
      return false;
  }
}

/** Actions this actor can take on this task right now, in display order. */
export function availableActions(task: WorkflowTask, actor: Actor): AvailableAction[] {
  return TRANSITIONS.filter(
    (t) => t.kinds.includes(task.kind) && t.from.includes(task.status) && mayPerform(t, task, actor),
  ).map((t) => ({ action: t.action, label: labelFor(t, task.kind), to: t.to }));
}

export type TransitionCheck =
  | { ok: true; to: TaskStatus; label: string; past: string }
  | { ok: false; reason: "invalid_state" | "forbidden" };

/** Server-side validation of a requested status change. */
export function checkTransition(task: WorkflowTask, action: TaskAction, actor: Actor): TransitionCheck {
  const transition = findTransition(task, action);
  if (!transition) return { ok: false, reason: "invalid_state" };
  if (!mayPerform(transition, task, actor)) return { ok: false, reason: "forbidden" };
  return { ok: true, to: transition.to, label: labelFor(transition, task.kind), past: transition.past };
}

/** Work can be (re)assigned while it is open, by someone whose assign scope covers its branch. */
export function canAssign(task: Pick<WorkflowTask, "status" | "branchId">, actor: Actor): boolean {
  return OPEN.includes(task.status) && coversBranch(actor, "task.assign", task.branchId);
}

export function isTaskAction(value: string): value is TaskAction {
  return (TASK_ACTIONS as readonly string[]).includes(value);
}
