"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { buttonClasses } from "@/components/ui/button";
import { describedBy, Field, Input, Select, Textarea } from "@/components/ui/field";
import { MoreDetails, Notice } from "@/components/ui/display";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionState } from "@/server/action-result";
import { createLeadAction } from "../actions";
import { LEAD_SOURCES, SOURCE_LABEL } from "../model";
import { CompanyPicker } from "./company-picker";
import { ServiceSelector } from "./service-picker";

const IDLE: ActionState = { status: "idle" };

export type LeadFormBranch = { id: string; name: string };
export type LeadFormMarketer = { id: string; name: string };

/**
 * Add a lead: company, contact, phone and what they need first; everything else is optional.
 * The branch defaults to mine; "Not sure" sends it to the CEO's "needs a branch" list rather
 * than guessing. People who route leads may also choose the owner.
 */
export function NewLeadForm({
  branches,
  defaultBranchId,
  marketersByBranch,
  actorId,
  defaultSource,
}: {
  branches: LeadFormBranch[];
  defaultBranchId: string;
  /** Only present for people who may assign leads (per branch they can assign in). */
  marketersByBranch: Record<string, LeadFormMarketer[]> | null;
  actorId: string;
  defaultSource: (typeof LEAD_SOURCES)[number];
}) {
  const [state, formAction] = useActionState(createLeadAction, IDLE);
  const values = state.status === "error" ? (state.values ?? {}) : {};
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const value = (key: string, fallback = "") => (typeof values[key] === "string" ? (values[key] as string) : fallback);

  const [branchId, setBranchId] = useState(value("branchId", defaultBranchId));
  const [companyIsNew, setCompanyIsNew] = useState(!value("companyId"));
  const branchName = branches.find((b) => b.id === branchId)?.name ?? null;
  const marketers = marketersByBranch && branchId ? (marketersByBranch[branchId] ?? null) : null;

  return (
    <form action={formAction} className="max-w-2xl space-y-6" noValidate>
      {state.status === "error" && <Notice tone="danger">{state.message}</Notice>}

      <CompanyPicker
        defaultId={value("companyId") || undefined}
        defaultName={value("companyName")}
        error={errors.companyName ?? errors.companyId}
        onChange={(choice) => setCompanyIsNew(choice.id === null)}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="contactName" label="Contact person" optional error={errors.contactName}>
          <Input {...describedBy("contactName", errors.contactName)} name="contactName" defaultValue={value("contactName")} />
        </Field>
        <Field id="contactPhone" label="Phone" optional error={errors.contactPhone}>
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

      <Field id="requirement" label="What do they need?" error={errors.requirement}>
        <Input
          {...describedBy("requirement", errors.requirement)}
          name="requirement"
          maxLength={500}
          placeholder="e.g. Pressure gauge calibration, 12 nos"
          defaultValue={value("requirement")}
        />
      </Field>

      <div className="space-y-1.5">
        <p className="text-sm font-medium">
          Services from PTCC&apos;s scope <span className="font-normal text-ink-subtle">(optional)</span>
        </p>
        <p className="text-sm text-ink-muted">Pick what they need so the branch can confirm it is within accreditation.</p>
        <ServiceSelector branchId={branchId || null} branchName={branchName} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="branchId" label="Branch" error={errors.branchId} hint={!branchId ? "The CEO's office will decide which branch takes it." : undefined}>
          <Select
            {...describedBy("branchId", errors.branchId, !branchId)}
            name="branchId"
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
          >
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
            <option value="">Not sure — needs assignment</option>
          </Select>
        </Field>
        {marketers && (
          <Field id="ownerId" label="Owner" error={errors.ownerId}>
            <Select key={branchId} {...describedBy("ownerId", errors.ownerId)} name="ownerId" defaultValue={value("ownerId")}>
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

      <MoreDetails defaultOpen={Boolean(value("notes") || value("addressLine") || value("followUpDate") || errors.contactEmail)}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="contactEmail" label="Contact email" optional error={errors.contactEmail}>
            <Input {...describedBy("contactEmail", errors.contactEmail)} name="contactEmail" type="email" defaultValue={value("contactEmail")} />
          </Field>
          <Field id="source" label="How we found them">
            <Select id="source" name="source" defaultValue={value("source", defaultSource)}>
              {LEAD_SOURCES.map((source) => (
                <option key={source} value={source}>
                  {SOURCE_LABEL[source]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {companyIsNew && (
          <>
            <div className="grid gap-5 sm:grid-cols-[2fr_1fr]">
              <Field id="addressLine" label="Address" optional>
                <Input id="addressLine" name="addressLine" defaultValue={value("addressLine")} />
              </Field>
              <Field id="area" label="Area" optional>
                <Input id="area" name="area" placeholder="e.g. Peenya" defaultValue={value("area")} />
              </Field>
            </div>
            <div className="grid gap-5 sm:grid-cols-3">
              <Field id="city" label="City" optional>
                <Input id="city" name="city" defaultValue={value("city")} />
              </Field>
              <Field id="industry" label="Industry" optional>
                <Input id="industry" name="industry" defaultValue={value("industry")} />
              </Field>
              <Field id="companyPhone" label="Company phone" optional error={errors.companyPhone}>
                <Input {...describedBy("companyPhone", errors.companyPhone)} name="companyPhone" type="tel" defaultValue={value("companyPhone")} />
              </Field>
            </div>
          </>
        )}
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="followUpDate" label="Next follow-up" optional error={errors.followUpDate} hint="Only when the lead has an owner.">
            <Input {...describedBy("followUpDate", errors.followUpDate, true)} name="followUpDate" type="date" defaultValue={value("followUpDate")} />
          </Field>
          <Field id="followUpTime" label="Time" optional error={errors.followUpTime}>
            <Input {...describedBy("followUpTime", errors.followUpTime)} name="followUpTime" type="time" defaultValue={value("followUpTime")} />
          </Field>
        </div>
        <Field id="notes" label="Notes" optional>
          <Textarea id="notes" name="notes" rows={3} defaultValue={value("notes")} />
        </Field>
      </MoreDetails>

      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <SubmitButton size="lg" pendingLabel="Adding…" className="max-sm:w-full">
          Add lead
        </SubmitButton>
        <Link href="/leads" className={buttonClasses("ghost", "lg", "max-sm:w-full")}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
