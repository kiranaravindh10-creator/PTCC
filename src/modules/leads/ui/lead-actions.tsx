"use client";

import { CalendarPlus, MessageCircle, NotebookPen, Phone } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import { buttonClasses } from "@/components/ui/button";
import { describedBy, Field, FieldError, Input, Select, Textarea } from "@/components/ui/field";
import { MoreDetails, Notice } from "@/components/ui/display";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/format";
import type { ActionState } from "@/server/action-result";
import {
  addLeadNoteAction,
  addRequirementAction,
  assignLeadAction,
  changeStageAction,
  logCallAction,
  markLostAction,
  markWonAction,
  removeRequirementAction,
  reopenLeadAction,
  scheduleFollowUpAction,
  setLeadBranchAction,
  setQuotationStatusAction,
} from "../actions";
import { CALL_OUTCOME_LABEL, CALL_OUTCOMES, OPEN_LEAD_STAGES, STAGE_LABEL, type LeadStage } from "../model";
import { ServiceSearch } from "./service-picker";

const IDLE: ActionState = { status: "idle" };

function useForm(action: (state: ActionState, formData: FormData) => Promise<ActionState>) {
  const [state, formAction] = useActionState(action, IDLE);
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return { state, formAction, errors };
}

function Result({ state }: { state: ActionState }) {
  if (state.status === "error" && !Object.keys(state.fieldErrors ?? {}).length) return <Notice tone="danger">{state.message}</Notice>;
  if (state.status === "success" && state.message) {
    return (
      <p className="text-sm text-success-700" role="status">
        {state.message}
      </p>
    );
  }
  return null;
}

type Panel = "call" | "note" | "schedule" | null;

/**
 * The lead's quick actions — Call · WhatsApp · Add note · Schedule.
 * Tapping Call opens the dialler and the "How did it go?" form, so the call, its outcome
 * and the next follow-up are recorded in one step.
 */
export function LeadQuickActions({
  leadId,
  phone,
  whatsapp,
  canWork,
  canNote,
  canSchedule,
  initialPanel = null,
}: {
  leadId: string;
  phone: string | null;
  whatsapp: string | null;
  canWork: boolean;
  canNote: boolean;
  /** Follow-ups are work for the lead's owner, so they need a branch and an owner first. */
  canSchedule: boolean;
  initialPanel?: Panel;
}) {
  const [panel, setPanel] = useState<Panel>(initialPanel === "schedule" && !canSchedule ? null : initialPanel);
  const toggle = (next: Panel) => setPanel((current) => (current === next ? null : next));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {phone && canWork && (
          <a href={`tel:${phone}`} onClick={() => setPanel("call")} className={buttonClasses("primary", "md", "max-sm:flex-1")}>
            <Phone aria-hidden />
            Call
          </a>
        )}
        {canWork && !phone && (
          <button type="button" onClick={() => toggle("call")} className={buttonClasses("secondary", "md", "max-sm:flex-1")}>
            <Phone aria-hidden />
            Log a call
          </button>
        )}
        {whatsapp && (
          <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={buttonClasses("secondary", "md", "max-sm:flex-1")}>
            <MessageCircle aria-hidden />
            WhatsApp
          </a>
        )}
        {canNote && (
          <button type="button" onClick={() => toggle("note")} aria-expanded={panel === "note"} className={buttonClasses("secondary", "md", "max-sm:flex-1")}>
            <NotebookPen aria-hidden />
            Add note
          </button>
        )}
        {canWork && canSchedule && (
          <button type="button" onClick={() => toggle("schedule")} aria-expanded={panel === "schedule"} className={buttonClasses("secondary", "md", "max-sm:flex-1")}>
            <CalendarPlus aria-hidden />
            Schedule
          </button>
        )}
      </div>
      {canWork && !canSchedule && (
        <p className="text-sm text-ink-muted">Follow-ups can be scheduled once the lead has a branch and an owner.</p>
      )}
      {panel === "call" && <LogCallForm leadId={leadId} canSchedule={canSchedule} onDone={() => setPanel(null)} />}
      {panel === "note" && <NoteForm leadId={leadId} />}
      {panel === "schedule" && <FollowUpForm leadId={leadId} />}
    </div>
  );
}

