import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui/display";
import { FormSkeleton } from "@/components/ui/skeletons";
import { canAny, scopeOf } from "@/server/access/actor";
import { requireContext } from "@/server/auth/current";
import { listActiveBranches } from "@/modules/customers/queries";
import { listMarketers } from "@/modules/leads/queries";
import { NewLeadForm } from "@/modules/leads/ui/new-lead-form";

export const metadata: Metadata = { title: "Add lead" };

export default function NewLeadPage() {
  return (
    <div className="space-y-6">
      <Link href="/leads" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Leads
      </Link>
      <PageHeader title="Add lead" description="Company, contact and what they need — the rest can come later." />
      <Suspense fallback={<FormSkeleton />}>
        <NewLead />
      </Suspense>
    </div>
  );
}

async function NewLead() {
  const ctx = await requireContext();
  if (!canAny(ctx.actor, "lead.capture", "marketing.work")) notFound();
  const branches = await listActiveBranches(ctx);
  const assignScope = scopeOf(ctx.actor, "marketing.assign");

  // People who route leads can pick the owner — for their branch, or any branch.
  let marketersByBranch: Record<string, { id: string; name: string }[]> | null = null;
  if (assignScope === "all" || assignScope === "branch") {
    const assignable = assignScope === "all" ? branches : branches.filter((b) => b.id === ctx.actor.branchId);
    const lists = await Promise.all(assignable.map((branch) => listMarketers(ctx, branch.id)));
    marketersByBranch = Object.fromEntries(assignable.map((branch, i) => [branch.id, lists[i]!]));
  }

  return (
    <NewLeadForm
      branches={branches.map(({ id, name }) => ({ id, name }))}
      defaultBranchId={ctx.actor.branchId ?? ""}
      marketersByBranch={marketersByBranch}
      actorId={ctx.actor.id}
      defaultSource={ctx.actor.permissions.has("marketing.work") ? "phone_enquiry" : "employee"}
    />
  );
}
