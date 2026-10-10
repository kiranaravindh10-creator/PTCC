import { KeyRound } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { signOutAction } from "@/app/(auth)/actions";
import { ButtonLink } from "@/components/ui/button";
import { Avatar, Fact, Facts, Notice, PageHeader, Panel } from "@/components/ui/display";
import { DetailSkeleton } from "@/components/ui/skeletons";
import { SubmitButton } from "@/components/ui/submit-button";
import { requireContext } from "@/server/auth/current";
import { formatPhone } from "@/lib/phone";
import { getOwnProfile } from "@/modules/users/queries";

export const metadata: Metadata = { title: "Your account" };

export default function AccountPage({ searchParams }: PageProps<"/account">) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <Account searchParams={searchParams} />
    </Suspense>
  );
}

async function Account({ searchParams }: { searchParams: PageProps<"/account">["searchParams"] }) {
  const ctx = await requireContext();
  const profile = await getOwnProfile(ctx);
  if (!profile) notFound();
  const { changed } = await searchParams;

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="Your account" />
      {changed && <Notice tone="success">Password changed. You&apos;ve been signed out on your other devices.</Notice>}
      <Panel>
        <div className="flex items-center gap-4 border-b border-line px-4 py-4">
          <Avatar name={profile.name} size="lg" />
          <div>
            <p className="text-lg font-semibold">{profile.name}</p>
            {profile.designation && <p className="text-sm text-ink-muted">{profile.designation}</p>}
          </div>
        </div>
        <Facts>
          <Fact label="Mobile">{formatPhone(profile.phone)}</Fact>
          {profile.email && <Fact label="Email">{profile.email}</Fact>}
          <Fact label="Branch">{ctx.actor.branchName ?? "Company level — not tied to one branch"}</Fact>
          <Fact label="Roles">{profile.roleNames.join(", ")}</Fact>
        </Facts>
      </Panel>
      <p className="text-sm text-ink-muted">To change your name, number, branch or roles, ask your administrator.</p>
      <div className="flex flex-wrap gap-3">
        <ButtonLink href="/account/password" variant="secondary">
          <KeyRound aria-hidden />
          Change password
        </ButtonLink>
        <form action={signOutAction}>
          <SubmitButton variant="ghost" pendingLabel="Signing out…">
            Sign out
          </SubmitButton>
        </form>
      </div>
    </div>
  );
}
