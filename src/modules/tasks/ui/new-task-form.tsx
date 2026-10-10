"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { buttonClasses } from "@/components/ui/button";
import { Choice, describedBy, Field, FieldError, Input, Select, Textarea } from "@/components/ui/field";
import { MoreDetails, Notice } from "@/components/ui/display";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/format";
import type { ActionState } from "@/server/action-result";
import { createTaskAction } from "../actions";
import { KIND_LABEL, TASK_KINDS, type TaskKind } from "../model";
import type { CompanyOption, PersonOption } from "../queries";

const IDLE: ActionState = { status: "idle" };

const TITLE_PLACEHOLDER: Record<TaskKind, string> = {
  general: "e.g. Prepare list of Peenya prospects",
  call: "e.g. Call about torque wrench calibration",
  follow_up: "e.g. Follow up on quotation",
  pickup: "e.g. Collect 6 pressure gauges",
  delivery: "e.g. Deliver calibrated gauges and certificates",
};

/**
 * New work — four things up front (what, kind, customer, when), everything else behind
 * "Add more details". Address and contact come from the customer when left blank.
 */
export function NewTaskForm({
  companies,
  people,
  actorId,
  today,
  defaultKind,
  branches,
  defaultBranchId,
}: {
  companies: CompanyOption[];
  /** null when the person can only create work for themselves. */
  people: PersonOption[] | null;
  actorId: string;
  today: string;
  defaultKind: TaskKind;
  /** Only for people who assign across branches (e.g. the CEO); others work in their own branch. */
  branches: { id: string; name: string }[] | null;
  defaultBranchId: string;
}) {
  const [state, formAction] = useActionState(createTaskAction, IDLE);
  const values = state.status === "error" ? (state.values ?? {}) : {};
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const value = (key: string, fallback = "") => (typeof values[key] === "string" ? (values[key] as string) : fallback);

  const [kind, setKind] = useState<TaskKind>((value("kind") as TaskKind) || defaultKind);
  const isField = kind === "pickup" || kind === "delivery";
  // Coordinators usually create pickups/deliveries for someone else; leave them open to assign.
  const defaultAssignee = value("assigneeId", isField ? "" : actorId);
  const others = people?.filter((person) => person.id !== actorId) ?? [];

  return (
    <form action={formAction} className="max-w-2xl space-y-6" noValidate>
      {state.status === "error" && <Notice tone="danger">{state.message}</Notice>}

      <fieldset>
        <legend className="mb-2 text-sm font-medium">What kind of work?</legend>
        <div className="flex flex-wrap gap-2">
          {TASK_KINDS.map((option) => (
            <label key={option} className="relative">
              <input
                type="radio"
                name="kind"
                value={option}
                checked={kind === option}
                onChange={() => setKind(option)}
                className="peer absolute inset-0 cursor-pointer opacity-0"
              />
              <span
                className={cn(
                  "inline-flex h-10 items-center rounded-full border px-4 text-sm font-medium transition-colors duration-150 lg:h-9",
                  "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-500",
                  kind === option
                    ? "border-brand-600 bg-brand-50 text-brand-700"
                    : "border-line-strong bg-surface text-ink-muted hover:border-ink-subtle",
                )}
              >
                {KIND_LABEL[option]}
              </span>
            </label>
          ))}
        </div>
        <FieldError id="kind" error={errors.kind} />
      </fieldset>

      <Field id="title" label="What needs to be done?" error={errors.title}>
        <Input
          {...describedBy("title", errors.title)}
          name="title"
          maxLength={160}
          placeholder={TITLE_PLACEHOLDER[kind]}
          defaultValue={value("title")}
          required
        />
      </Field>

      <Field
        id="companyId"
        label="Customer"
        optional
        error={errors.companyId}
        hint={companies.length === 0 ? "No customers yet — they arrive with the Customers module (Phase 2)." : undefined}
      >
        <Select {...describedBy("companyId", errors.companyId, companies.length === 0)} name="companyId" defaultValue={value("companyId")}>
          <option value="">No customer</option>
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name}
              {company.area ? ` — ${company.area}` : ""}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="dueDate" label="Date" error={errors.dueDate}>
          <Input {...describedBy("dueDate", errors.dueDate)} type="date" name="dueDate" defaultValue={value("dueDate", today)} />
        </Field>
        <Field id="dueTime" label="Time" optional error={errors.dueTime}>
          <Input {...describedBy("dueTime", errors.dueTime)} type="time" name="dueTime" defaultValue={value("dueTime")} />
        </Field>
      </div>

      {branches && (
        <Field id="branchId" label="Branch" error={errors.branchId} hint="Assigning someone moves the work to their branch.">
          <Select {...describedBy("branchId", errors.branchId, true)} name="branchId" defaultValue={value("branchId", defaultBranchId)}>
            <option value="">The assignee&apos;s branch</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {people && (
        <Field id="assigneeId" label="Assign to" error={errors.assigneeId}>
          <Select key={isField ? "field" : "office"} {...describedBy("assigneeId", errors.assigneeId)} name="assigneeId" defaultValue={defaultAssignee}>
            <option value={actorId}>Me</option>
            {others.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
                {person.roleNames.length ? ` — ${person.roleNames.join(", ")}` : ""}
                {branches && person.branchName ? ` (${person.branchName})` : ""}
              </option>
            ))}
            <option value="">Leave unassigned for now</option>
          </Select>
        </Field>
      )}

      <MoreDetails defaultOpen={Boolean(value("details") || value("contactName") || value("locationAddress") || errors.contactPhone)}>
        <Choice
          name="priority"
          legend="Priority"
          defaultValue={value("priority", "normal")}
          options={[
            { value: "low", label: "Low" },
            { value: "normal", label: "Normal" },
            { value: "high", label: "High" },
            { value: "urgent", label: "Urgent" },
          ]}
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="contactName" label="Contact person" optional error={errors.contactName}>
            <Input {...describedBy("contactName", errors.contactName)} name="contactName" defaultValue={value("contactName")} />
          </Field>
          <Field id="contactPhone" label="Contact phone" optional error={errors.contactPhone}>
            <Input
              {...describedBy("contactPhone", errors.contactPhone)}
              name="contactPhone"
              type="tel"
              inputMode="tel"
              placeholder="98765 43210"
              defaultValue={value("contactPhone")}
            />
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-[2fr_1fr]">
          <Field id="locationAddress" label="Address" optional error={errors.locationAddress}>
            <Input {...describedBy("locationAddress", errors.locationAddress)} name="locationAddress" defaultValue={value("locationAddress")} />
          </Field>
          <Field id="locationArea" label="Area" optional error={errors.locationArea}>
            <Input {...describedBy("locationArea", errors.locationArea)} name="locationArea" placeholder="e.g. Peenya" defaultValue={value("locationArea")} />
          </Field>
        </div>
        <p className="-mt-2 text-sm text-ink-muted">Leave contact and address blank to use the customer&apos;s details.</p>
        <Field id="details" label="Notes" optional error={errors.details}>
          <Textarea {...describedBy("details", errors.details)} name="details" rows={3} defaultValue={value("details")} />
        </Field>
      </MoreDetails>

      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <SubmitButton size="lg" pendingLabel="Creating…" className="max-sm:w-full">
          Create {KIND_LABEL[kind].toLowerCase()}
        </SubmitButton>
        <Link href="/work" className={buttonClasses("ghost", "lg", "max-sm:w-full")}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
