"use client";

import { CalendarCheck, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useMemo, useState } from "react";
import { buttonClasses } from "@/components/ui/button";
import { describedBy, Field, Input, Select, Textarea } from "@/components/ui/field";
import { MoreDetails, Notice } from "@/components/ui/display";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/format";
import { formatAbsoluteDue } from "@/lib/time";
import type { ActionState } from "@/server/action-result";
import { confirmCaptureAction, discardCaptureAction } from "../../actions";
import { DRAFT_FIELD_LABEL, draftToLeadForm, type ReviewField } from "../../capture";
import type { CaptureView, DuplicateCompany, DuplicateLead } from "../../capture-service";
import { LANGUAGE_LABEL, LEAD_SOURCES, leadRef, SOURCE_LABEL, STAGE_LABEL } from "../../model";
import { CompanyPicker, type CompanyChoice } from "../company-picker";

const IDLE: ActionState = { status: "idle" };

type Origin = "capture" | "check" | "missing" | "edited";

const ORIGIN_STYLE: Record<Origin, string> = {
  capture: "bg-brand-50 text-brand-700",
  check: "bg-warning-50 text-warning-700",
  missing: "bg-subtle text-ink-subtle",
  edited: "bg-success-50 text-success-700",
};

function OriginTag({ origin, simulated }: { origin: Origin; simulated: boolean }) {
  const label =
    origin === "capture" ? (simulated ? "From capture · simulated" : "From capture") : origin === "check" ? "Check this" : origin === "missing" ? "Not in capture" : "Edited by you";
  return <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", ORIGIN_STYLE[origin])}>{label}</span>;
}

const METHOD_SOURCE = { photo: "a photo", voice: "your voice", text: "your text" } as const;

