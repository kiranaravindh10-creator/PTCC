/**
 * Builds a person's daily briefing from their open work. Pure — no I/O — so the
 * rules for "what's next" are easy to test and reason about.
 */

import { dueGroup, type IsoDate } from "@/lib/time";
import { PRIORITY_WEIGHT, TASK_KINDS, type TaskKind, type TaskPriority, type TaskStatus } from "@/modules/tasks/model";

export type BriefingTask = {
  kind: TaskKind;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: IsoDate | null;
  dueTime: string | null;
  number: number;
};

export type Briefing<T extends BriefingTask> = {
  overdue: T[];
  today: T[];
  /** The one thing to do next: already-started work first, then overdue, then urgency, then time. */
  nextUp: T | null;
  /** Today's (and overdue) work after `nextUp`. */
  rest: T[];
  /** Today + overdue work by kind, largest first. */
  countsByKind: { kind: TaskKind; count: number }[];
  upcomingCount: number;
  unscheduledCount: number;
};

function compareForNext(a: BriefingTask, b: BriefingTask, today: IsoDate): number {
  const started = Number(b.status === "in_progress") - Number(a.status === "in_progress");
  if (started !== 0) return started;
  const overdue = Number(dueGroup(b.dueDate, today) === "overdue") - Number(dueGroup(a.dueDate, today) === "overdue");
  if (overdue !== 0) return overdue;
  const urgent = Number(b.priority === "urgent") - Number(a.priority === "urgent");
  if (urgent !== 0) return urgent;
  // Earlier date, then earlier time; untimed work after timed work on the same day.
  if (a.dueDate !== b.dueDate) return (a.dueDate ?? "9999") < (b.dueDate ?? "9999") ? -1 : 1;
  if (a.dueTime !== b.dueTime) return (a.dueTime ?? "99") < (b.dueTime ?? "99") ? -1 : 1;
  const priority = PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority];
  if (priority !== 0) return priority;
  return a.number - b.number;
}

export function buildBriefing<T extends BriefingTask>(openTasks: readonly T[], today: IsoDate): Briefing<T> {
  const overdue = openTasks.filter((task) => dueGroup(task.dueDate, today) === "overdue");
  const dueToday = openTasks.filter((task) => dueGroup(task.dueDate, today) === "today");
  const focus = [...overdue, ...dueToday].sort((a, b) => compareForNext(a, b, today));
  const [nextUp = null, ...rest] = focus;

  const counts = new Map<TaskKind, number>();
  for (const task of focus) counts.set(task.kind, (counts.get(task.kind) ?? 0) + 1);
  const countsByKind = TASK_KINDS.filter((kind) => counts.has(kind))
    .map((kind) => ({ kind, count: counts.get(kind)! }))
    .sort((a, b) => b.count - a.count);

  return {
    overdue,
    today: dueToday,
    nextUp,
    rest,
    countsByKind,
    upcomingCount: openTasks.filter((task) => ["tomorrow", "upcoming"].includes(dueGroup(task.dueDate, today))).length,
    unscheduledCount: openTasks.filter((task) => task.dueDate === null).length,
  };
}
