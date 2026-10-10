"use client";

import Link from "next/link";
import { useActionState } from "react";
import { buttonClasses } from "@/components/ui/button";
import { describedBy, Field, Input, Textarea } from "@/components/ui/field";
import { MoreDetails, Notice } from "@/components/ui/display";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionState } from "@/server/action-result";
import { createBranchAction, setBranchStatusAction, updateBranchAction } from "../actions";

const IDLE: ActionState = { status: "idle" };

type BranchValues = {
  id: string;
  name: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
  email: string;
  mapsUrl: string;
  description: string;
  notes: string;
  verified: boolean;
};

/** Add or edit a branch. Only the name is required; the rest can be filled in once PTCC confirms it. */
export function BranchForm({ branch }: { branch?: BranchValues }) {
  const editing = Boolean(branch);
  const [state, formAction] = useActionState(editing ? updateBranchAction : createBranchAction, IDLE);
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const submitted = state.status === "error" ? state.values : undefined;
  const value = (key: Exclude<keyof BranchValues, "id" | "verified">) =>
    typeof submitted?.[key] === "string" ? (submitted[key] as string) : (branch?.[key] ?? "");
  const verified = submitted ? submitted.verified === "on" : (branch?.verified ?? false);
  const hasDetails = Boolean(
    value("addressLine") || value("pincode") || value("phone") || value("email") || value("mapsUrl") || value("description") || value("notes"),
  );

  return (
    <form action={formAction} className="max-w-2xl space-y-6" noValidate>
      {branch && <input type="hidden" name="id" value={branch.id} />}
      {state.status === "error" && <Notice tone="danger">{state.message}</Notice>}
      {state.status === "success" && state.message && <Notice tone="success">{state.message}</Notice>}

      <Field id="name" label="Branch name" hint="How people refer to it, usually the city." error={errors.name}>
        <Input {...describedBy("name", errors.name, true)} name="name" autoComplete="off" defaultValue={value("name")} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="city" label="City" optional error={errors.city}>
          <Input {...describedBy("city", errors.city)} name="city" defaultValue={value("city")} />
        </Field>
        <Field id="state" label="State" optional error={errors.state}>
          <Input {...describedBy("state", errors.state)} name="state" defaultValue={value("state")} />
        </Field>
      </div>

      <MoreDetails summary="Address and contact" defaultOpen={hasDetails || Boolean(errors.phone || errors.email || errors.mapsUrl)}>
        <Field id="addressLine" label="Address" optional error={errors.addressLine}>
          <Textarea {...describedBy("addressLine", errors.addressLine)} name="addressLine" rows={2} defaultValue={value("addressLine")} />
        </Field>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field id="pincode" label="PIN code" optional error={errors.pincode}>
            <Input {...describedBy("pincode", errors.pincode)} name="pincode" inputMode="numeric" defaultValue={value("pincode")} />
          </Field>
          <Field id="phone" label="Phone" optional error={errors.phone}>
            <Input {...describedBy("phone", errors.phone)} name="phone" type="tel" inputMode="tel" defaultValue={value("phone")} />
          </Field>
          <Field id="email" label="Email" optional error={errors.email}>
            <Input {...describedBy("email", errors.email)} name="email" type="email" defaultValue={value("email")} />
          </Field>
        </div>
        <Field id="mapsUrl" label="Google Maps link" optional error={errors.mapsUrl}>
          <Input {...describedBy("mapsUrl", errors.mapsUrl)} name="mapsUrl" type="url" inputMode="url" defaultValue={value("mapsUrl")} />
        </Field>
        <Field id="description" label="About the branch" optional error={errors.description}>
          <Textarea {...describedBy("description", errors.description)} name="description" rows={2} defaultValue={value("description")} />
        </Field>
        <Field id="notes" label="Notes" optional error={errors.notes}>
          <Textarea {...describedBy("notes", errors.notes)} name="notes" rows={3} defaultValue={value("notes")} />
        </Field>
      </MoreDetails>

      <label className="flex cursor-pointer gap-3 rounded-panel border border-line bg-surface px-3 py-3 has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50/60 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-500">
        <input
          type="checkbox"
          name="verified"
          defaultChecked={verified}
          className="mt-1 size-4 shrink-0 accent-brand-600 focus-visible:outline-none"
        />
        <span>
          <span className="block text-sm font-medium">PTCC has confirmed these details</span>
          <span className="block text-xs text-ink-muted">
            Leave unticked while anything here is provisional — the branch is then shown as &ldquo;Needs verification&rdquo;.
            This does not add accreditation: what a branch is accredited for comes only from its NABL scope.
          </span>
        </span>
      </label>

      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <SubmitButton size="lg" pendingLabel="Saving…" className="max-sm:w-full">
          {editing ? "Save changes" : "Add branch"}
        </SubmitButton>
        <Link href="/admin/branches" className={buttonClasses("ghost", "lg", "max-sm:w-full")}>
          {editing ? "Back to branches" : "Cancel"}
        </Link>
      </div>
    </form>
  );
}

/** Deactivate / reactivate. A branch with active people can't be deactivated (the server enforces it). */
export function BranchStatusForm({ id, name, status }: { id: string; name: string; status: "active" | "inactive" }) {
  const [state, formAction] = useActionState(setBranchStatusAction, IDLE);
  const deactivating = status === "active";
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={deactivating ? "inactive" : "active"} />
      <p className="text-sm text-ink-muted">
        {deactivating
          ? `${name} will no longer be offered for new people, leads or work. Its records and history are kept.`
          : `${name} will be offered again for new people, leads and work.`}
      </p>
      {state.status === "error" && <Notice tone="danger">{state.message}</Notice>}
      {state.status === "success" && state.message && <Notice tone="success">{state.message}</Notice>}
      <SubmitButton variant={deactivating ? "danger" : "secondary"} pendingLabel="Saving…">
        {deactivating ? `Deactivate ${name}` : `Reactivate ${name}`}
      </SubmitButton>
    </form>
  );
}
