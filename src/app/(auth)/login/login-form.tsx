"use client";

import { Eye, EyeOff } from "lucide-react";
import { useActionState, useState } from "react";
import { describedBy, Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/display";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionState } from "@/server/action-result";
import { signInAction } from "../actions";

const IDLE: ActionState = { status: "idle" };

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(signInAction, IDLE);
  const [showPassword, setShowPassword] = useState(false);
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const values = state.status === "error" ? (state.values ?? {}) : {};

  return (
    <form action={formAction} className="mt-6 space-y-5" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      {state.status === "error" && !Object.keys(errors).length && <Notice tone="danger">{state.message}</Notice>}

      <Field id="identifier" label="Mobile number or email" error={errors.identifier}>
        <Input
          {...describedBy("identifier", errors.identifier)}
          name="identifier"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="98765 43210"
          defaultValue={typeof values.identifier === "string" ? values.identifier : ""}
          autoFocus
        />
      </Field>

      <Field id="password" label="Password" error={errors.password}>
        <div className="relative">
          <Input
            {...describedBy("password", errors.password)}
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            className="pr-12"
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-control text-ink-muted hover:text-ink"
            aria-label={showPassword ? "Hide password" : "Show password"}
            aria-pressed={showPassword}
          >
            {showPassword ? <EyeOff className="size-[18px]" aria-hidden /> : <Eye className="size-[18px]" aria-hidden />}
          </button>
        </div>
      </Field>

      <SubmitButton size="lg" className="w-full" pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}