function LogCallForm({ leadId, canSchedule, onDone }: { leadId: string; canSchedule: boolean; onDone: () => void }) {
  const { state, formAction, errors } = useForm(logCallAction);
  const [outcome, setOutcome] = useState<string>("");
  if (state.status === "success") {
    return (
      <div className="flex items-center justify-between gap-3 rounded-panel border border-success-700/25 bg-success-50 px-4 py-3 text-sm text-success-700">
        Call recorded.
        <button type="button" onClick={onDone} className="font-medium">
          Close
        </button>
      </div>
    );
  }
  return (
    <form action={formAction} className="space-y-4 rounded-panel border border-line bg-surface p-4">
      <input type="hidden" name="leadId" value={leadId} />
      <fieldset>
        <legend className="mb-2 text-sm font-medium">How did the call go?</legend>
        <div className="flex flex-wrap gap-2">
          {CALL_OUTCOMES.map((option) => (
            <label key={option} className="relative">
              <input
                type="radio"
                name="outcome"
                value={option}
                checked={outcome === option}
                onChange={() => setOutcome(option)}
                className="peer absolute inset-0 cursor-pointer opacity-0"
              />
              <span
                className={cn(
                  "inline-flex h-10 items-center rounded-full border px-4 text-sm font-medium transition-colors duration-150 lg:h-9",
                  "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-500",
                  outcome === option ? "border-brand-600 bg-brand-50 text-brand-700" : "border-line-strong text-ink-muted hover:border-ink-subtle",
                )}
              >
                {CALL_OUTCOME_LABEL[option]}
              </span>
            </label>
          ))}
        </div>
        <FieldError id="outcome" error={errors.outcome} />
      </fieldset>
      <Field id="call-notes" label="What was said?" optional>
        <Textarea id="call-notes" name="notes" rows={2} />
      </Field>
      {canSchedule && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="call-follow-date" label="Next follow-up" optional error={errors.followUpDate}>
            <Input {...describedBy("call-follow-date", errors.followUpDate)} type="date" name="followUpDate" />
          </Field>
          <Field id="call-follow-time" label="Time" optional error={errors.followUpTime}>
            <Input {...describedBy("call-follow-time", errors.followUpTime)} type="time" name="followUpTime" />
          </Field>
        </div>
      )}
      <Result state={state} />
      <SubmitButton pendingLabel="Saving…">Save call</SubmitButton>
    </form>
  );
}

function NoteForm({ leadId }: { leadId: string }) {
  const { state, formAction, errors } = useForm(addLeadNoteAction);
  return (
    <form action={formAction} className="space-y-3 rounded-panel border border-line bg-surface p-4">
      <input type="hidden" name="leadId" value={leadId} />
      <Field id="lead-note" label="Note" error={errors.body}>
        <Textarea {...describedBy("lead-note", errors.body)} name="body" rows={2} placeholder="e.g. Asked for a site visit next week" />
      </Field>
      <Result state={state} />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Adding…">
        Add note
      </SubmitButton>
    </form>
  );
}

function FollowUpForm({ leadId }: { leadId: string }) {
  const { state, formAction, errors } = useForm(scheduleFollowUpAction);
  return (
    <form action={formAction} className="space-y-4 rounded-panel border border-line bg-surface p-4">
      <input type="hidden" name="leadId" value={leadId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="fu-date" label="Follow up on" error={errors.dueDate}>
          <Input {...describedBy("fu-date", errors.dueDate)} type="date" name="dueDate" />
        </Field>
        <Field id="fu-time" label="Time" optional error={errors.dueTime}>
          <Input {...describedBy("fu-time", errors.dueTime)} type="time" name="dueTime" />
        </Field>
      </div>
      <Field id="fu-note" label="What to follow up about" optional>
        <Input id="fu-note" name="note" placeholder="e.g. Check if the quotation was approved" />
      </Field>
      <Result state={state} />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Scheduling…">
        Schedule follow-up
      </SubmitButton>
    </form>
  );
}

/** Move an open lead to another stage. */
export function StageControl({ leadId, stage }: { leadId: string; stage: LeadStage }) {
  const { state, formAction } = useForm(changeStageAction);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="leadId" value={leadId} />
      <ol className="flex flex-wrap gap-1.5" aria-label="Pipeline stage">
        {OPEN_LEAD_STAGES.map((option) => {
          const current = option === stage;
          return (
            <li key={option}>
              <button
                type="submit"
                name="stage"
                value={option}
                disabled={current}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "h-9 rounded-full border px-3 text-sm font-medium transition-colors duration-150 lg:h-8",
                  current ? "border-brand-600 bg-brand-50 text-brand-700" : "border-line text-ink-muted hover:border-line-strong hover:text-ink",
                )}
              >
                {STAGE_LABEL[option]}
              </button>
            </li>
          );
        })}
      </ol>
      <Result state={state} />
    </form>
  );
}

export function AssignLeadForm({
  leadId,
  marketers,
  ownerId,
}: {
  leadId: string;
  marketers: { id: string; name: string }[];
  ownerId: string | null;
}) {
  const { state, formAction } = useForm(assignLeadAction);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="leadId" value={leadId} />
      <div className="flex gap-2">
        <label htmlFor={`owner-${leadId}`} className="sr-only">
          Owner
        </label>
        <Select id={`owner-${leadId}`} name="ownerId" defaultValue={ownerId ?? ""} required className="lg:h-9">
          <option value="" disabled>
            Choose a marketer…
          </option>
          {marketers.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </Select>
        <SubmitButton variant="secondary" size="sm" pendingLabel="Assigning…" className="h-11 lg:h-9">
          {ownerId ? "Reassign" : "Assign"}
        </SubmitButton>
      </div>
      <Result state={state} />
    </form>
  );
}

