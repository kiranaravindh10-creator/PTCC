import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui/display";
import { FormSkeleton } from "@/components/ui/skeletons";
import { can } from "@/server/access/actor";
import { requireContext } from "@/server/auth/current";
import { BranchForm } from "@/modules/branches/ui/branch-form";

export const metadata: Metadata = { title: "Add branch" };

export default function NewBranchPage() {
  return (
    <div className="space-y-6">
      <Link href="/admin/branches" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Branches
      </Link>
      <PageHeader title="Add branch" description="People, customers, leads and work can then be linked to it." />
      <Suspense fallback={<FormSkeleton />}>
        <NewBranch />
      </Suspense>
    </div>
  );
}

async function NewBranch() {
  const ctx = await requireContext();
  if (!can(ctx.actor, "branch.manage")) notFound();
  return <BranchForm />;
}
