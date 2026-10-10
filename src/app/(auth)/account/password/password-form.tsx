"use client";

import { useActionState } from "react";
import { describedBy, Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/display";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionState } from "@/server/action-result";
import { changePasswordAction } from "@/modules/users/actions";

const IDLE: ActionState = { status: "idle" };

export function PasswordForm({ firstTime }: { firstTime: boolean }) {
  const [state, formAction] = useActionState(changePasswordAction, IDLE);
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={formAction} className="mt-6 space-y-5" noValidate>
      {state.status === "error" && !Object.keys(errors).length && <Notice tone="danger">{state.message}</Notice>}
      <Field
        id="currentPassword"
        label={firstTime ? "Temporary password" : "Current password"}
        hint={firstTime ? "The one your administrator gave you." : undefined}
        error={errors.currentPassword}
      >
        <Input
          {...describedBy("currentPassword", errors.currentPassword, firstTime)}
          name="currentPassword"
          type="password"
          autoComplete="current-password"
        />
      </Field>
      <Field id="newPassword" label="New password" error={errors.newPassword}>
        <Input {...describedBy("newPassword", errors.newPassword)} name="newPassword" type="password" autoComplete="new-password" />
      </Field>
      <Field id="confirmPassword" label="Type it again" error={errors.confirmPassword}>
        <Input
          {...describedBy("confirmPassword", errors.confirmPassword)}
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
        />
      </Field>
      <SubmitButton size="lg" className="w-full" pendingLabel="Saving…">
        {firstTime ? "Save and continue" : "Change password"}
      </SubmitButton>
    </form>
  );
}
