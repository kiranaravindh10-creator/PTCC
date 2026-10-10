"use client";

import { CalendarPlus } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { buttonClasses } from "@/components/ui/button";
import { describedBy, Field, Input, Select, Textarea } from "@/components/ui/field";
import { MoreDetails, Notice } from "@/components/ui/display";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionState } from "@/server/action-result";
import { addCompanyFollowUpAction, addContactAction, createCustomerAction, setRelationshipAction, updateCustomerAction } from "../actions";

const IDLE: ActionState = { status: "idle" };

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

/** New customer — name, contact and phone first; address and the rest on request. */
export function NewCustomerForm({ branches, defaultBranchId }: { branches: { id: string; name: string }[] | null; defaultBranchId: string }) {
  const [state, formAction] = useActionState(createCustomerAction, IDLE);
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const values = state.status === "error" ? (state.values ?? {}) : {};
  const value = (key: string, fallback = "") => (typeof values[key] === "string" ? (values[key] as string) : fallback);
  return (
    <form action={formAction} className="max-w-2xl space-y-6" noValidate>
      {state.status === "error" && <Notice tone="danger">{state.message}</Notice>}
      <Field id="name" label="Company name" error={errors.name} hint="If the company already exists at another branch, add a lead for it instead — it will be reused, not duplicated.">
        <Input {...describedBy("name", errors.name, true)} name="name" defaultValue={value("name")} />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="contactName" label="Contact person" optional>
          <Input id="contactName" name="contactName" defaultValue={value("contactName")} />
        </Field>
        <Field id="contactPhone" label="Phone" optional error={errors.contactPhone}>
          <Input {...describedBy("contactPhone", errors.contactPhone)} name="contactPhone" type="tel" inputMode="tel" placeholder="98765 43210" defaultValue={value("contactPhone")} />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="relationship" label="Relationship">
          <Select id="relationship" name="relationship" defaultValue={value("relationship", "prospect")}>
            <option value="prospect">Prospect — not yet a customer</option>
            <option value="customer">Customer — already works with PTCC</option>
          </Select>
        </Field>
        {branches && (
          <Field id="branchId" label="Branch" error={errors.branchId}>
            <Select {...describedBy("branchId", errors.branchId)} name="branchId" defaultValue={value("branchId", defaultBranchId)}>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>
      <MoreDetails defaultOpen={Boolean(value("addressLine") || errors.email || errors.phone)}>
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
          <Field id="state" label="State" optional>
            <Input id="state" name="state" defaultValue={value("state")} />
          </Field>
          <Field id="pincode" label="PIN code" optional>
            <Input id="pincode" name="pincode" inputMode="numeric" defaultValue={value("pincode")} />
          </Field>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          <Field id="industry" label="Industry" optional>
            <Input id="industry" name="industry" defaultValue={value("industry")} />
          </Field>
          <Field id="phone" label="Company phone" optional error={errors.phone}>
            <Input {...describedBy("phone", errors.phone)} name="phone" type="tel" defaultValue={value("phone")} />
          </Field>
          <Field id="email" label="Company email" optional error={errors.email}>
            <Input {...describedBy("email", errors.email)} name="email" type="email" defaultValue={value("email")} />
          </Field>
        </div>
      </MoreDetails>
      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <SubmitButton size="lg" pendingLabel="Adding…" className="max-sm:w-full">
          Add customer
        </SubmitButton>
        <Link href="/customers" className={buttonClasses("ghost", "lg", "max-sm:w-full")}>
          Cancel
        </Link>
      </div>
    </form>
  );
}

export function AddFollowUpButton({ companyId }: { companyId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(addCompanyFollowUpAction, IDLE);
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return (
    <>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className={buttonClasses("secondary", "md", "max-sm:flex-1")}>
        <CalendarPlus aria-hidden />
        Add follow-up
      </button>
      {open && (
        <form action={formAction} className="mt-3 w-full space-y-4 rounded-panel border border-line bg-surface p-4">
          <input type="hidden" name="companyId" value={companyId} />
          <Field id="cfu-title" label="What to follow up about" error={errors.title}>
            <Input {...describedBy("cfu-title", errors.title)} name="title" placeholder="e.g. Ask about next calibration cycle" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="cfu-date" label="Date" error={errors.dueDate}>
              <Input {...describedBy("cfu-date", errors.dueDate)} type="date" name="dueDate" />
            </Field>
            <Field id="cfu-time" label="Time" optional>
              <Input id="cfu-time" type="time" name="dueTime" />
            </Field>
          </div>
          <Result state={state} />
          <SubmitButton variant="secondary" size="sm" pendingLabel="Adding…">
            Add to my work
          </SubmitButton>
        </form>
      )}
    </>
  );
}

export function AddContactForm({ companyId }: { companyId: string }) {
  const [state, formAction] = useActionState(addContactAction, IDLE);
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return (
    <MoreDetails summary="Add a contact">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="companyId" value={companyId} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="contact-name" label="Name" error={errors.name}>
            <Input {...describedBy("contact-name", errors.name)} name="name" />
          </Field>
          <Field id="contact-phone" label="Phone" optional error={errors.phone}>
            <Input {...describedBy("contact-phone", errors.phone)} name="phone" type="tel" inputMode="tel" />
          </Field>
          <Field id="contact-email" label="Email" optional error={errors.email}>
            <Input {...describedBy("contact-email", errors.email)} name="email" type="email" />
          </Field>
          <Field id="contact-designation" label="Designation" optional>
            <Input id="contact-designation" name="designation" />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="makePrimary" className="size-4 accent-brand-600" />
          Main contact
        </label>
        <Result state={state} />
        <SubmitButton variant="secondary" size="sm" pendingLabel="Adding…">
          Add contact
        </SubmitButton>
      </form>
    </MoreDetails>
  );
}

/** "Add to my branch" / "Mark as customer" for the actor's branch (or a chosen one, company-wide). */
export function RelationshipButtons({
  companyId,
  branchId,
  current,
}: {
  companyId: string;
  branchId?: string;
  current: "prospect" | "customer" | "inactive" | null;
}) {
  const [state, formAction] = useActionState(setRelationshipAction, IDLE);
  const options =
    current === null
      ? [
          { relationship: "prospect", label: "Add to my branch as a prospect" },
          { relationship: "customer", label: "Add as a customer" },
        ]
      : current === "prospect"
        ? [{ relationship: "customer", label: "Mark as customer" }]
        : current === "inactive"
          ? [{ relationship: "prospect", label: "Mark active again" }]
          : [{ relationship: "inactive", label: "Mark inactive" }];
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="companyId" value={companyId} />
      {branchId && <input type="hidden" name="branchId" value={branchId} />}
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <SubmitButton key={option.relationship} name="relationship" value={option.relationship} variant={option.relationship === "inactive" ? "ghost" : "secondary"} size="sm" pendingLabel="Saving…">
            {option.label}
          </SubmitButton>
        ))}
      </div>
      <Result state={state} />
    </form>
  );
}