export function CaptureReview({
  capture,
  branches,
  allBranches,
  defaultBranchId,
  marketersByBranch,
  actorId,
}: {
  capture: CaptureView;
  branches: { id: string; name: string }[];
  allBranches: { id: string; name: string }[];
  defaultBranchId: string;
  marketersByBranch: Record<string, { id: string; name: string }[]> | null;
  actorId: string;
}) {
  const initial = useMemo(() => draftToLeadForm(capture.draft, allBranches, defaultBranchId), [capture.draft, allBranches, defaultBranchId]);
  const hintSelectable = initial.branchHint !== null && branches.some((branch) => branch.id === initial.branchHint!.id);
  const [state, formAction] = useActionState(confirmCaptureAction, IDLE);
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const [values, setValues] = useState(initial.values);
  const [company, setCompany] = useState<CompanyChoice>({ id: null, name: initial.values.companyName });
  const [companyKnown, setCompanyKnown] = useState(true);
  const [companyKey, setCompanyKey] = useState(0);
  const [branchId, setBranchId] = useState(initial.branchId);
  const [followUpDate, setFollowUpDate] = useState("");
  const [followUpTime, setFollowUpTime] = useState("");
  const marketers = marketersByBranch && branchId ? (marketersByBranch[branchId] ?? null) : null;

  const set = (key: ReviewField) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));
  const originOf = (key: ReviewField): Origin => {
    const now = key === "companyName" ? company.name : values[key];
    if (now.trim() !== initial.values[key].trim()) return "edited";
    if (!initial.values[key]) return "missing";
    return capture.draft.uncertain.includes(key) ? "check" : "capture";
  };
  const label = (key: ReviewField, text: string = DRAFT_FIELD_LABEL[key]) => (
    <span className="flex flex-wrap items-center gap-2">
      {text}
      <OriginTag origin={originOf(key)} simulated={capture.simulated} />
    </span>
  );
  const input = (key: ReviewField, props: React.ComponentProps<"input"> = {}) => (
    <Field id={key} label={label(key)} error={errors[key]}>
      <Input {...describedBy(key, errors[key])} name={key} value={values[key]} onChange={set(key)} {...props} />
    </Field>
  );

  const useCompany = (match: DuplicateCompany) => {
    setCompany({ id: match.id, name: match.name });
    setCompanyKnown(match.known);
    setCompanyKey((key) => key + 1);
  };
  const hasMore = Boolean(initial.values.addressLine || initial.values.area || initial.values.city || initial.values.industry);
  const suggestion = initial.suggestedFollowUp;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Check the details</h2>
        <p className="text-sm text-ink-muted">
          From {METHOD_SOURCE[capture.method]}
          {capture.language !== "unknown" ? ` · ${LANGUAGE_LABEL[capture.language]}` : ""}
          {capture.simulated && capture.sampleLabel ? ` · simulated: ${capture.sampleLabel}` : ""}. Nothing is saved until you confirm.
        </p>
      </div>
      {capture.simulated && (
        <Notice tone="warning" title="Simulated result">
          {capture.method === "text"
            ? "Development mode. Prepared samples give full results; for other text only phone numbers, emails, websites and dates are picked out."
            : `Development mode. These details come from a built-in sample, not from ${capture.method === "photo" ? "your photo" : "your recording"}.`}
        </Notice>
      )}
      {capture.problems.length > 0 && (
        <Notice tone="warning" title="Please check">
          <ul className="list-disc space-y-0.5 pl-4">
            {capture.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        </Notice>
      )}
      {state.status === "error" && <Notice tone="danger">{state.message}</Notice>}

      <form action={formAction} className="space-y-6" noValidate>
        <input type="hidden" name="captureId" value={capture.id} />

        {capture.method === "voice" ? (
          <Field id="editedTranscript" label="Transcript" hint="Correct anything misheard. The original is kept too." error={errors.editedTranscript}>
            <Textarea id="editedTranscript" name="editedTranscript" rows={4} defaultValue={capture.originalText} lang={capture.language === "unknown" ? undefined : capture.language} aria-describedby="editedTranscript-hint" />
          </Field>
        ) : (
          <details className="rounded-panel border border-line bg-surface px-4 py-3 text-sm">
            <summary className="cursor-pointer font-medium">{capture.method === "photo" ? "Text read from the photo" : "Your text"}</summary>
            <p className="mt-2 whitespace-pre-line text-ink-muted" lang={capture.language === "unknown" ? undefined : capture.language}>
              {capture.originalText}
            </p>
          </details>
        )}

        <div className="space-y-1.5">
          <div className="flex justify-end">
            <OriginTag origin={originOf("companyName")} simulated={capture.simulated} />
          </div>
          <CompanyPicker
            key={companyKey}
            defaultId={company.id ?? undefined}
            defaultName={company.name}
            defaultKnown={companyKnown}
            // A "name already exists" error no longer applies once an existing company is chosen.
            error={company.id ? errors.companyId : (errors.companyName ?? errors.companyId)}
            onChange={setCompany}
          />
        </div>

        <DuplicateMatches companyName={company.id ? "" : company.name} phone={values.contactPhone} email={values.contactEmail} chosenId={company.id} onUse={useCompany} />

        <div className="grid gap-5 sm:grid-cols-2">
          {input("contactName")}
          {input("contactDesignation")}
          {input("contactPhone", { type: "tel", inputMode: "tel" })}
          {input("contactEmail", { type: "email" })}
        </div>

        <Field
          id="requirement"
          label={label("requirement", "What do they need?")}
          error={errors.requirement}
          hint={!initial.values.requirement ? "Not in the capture — add what they need, in your words." : undefined}
        >
          <Input {...describedBy("requirement", errors.requirement, !initial.values.requirement)} name="requirement" maxLength={500} value={values.requirement} onChange={set("requirement")} />
        </Field>

        <MoreDetails summary="Address, website and more" defaultOpen={hasMore || Boolean(errors.companyWebsite)}>
          {input("addressLine")}
          <div className="grid gap-5 sm:grid-cols-3">
            {input("area")}
            {input("city")}
            {input("industry")}
          </div>
          {input("companyWebsite", { inputMode: "url" })}
          <Field id="source" label="How we found them">
            <Select id="source" name="source" defaultValue="employee">
              {LEAD_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {SOURCE_LABEL[source]}
                </option>
              ))}
            </Select>
          </Field>
        </MoreDetails>

        <Field id="notes" label={label("notes")} error={errors.notes}>
          <Textarea id="notes" name="notes" rows={2} value={values.notes} onChange={set("notes")} />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="branchId" label="Branch" error={errors.branchId} hint={!branchId ? "Admin or the CEO's office will route it to the right branch." : undefined}>
            <Select {...describedBy("branchId", errors.branchId, !branchId)} name="branchId" value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
              <option value="">Not sure which branch</option>
            </Select>
          </Field>
          {marketers && (
            <Field id="ownerId" label="Owner" error={errors.ownerId}>
              <Select key={branchId} {...describedBy("ownerId", errors.ownerId)} name="ownerId" defaultValue="">
                <option value="">Leave for the branch to assign</option>
                {marketers.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.id === actorId ? `Me (${person.name})` : person.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        {initial.branchHint && branchId !== initial.branchHint.id && (hintSelectable || branchId !== "") && (
          <p className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
            The capture mentions the {initial.branchHint.name} branch.
            {hintSelectable ? (
              <button type="button" onClick={() => setBranchId(initial.branchHint!.id)} className="font-medium text-brand-600 hover:text-brand-700">
                Use {initial.branchHint.name}
              </button>
            ) : (
              <span>If the lead belongs there, choose &ldquo;Not sure which branch&rdquo; and it will be routed.</span>
            )}
          </p>
        )}

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Next follow-up</legend>
          {suggestion && followUpDate !== suggestion.date && (
            <div className="flex flex-wrap items-center gap-3 rounded-panel border border-warning-700/25 bg-warning-50 px-3 py-2 text-sm">
              <TriangleAlert className="size-4 text-warning-700" aria-hidden />
              <span>
                Suggested{suggestion.phrase ? ` from “${suggestion.phrase}”` : ""}: <strong>{formatAbsoluteDue(suggestion.date, suggestion.time)}</strong>. Confirm the day
                before using it.
              </span>
              <button
                type="button"
                onClick={() => {
                  setFollowUpDate(suggestion.date);
                  setFollowUpTime(suggestion.time ?? "");
                }}
                className={buttonClasses("secondary", "sm")}
              >
                <CalendarCheck aria-hidden />
                Use this date
              </button>
            </div>
          )}
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id="followUpDate" label="Date" optional error={errors.followUpDate} hint="Scheduled only when the lead has an owner.">
              <Input {...describedBy("followUpDate", errors.followUpDate, true)} name="followUpDate" type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} />
            </Field>
            <Field id="followUpTime" label="Time" optional error={errors.followUpTime}>
              <Input {...describedBy("followUpTime", errors.followUpTime)} name="followUpTime" type="time" value={followUpTime} onChange={(event) => setFollowUpTime(event.target.value)} />
            </Field>
          </div>
        </fieldset>

        <div className="flex flex-wrap gap-3 border-t border-line pt-6">
          <SubmitButton size="lg" pendingLabel="Creating lead…" className="max-sm:w-full">
            Confirm and create lead
          </SubmitButton>
        </div>
      </form>

      <form action={discardCaptureAction}>
        <input type="hidden" name="captureId" value={capture.id} />
        <SubmitButton variant="ghost" size="lg" pendingLabel="Cancelling…" className="max-sm:w-full">
          Cancel — don&apos;t create a lead
        </SubmitButton>
      </form>
    </div>
  );
}

