import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Logo } from "@/components/shell/shell";
import { Skeleton } from "@/components/ui/display";
import { getActor } from "@/server/auth/current";
import { DevAccounts } from "@/dev/dev-accounts";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-12 sm:justify-center">
      <div className="w-full max-w-sm">
        <Logo className="mx-auto h-auto w-60" />
        <div className="mt-12">
          <h1 className="text-2xl font-semibold tracking-tight">Sign in to PTCC</h1>
          <p className="mt-1 text-ink-muted">Use the mobile number or email your administrator registered.</p>
          <Suspense fallback={<FormSkeleton />}>
            <SignIn searchParams={searchParams} />
          </Suspense>
        </div>
        <p className="mt-8 text-sm text-ink-muted">
          Trouble signing in? Ask your administrator to reset your password.
        </p>
      </div>
      {process.env.NODE_ENV !== "production" && (
        <Suspense fallback={null}>
          <DevAccounts />
        </Suspense>
      )}
    </div>
  );
}

async function SignIn({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  if (await getActor()) redirect("/");
  const { next } = await searchParams;
  return <LoginForm next={typeof next === "string" ? next : undefined} />;
}

function FormSkeleton() {
  return (
    <div className="mt-6 space-y-5" aria-hidden>
      <Skeleton className="h-16" />
      <Skeleton className="h-16" />
      <Skeleton className="h-12" />
    </div>
  );
}
