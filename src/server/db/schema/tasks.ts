import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  TASK_EVENT_TYPES,
  TASK_KINDS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskEventType,
  type TaskKind,
  type TaskPriority,
  type TaskStatus,
} from "@/modules/tasks/model";
import { createdAt, id, inList, updatedAt, userRef } from "./_columns";
import { companies, contacts } from "./customers";
import { branches, users } from "./identity";
import { leads } from "./marketing";

/**
 * Every unit of work in the company — follow-ups, calls, pickups, deliveries and
 * general tasks. Statuses and transitions: src/modules/tasks/workflow.ts.
 */
export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    /** Human reference used in conversation: #1042. */
    number: integer().notNull().generatedAlwaysAsIdentity({ startWith: 1001 }),
    kind: text().$type<TaskKind>().notNull(),
    title: text().notNull(),
    details: text(),
    status: text().$type<TaskStatus>().notNull(),
    priority: text().$type<TaskPriority>().notNull().default("normal"),
    /** The branch this work belongs to. Branch-scoped permissions apply to it. */
    branchId: uuid()
      .notNull()
      .references(() => branches.id, { onDelete: "restrict" }),
    /** Follow-ups and calls about a lead. */
    leadId: uuid().references(() => leads.id, { onDelete: "restrict" }),

    // Who
    companyId: uuid().references(() => companies.id, { onDelete: "restrict" }),
    contactId: uuid().references(() => contacts.id, { onDelete: "restrict" }),
    contactName: text(),
    contactPhone: text(),

    // Where (snapshot: a pickup may be somewhere other than the company's main address)
    locationAddress: text(),
    locationArea: text(),
    latitude: numeric({ precision: 9, scale: 6 }),
    longitude: numeric({ precision: 9, scale: 6 }),

    // When — calendar date and optional time in the company time zone (Asia/Kolkata)
    dueDate: date({ mode: "string" }),
    dueTime: time(),

    // Assignment and progress
    assigneeId: userRef(() => users.id),
    assignedBy: userRef(() => users.id),
    assignedAt: timestamp({ withTimezone: true }),
    startedAt: timestamp({ withTimezone: true }),
    completedAt: timestamp({ withTimezone: true }),
    completedBy: userRef(() => users.id),
    cancelledAt: timestamp({ withTimezone: true }),
    cancelReason: text(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdBy: userRef(() => users.id).notNull(),
    updatedBy: userRef(() => users.id),
  },
  (t) => [
    uniqueIndex("tasks_number_unique").on(t.number),
    index("tasks_assignee_status_idx").on(t.assigneeId, t.status),
    index("tasks_status_due_idx").on(t.status, t.dueDate),
    index("tasks_company_idx").on(t.companyId),
    index("tasks_created_by_idx").on(t.createdBy),
    index("tasks_branch_status_idx").on(t.branchId, t.status),
    index("tasks_lead_idx").on(t.leadId),
    check("tasks_kind_check", inList(t.kind, TASK_KINDS)),
    check("tasks_status_check", inList(t.status, TASK_STATUSES)),
    check("tasks_priority_check", inList(t.priority, TASK_PRIORITIES)),
    check("tasks_due_time_needs_date_check", sql`${t.dueTime} is null or ${t.dueDate} is not null`),
    check(
      "tasks_pending_iff_unassigned_check",
      sql`${t.status} = 'cancelled' or ((${t.status} = 'pending') = (${t.assigneeId} is null))`,
    ),
    check(
      "tasks_field_kind_status_check",
      sql`(${t.status} <> 'collected' or ${t.kind} = 'pickup') and (${t.status} <> 'delivered' or ${t.kind} = 'delivery')`,
    ),
  ],
);

/** History and conversation of a work item. */
export const taskEvents = pgTable(
  "task_events",
  {
    id: id(),
    /**
     * Insertion order. Several events written in one transaction share the same
     * created_at (Postgres now() is the transaction start), so history is ordered by seq.
     */
    seq: bigint({ mode: "number" }).notNull().generatedAlwaysAsIdentity(),
    taskId: uuid()
      .notNull()
      .references(() => tasks.id, { onDelete: "restrict" }),
    /** null for system-generated events. */
    actorId: userRef(() => users.id),
    type: text().$type<TaskEventType>().notNull(),
    fromStatus: text().$type<TaskStatus>(),
    toStatus: text().$type<TaskStatus>(),
    body: text(),
    meta: jsonb().$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [
    index("task_events_task_idx").on(t.taskId, t.seq),
    check("task_events_type_check", inList(t.type, TASK_EVENT_TYPES)),
  ],
);