// ─── Possible duplicates ──────────────────────────────────────────────────────

function DuplicateMatches({
  companyName,
  phone,
  email,
  chosenId,
  onUse,
}: {
  companyName: string;
  phone: string;
  email: string;
  chosenId: string | null;
  onUse: (company: DuplicateCompany) => void;
}) {
  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (companyName.trim().length >= 2) params.set("companyName", companyName.trim());
    if (phone.replace(/\D/g, "").length >= 10) params.set("phone", phone);
    if (email.includes("@")) params.set("email", email.trim());
    return params.toString();
  }, [companyName, phone, email]);
  const [result, setResult] = useState<{ query: string; companies: DuplicateCompany[]; leads: DuplicateLead[] }>({
    query: "",
    companies: [],
    leads: [],
  });

  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/capture/duplicates?${query}`, { signal: controller.signal });
        if (response.ok) setResult({ query, ...((await response.json()) as { companies: DuplicateCompany[]; leads: DuplicateLead[] }) });
      } catch {
        // Duplicate hints are a convenience; the server still refuses an exact duplicate company.
      }
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const shown = query && result.query === query ? result : { companies: [], leads: [] };
  const companies = shown.companies;
  if (companies.length === 0 && shown.leads.length === 0) return null;
  const on = (match: DuplicateCompany) => match.matchedOn.map((field) => ({ name: "name", phone: "phone", email: "email" })[field]).join(", ");

  return (
    <section aria-labelledby="duplicates-heading" className="space-y-2 rounded-panel border border-warning-700/25 bg-warning-50/60 p-3 text-sm">
      <h3 id="duplicates-heading" className="font-medium text-warning-700">
        Possible matches — is this one of these?
      </h3>
      <ul className="space-y-2">
        {companies.map((match) => (
          <li key={match.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0">
              <span className="font-medium">{match.name}</span>
              <span className="text-ink-muted">
                {[match.area, match.city].filter(Boolean).length ? ` · ${[match.area, match.city].filter(Boolean).join(", ")}` : ""} · same {on(match)}
                {match.contactName ? ` · contact ${match.contactName}` : ""}
                {match.known ? "" : " · another branch's customer"}
              </span>
            </span>
            {match.id === chosenId ? (
              <span className="text-xs font-medium text-success-700">Using this company</span>
            ) : (
              <button type="button" onClick={() => onUse(match)} className={buttonClasses("secondary", "sm")}>
                Use this company
              </button>
            )}
          </li>
        ))}
        {shown.leads.map((lead) => (
          <li key={lead.id} className="text-ink-muted">
            Open lead{" "}
            <Link href={`/leads/${lead.id}`} target="_blank" className="font-medium text-brand-600 hover:text-brand-700">
              {leadRef(lead.number)} {lead.companyName}
            </Link>
            {" · "}
            {STAGE_LABEL[lead.stage]}
            {lead.ownerName ? ` · ${lead.ownerName}` : " · no owner yet"}
            {lead.branchName ? ` · ${lead.branchName}` : ""}
          </li>
        ))}
      </ul>
      <p className="text-xs text-ink-muted">Nothing is merged automatically. Choose the existing company, or carry on if it&apos;s a different one.</p>
    </section>
  );
}