export function SetBranchForm({
  leadId,
  branches,
  branchId,
}: {
  leadId: string;
  branches: { id: string; name: string }[];
  branchId: string | null;
}) {
  const { state, formAction } = useForm(setLeadBranchAction);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="leadId" value={leadId} />
      <div className="flex gap-2">
        <label htmlFor={`branch-${leadId}`} className="sr-only">
          Branch
        </label>
        <Select id={`branch-${leadId}`} name="branchId" defaultValue={branchId ?? ""} required className="lg:h-9">
          <option value="" disabled>
            Choose a branch…
          </option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </Select>
        <SubmitButton variant="secondary" size="sm" pendingLabel="Saving…" className="h-11 lg:h-9">
          {branchId ? "Move" : "Set branch"}
        </SubmitButton>
      </div>
      <Result state={state} />
    </form>
  );
}

/** Add a requirement: pick from PTCC's scope, or describe it (shown as "Scope not confirmed"). */
export function AddRequirement({ leadId, branchId, branchName }: { leadId: string; branchId: string | null; branchName: string | null }) {
  const { state, formAction } = useForm(addRequirementAction);
  const [pending, startTransition] = useTransition();
  const submit = (fields: Record<string, string>) => {
    const formData = new FormData();
    formData.set("leadId", leadId);
    for (const [key, val] of Object.entries(fields)) formData.set(key, val);
    startTransition(() => formAction(formData));
  };
  return (
    <div className="space-y-2">
      <ServiceSearch
        branchId={branchId}
        branchName={branchName}
        pickLabel={pending ? "Adding…" : "Add"}
        onPick={(entry) => submit({ scopeEntryId: entry.id })}
        onAddText={(text) => submit({ description: text })}
      />
      <Result state={state} />
    </div>
  );
}

export function RemoveRequirement({ requirementId }: { requirementId: string }) {
  const { formAction } = useForm(removeRequirementAction);
  return (
    <form action={formAction}>
      <input type="hidden" name="requirementId" value={requirementId} />
      <SubmitButton variant="ghost" size="sm" pendingLabel="…" className="h-8 px-2 text-ink-muted lg:h-7">
        Remove
      </SubmitButton>
    </form>
  );
}

export function QuotationStatusButtons({ quotationId, next }: { quotationId: string; next: { status: string; label: string; primary?: boolean }[] }) {
  const { state, formAction } = useForm(setQuotationStatusAction);
  if (next.length === 0) return null;
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="quotationId" value={quotationId} />
      <div className="flex flex-wrap gap-2">
        {next.map((option) => (
          <SubmitButton key={option.status} name="status" value={option.status} variant={option.primary ? "primary" : "secondary"} size="sm" pendingLabel="Saving…">
            {option.label}
          </SubmitButton>
        ))}
      </div>
      <Result state={state} />
    </form>
  );
}

/** Close the lead: won (becomes a customer of the branch) or lost (with a reason). */
export function CloseLead({ leadId, suggestedValue, branchName }: { leadId: string; suggestedValue: string | null; branchName: string | null }) {
  const won = useForm(markWonAction);
  const lost = useForm(markLostAction);
  return (
    <MoreDetails summary="Close this lead — won or lost">
      <div className="grid gap-6 lg:grid-cols-2">
        <form action={won.formAction} className="space-y-3 rounded-panel border border-line bg-surface p-4">
          <input type="hidden" name="leadId" value={leadId} />
          <p className="font-medium">Mark won</p>
          <p className="text-sm text-ink-muted">
            The company becomes a {branchName ? `${branchName} ` : ""}customer.
            {suggestedValue ? ` Value from the latest quotation: ${suggestedValue}.` : ""}
          </p>
          <Field id="wonValue" label="Deal value (₹)" optional error={won.errors.wonValue} hint={suggestedValue ? "Leave blank to use the quotation." : undefined}>
            <Input {...describedBy("wonValue", won.errors.wonValue, Boolean(suggestedValue))} name="wonValue" inputMode="decimal" placeholder="e.g. 25,000" />
          </Field>
          <Result state={won.state} />
          <SubmitButton variant="primary" size="sm" pendingLabel="Saving…">
            Mark won
          </SubmitButton>
        </form>
        <form action={lost.formAction} className="space-y-3 rounded-panel border border-line bg-surface p-4">
          <input type="hidden" name="leadId" value={leadId} />
          <p className="font-medium">Mark lost</p>
          <p className="text-sm text-ink-muted">Open follow-ups for this lead are cancelled.</p>
          <Field id="lostReason" label="Why was it lost?" error={lost.errors.reason}>
            <Input {...describedBy("lostReason", lost.errors.reason)} name="reason" placeholder="e.g. Chose another lab" />
          </Field>
          <Result state={lost.state} />
          <SubmitButton variant="danger" size="sm" pendingLabel="Saving…">
            Mark lost
          </SubmitButton>
        </form>
      </div>
    </MoreDetails>
  );
}

export function ReopenLead({ leadId }: { leadId: string }) {
  const { state, formAction } = useForm(reopenLeadAction);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="leadId" value={leadId} />
      <SubmitButton variant="secondary" size="sm" pendingLabel="Reopening…">
        Reopen lead
      </SubmitButton>
      <Result state={state} />
    </form>
  );
}
