"use client";

import { Copy } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { buttonClasses } from "@/components/ui/button";
import { describedBy, Field, FieldError, Input, Select } from "@/components/ui/field";
import { MoreDetails, Notice } from "@/components/ui/display";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/format";
import type { ActionState } from "@/server/action-result";
import { createPersonAction, resetPasswordAction, setPersonStatusAction, updatePersonAction } from "../actions";

const IDLE: ActionState = { status: "idle" };

export type RoleChoice = { key: string; name: string; description: string };

type PersonValues = {
  id?: string;
  name: string;
  phone: string;
  email: string;
  designation: string;
  roleKeys: string[];
  branchId: string;
};

/** Add or edit a person: who they are, which branch they work at, and what they do. */
export function PersonForm({
  roles,
  branches,
  person,
}: {
  roles: RoleChoice[];
  branches: { id: string; name: string }[];
  person?: PersonValues;
}) {
  const editing = Boolean(person?.id);
  const [state, formAction] = useActionState(editing ? updatePersonAction : createPersonAction, IDLE);
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const submitted = state.status === "error" ? state.values : undefined;
  const value = (key: Exclude<keyof PersonValues, "roleKeys">) =>
    typeof submitted?.[key] === "string" ? (submitted[key] as string) : ((person?.[key] as string | undefined) ?? "");
  const selectedRoles = submitted
    ? ([] as string[]).concat(submitted.roleKeys ?? [])
    : (person?.roleKeys ?? []);

  if (state.status === "success" && state.data?.temporaryPassword && !editing) {
    return <PersonCreated name={state.data.name ?? ""} phone={state.data.phone ?? ""} password={state.data.temporaryPassword} id={state.data.id ?? ""} />;
  }

  return (
    <form action={formAction} className="max-w-2xl space-y-6" noValidate>
      {person?.id && <input type="hidden" name="id" value={person.id} />}
      {state.status === "error" && <Notice tone="danger">{state.message}</Notice>}
      {state.status === "success" && state.message && <Notice tone="success">{state.message}</Notice>}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="name" label="Full name" error={errors.name}>
          <Input {...describedBy("name", errors.name)} name="name" autoComplete="off" defaultValue={value("name")} />
        </Field>
        <Field id="phone" label="Mobile number" hint="Used to sign in." error={errors.phone}>
          <Input
            {...describedBy("phone", errors.phone, true)}
            name="phone"
            type="tel"
            inputMode="tel"
            placeholder="98765 43210"
            defaultValue={value("phone")}
          />
        </Field>
      </div>

      <Field
        id="branchId"
        label="Branch"
        error={errors.branchId}
        hint="Where this person works. Branch-level roles only see their branch's records. Leave empty only for company-level roles (CEO, Admin)."
      >
        <Select {...describedBy("branchId", errors.branchId, true)} name="branchId" defaultValue={value("branchId")}>
          <option value="">No branch — company level</option>
          {branches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name}
            </option>
          ))}
        </Select>
      </Field>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Roles</legend>
        <p className="mb-3 text-sm text-ink-muted">What this person does at PTCC. Choose more than one if needed.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {roles.map((role) => (
            <label
              key={role.key}
              className={cn(
                "flex cursor-pointer gap-3 rounded-panel border border-line bg-surface px-3 py-3 transition-colors duration-150",
                "hover:border-line-strong has-[:checked]:border-brand-600 has-[:checked]:bg-brand-50/60 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-brand-500",
              )}
            >
              <input
                type="checkbox"
                name="roleKeys"
                value={role.key}
                defaultChecked={selectedRoles.includes(role.key)}
                className="mt-1 size-4 shrink-0 accent-brand-600 focus-visible:outline-none"
              />
              <span>
                <span className="block text-sm font-medium">{role.name}</span>
                <span className="block text-xs text-ink-muted">{role.description}</span>
              </span>
            </label>
          ))}
        </div>
        <FieldError id="roleKeys" error={errors.roleKeys} />
      </fieldset>

      <MoreDetails defaultOpen={Boolean(value("email") || value("designation") || errors.email)}>
        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="email" label="Email" optional hint="Can also be used to sign in." error={errors.email}>
            <Input {...describedBy("email", errors.email, true)} name="email" type="email" autoComplete="off" defaultValue={value("email")} />
          </Field>
          <Field id="designation" label="Designation" optional error={errors.designation}>
            <Input
              {...describedBy("designation", errors.designation)}
              name="designation"
              placeholder="e.g. Field Executive – Collections"
              defaultValue={value("designation")}
            />
          </Field>
        </div>
      </MoreDetails>

      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <SubmitButton size="lg" pendingLabel="Saving…" className="max-sm:w-full">
          {editing ? "Save changes" : "Add person"}
        </SubmitButton>
        <Link href="/admin/people" className={buttonClasses("ghost", "lg", "max-sm:w-full")}>
          {editing ? "Back to people" : "Cancel"}
        </Link>
      </div>
    </form>
  );
}

