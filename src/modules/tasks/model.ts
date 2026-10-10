/**
 * Work (task) vocabulary shared by the database schema, the workflow, the server
 * and the UI. Pure module — safe to import anywhere.
 */

export const TASK_KINDS = ["general", "call", "follow_up", "pickup", "delivery"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const TASK_STATUSES = [
  "pending",
  "assigned",
  "in_progress",
  "collected",
  "delivered",
  "completed",
  "cancelled",
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_EVENT_TYPES = [
  "created",
  "assigned",
  "status_changed",
  "comment",
  "updated",
] as const;
export type TaskEventType = (typeof TASK_EVENT_TYPES)[number];

export const KIND_LABEL: Record<TaskKind, string> = {
  general: "Task",
  call: "Call",
  follow_up: "Follow-up",
  pickup: "Pickup",
  delivery: "Delivery",
};

export const KIND_LABEL_PLURAL: Record<TaskKind, [singular: string, plural: string]> = {
  general: ["task", "tasks"],
  call: ["call", "calls"],
  follow_up: ["follow-up", "follow-ups"],
  pickup: ["pickup", "pickups"],
  delivery: ["delivery", "deliveries"],
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "Pending",
  assigned: "Assigned",
  in_progress: "In progress",
  collected: "Collected",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

/** Statuses in which work is finished for everyone. */
export const CLOSED_STATUSES: readonly TaskStatus[] = ["completed", "cancelled"];

/**
 * Statuses in which the assignee's part is finished. A collected pickup still needs
 * receiving at PTCC, and a delivered delivery still needs closing, but neither is
 * on the field employee's list any more.
 */
export const DONE_FOR_ASSIGNEE_STATUSES: readonly TaskStatus[] = [
  "collected",
  "delivered",
  "completed",
  "cancelled",
];

/** Statuses that still need the assignee to act. */
export const OPEN_FOR_ASSIGNEE_STATUSES: readonly TaskStatus[] = ["assigned", "in_progress"];

export const FIELD_KINDS: readonly TaskKind[] = ["pickup", "delivery"];

export function isFieldKind(kind: TaskKind): boolean {
  return FIELD_KINDS.includes(kind);
}

/** Sort weight for priority (higher first). */
export const PRIORITY_WEIGHT: Record<TaskPriority, number> = {
  urgent: 3,
  high: 2,
  normal: 1,
  low: 0,
};
