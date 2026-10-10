import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui/display";
import { FormSkeleton } from "@/components/ui/skeletons";
import { can } from "@/server/access/actor";
import { requireContext } from "@/server/auth/current";
import { listActiveBranches } from "@/modules/customers/queries";
import { listRoles } from "@/modules/users/queries";
import { PersonForm } from "@/modules/users/ui/person-form";

export const metadata: Metadata = { title: "Add person" };

export default function NewPersonPage() {
  return (
    <div className="space-y-6">
      <Link href="/admin/people" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        People
      </Link>
      <PageHeader title="Add person" description="They'll get a temporary password and choose their own at first sign-in." />
      <Suspense fallback={<FormSkeleton />}>
        <NewPerson />
      </Suspense>
    </div>
  );
}

async function NewPerson() {
  const ctx = await requireContext();
  if (!can(ctx.actor, "user.manage")) notFound();
  const [roles, branches] = await Promise.all([listRoles(ctx), listActiveBranches(ctx)]);
  return (
    <PersonForm
      roles={roles.map(({ key, name, description }) => ({ key, name, description }))}
      branches={branches.map(({ id, name }) => ({ id, name }))}
    />
  );
}