function TemporaryPassword({ password }: { password: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="tabular rounded-control border border-line bg-surface px-3 py-2 font-mono text-lg tracking-wide">{password}</code>
      <button
        type="button"
        className={buttonClasses("ghost", "sm")}
        onClick={async () => {
          await navigator.clipboard.writeText(password);
          setCopied(true);
        }}
      >
        <Copy aria-hidden />
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function PersonCreated({ name, phone, password, id }: { name: string; phone: string; password: string; id: string }) {
  return (
    <div className="max-w-2xl space-y-6">
      <Notice tone="success" title={`${name} has been added`}>
        They can sign in with <span className="font-medium">{phone}</span> and this temporary password. They&apos;ll
        choose their own password the first time they sign in.
      </Notice>
      <TemporaryPassword password={password} />
      <p className="text-sm text-ink-muted">
        This password is shown only once. Share it with them in person or by phone — not in a group chat.
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href="/admin/people/new" className={buttonClasses("primary")}>
          Add another person
        </Link>
        <Link href={`/admin/people/${id}`} className={buttonClasses("secondary")}>
          View {name.split(" ")[0]}
        </Link>
        <Link href="/admin/people" className={buttonClasses("ghost")}>
          Back to people
        </Link>
      </div>
    </div>
  );
}

/** Deactivate / reactivate. Deactivation signs the person out everywhere. */
export function StatusForm({ id, name, status }: { id: string; name: string; status: "active" | "inactive" }) {
  const [state, formAction] = useActionState(setPersonStatusAction, IDLE);
  const deactivating = status === "active";
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={deactivating ? "inactive" : "active"} />
      <p className="text-sm text-ink-muted">
        {deactivating
          ? `${name} will be signed out immediately and won't be able to sign in. Their work history is kept.`
          : `${name} will be able to sign in again with their existing password.`}
      </p>
      {state.status === "error" && <Notice tone="danger">{state.message}</Notice>}
      {state.status === "success" && state.message && <Notice tone="success">{state.message}</Notice>}
      <SubmitButton variant={deactivating ? "danger" : "secondary"} pendingLabel="Saving…">
        {deactivating ? `Deactivate ${name.split(" ")[0]}` : `Reactivate ${name.split(" ")[0]}`}
      </SubmitButton>
    </form>
  );
}

/** Reset password: generates a new temporary password and signs the person out. */
export function ResetPasswordForm({ id, name }: { id: string; name: string }) {
  const [state, formAction] = useActionState(resetPasswordAction, IDLE);
  if (state.status === "success" && state.data?.temporaryPassword) {
    return (
      <div className="space-y-3">
        <Notice tone="success">New temporary password for {name}. They&apos;ll choose their own at next sign-in.</Notice>
        <TemporaryPassword password={state.data.temporaryPassword} />
      </div>
    );
  }
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <p className="text-sm text-ink-muted">Creates a new temporary password and signs {name.split(" ")[0]} out on all devices.</p>
      {state.status === "error" && <Notice tone="danger">{state.message}</Notice>}
      <SubmitButton variant="secondary" pendingLabel="Resetting…">
        Reset password
      </SubmitButton>
    </form>
  );
}
