import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Logo } from "@/components/shell/shell";
import { FormSkeleton } from "@/components/ui/skeletons";
import { requireActor } from "@/server/auth/current";
import { firstName } from "@/lib/format";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Choose a password" };

/**
 * Change password. Also the first screen after an admin creates an account or resets
 * a password — every other page redirects here until a new password is chosen.
 */
export default function PasswordPage() {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-12 sm:justify-center">
      <div className="w-full max-w-sm">
        <Logo className="mx-auto h-auto w-48" />
        <Suspense fallback={<FormSkeleton />}>
          <ChangePassword />
        </Suspense>
      </div>
    </div>
  );
}

async function ChangePassword() {
  const actor = await requireActor({ allowPasswordChange: true });
  const firstTime = actor.mustChangePassword;
  return (
    <div className="mt-10">
      <h1 className="text-2xl font-semibold tracking-tight">
        {firstTime ? `Welcome, ${firstName(actor.name)}` : "Change your password"}
      </h1>
      <p className="mt-1 text-ink-muted">
        {firstTime
          ? "Choose your own password to continue. Use at least 8 characters — a short phrase is easy to remember and hard to guess."
          : "Use at least 8 characters. You'll stay signed in here and be signed out on other devices."}
      </p>
      <PasswordForm firstTime={firstTime} />
      {!firstTime && (
        <Link href="/account" className="mt-4 inline-block text-sm font-medium text-ink-muted hover:text-ink">
          Back to your account
        </Link>
      )}
    </div>
  );
}