export function EditCustomerForm({
  customer,
}: {
  customer: {
    id: string;
    name: string;
    industry: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    addressLine: string | null;
    area: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
    notes: string | null;
  };
}) {
  const [state, formAction] = useActionState(updateCustomerAction, IDLE);
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return (
    <MoreDetails summary="Edit company details">
      <form action={formAction} className="space-y-4">
        <input type="hidden" name="companyId" value={customer.id} />
        <Field id="edit-name" label="Company name" error={errors.name}>
          <Input {...describedBy("edit-name", errors.name)} name="name" defaultValue={customer.name} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <Field id="edit-address" label="Address" optional>
            <Input id="edit-address" name="addressLine" defaultValue={customer.addressLine ?? ""} />
          </Field>
          <Field id="edit-area" label="Area" optional>
            <Input id="edit-area" name="area" defaultValue={customer.area ?? ""} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="edit-city" label="City" optional>
            <Input id="edit-city" name="city" defaultValue={customer.city ?? ""} />
          </Field>
          <Field id="edit-state" label="State" optional>
            <Input id="edit-state" name="state" defaultValue={customer.state ?? ""} />
          </Field>
          <Field id="edit-pincode" label="PIN code" optional>
            <Input id="edit-pincode" name="pincode" defaultValue={customer.pincode ?? ""} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="edit-industry" label="Industry" optional>
            <Input id="edit-industry" name="industry" defaultValue={customer.industry ?? ""} />
          </Field>
          <Field id="edit-phone" label="Company phone" optional error={errors.phone}>
            <Input {...describedBy("edit-phone", errors.phone)} name="phone" defaultValue={customer.phone ?? ""} />
          </Field>
          <Field id="edit-email" label="Company email" optional error={errors.email}>
            <Input {...describedBy("edit-email", errors.email)} name="email" defaultValue={customer.email ?? ""} />
          </Field>
        </div>
        <Field id="edit-website" label="Website" optional>
          <Input id="edit-website" name="website" defaultValue={customer.website ?? ""} />
        </Field>
        <Field id="edit-notes" label="Notes" optional>
          <Textarea id="edit-notes" name="notes" rows={3} defaultValue={customer.notes ?? ""} />
        </Field>
        <Result state={state} />
        <SubmitButton variant="secondary" size="sm" pendingLabel="Saving…">
          Save details
        </SubmitButton>
      </form>
    </MoreDetails>
  );
}
