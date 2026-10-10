"use client";

import { Navigation } from "lucide-react";
import { useActionState, useTransition } from "react";
import { buttonClasses, type ButtonSize, type ButtonVariant } from "@/components/ui/button";
import { describedBy, Field, Select, Textarea } from "@/components/ui/field";
import { MoreDetails, Notice } from "@/components/ui/display";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionState } from "@/server/action-result";
import { assignTaskAction, startTaskFromRouteAction, transitionTaskAction } from "../actions";

const IDLE: ActionState = { status: "idle" };

/**
 * Opens Google Maps navigation and — if the work hasn't been started — marks it
 * "In progress" in the background. The map opens instantly because it's a real link.
 */
export function StartRouteButton({
  href,
  taskId,
  startOnOpen,
  variant = "primary",
  size = "md",
  className,
  label = "Start route",
}: {
  href: string;
  taskId: string;
  startOnOpen: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  label?: string;
}) {
  const [, startTransition] = useTransition();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={buttonClasses(variant, size, className)}
      onClick={() => {
        if (startOnOpen) startTransition(() => startTaskFromRouteAction(taskId));
      }}
    >
      <Navigation aria-hidden />
      {label}
    </a>
  );
}

export type ActionButton = { action: string; label: string };

/** Workflow buttons for a task (Start, Mark collected, …). The first is primary. */
export function TransitionButtons({
  taskId,
  actions,
  primaryTaken = false,
}: {
  taskId: string;
  actions: ActionButton[];
  /** True when another control on the page is already the primary action (e.g. Start route). */
  primaryTaken?: boolean;
}) {
  const [state, formAction] = useActionState(transitionTaskAction, IDLE);
  const forward = actions.filter((a) => a.action !== "cancel");
  if (forward.length === 0) return null;
  return (
    <div className="space-y-3">
      <form action={formAction} className="flex flex-wrap gap-2">
        <input type="hidden" name="taskId" value={taskId} />
        {forward.map((item, index) => (
          <SubmitButton
            key={item.action}
            name="action"
            value={item.action}
            variant={index === 0 && !primaryTaken ? "primary" : "secondary"}
            pendingLabel="Updating…"
            className="max-sm:flex-1"
          >
            {item.label}
          </SubmitButton>
        ))}
      </form>
      {state.status === "error" && <Notice tone="danger">{state.message}</Notice>}
    </div>
  );
}

/** Cancelling asks for a reason, tucked away behind disclosure so it's never the obvious action. */
export function CancelTask({ taskId }: { taskId: string }) {
  const [state, formAction] = useActionState(transitionTaskAction, IDLE);
  const error = state.status === "error" ? (state.fieldErrors?.reason ?? state.message) : undefined;
  return (
    <MoreDetails summary="Cancel this work">
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="taskId" value={taskId} />
        <input type="hidden" name="action" value="cancel" />
        <Field id="cancel-reason" label="Why is it being cancelled?" error={error}>
          <Textarea {...describedBy("cancel-reason", error)} name="reason" rows={2} placeholder="e.g. Customer postponed to next week" />
        </Field>
        <SubmitButton variant="danger" pendingLabel="Cancelling…">
          Cancel work
        </SubmitButton>
      </form>
    </MoreDetails>
  );
}

export type PersonChoice = { id: string; name: string; roleNames: string[]; branchName?: string | null };

/** Assign or reassign — a person picker and one button. */
export function AssignForm({
  taskId,
  people,
  currentAssigneeId,
  compact = false,
}: {
  taskId: string;
  people: PersonChoice[];
  currentAssigneeId: string | null;
  compact?: boolean;
}) {
  const [state, formAction] = useActionState(assignTaskAction, IDLE);
  const selectId = `assignee-${taskId}`;
  // Only people who can see several branches get a list spanning branches — then say which is which.
  const showBranch = new Set(people.map((person) => person.branchName ?? null)).size > 1;
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="taskId" value={taskId} />
      <div className="flex gap-2">
        <label htmlFor={selectId} className="sr-only">
          Assign to
        </label>
        <Select id={selectId} name="assigneeId" defaultValue={currentAssigneeId ?? ""} required className={compact ? "lg:h-9" : undefined}>
          <option value="" disabled>
            Choose a person…
          </option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
              {showBranch ? ` (${person.branchName ?? "Company level"})` : ""}
              {person.roleNames.length ? ` — ${person.roleNames.join(", ")}` : ""}
            </option>
          ))}
        </Select>
        <SubmitButton variant="secondary" size={compact ? "sm" : "md"} pendingLabel="Assigning…" className={compact ? "h-11 lg:h-9" : undefined}>
          {currentAssigneeId ? "Reassign" : "Assign"}
        </SubmitButton>
      </div>
      {state.status === "error" && <p className="text-sm text-danger-700" role="alert">{state.message}</p>}
      {state.status === "success" && state.message && (
        <p className="text-sm text-success-700" role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}
