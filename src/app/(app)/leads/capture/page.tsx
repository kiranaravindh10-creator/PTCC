import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui/display";
import { FormSkeleton } from "@/components/ui/skeletons";
import { canAny, scopeOf } from "@/server/access/actor";
import { requireContext } from "@/server/auth/current";
import { captureAvailability, captureSamples } from "@/server/integrations/ai";
import { listActiveBranches } from "@/modules/customers/queries";
import { canChooseAnyLeadBranch } from "@/modules/leads/access";
import { getCaptureForReview } from "@/modules/leads/capture-service";
import { listMarketers } from "@/modules/leads/queries";
import { CaptureFlow } from "@/modules/leads/ui/capture/capture-flow";

export const metadata: Metadata = { title: "Capture lead" };

export default function CaptureLeadPage({ searchParams }: PageProps<"/leads/capture">) {
  return (
    <div className="space-y-6">
      <Link href="/leads" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Leads
      </Link>
      <PageHeader title="Capture lead" description="From a photo, your voice or a few typed words. You check everything before it's saved." />
      <Suspense fallback={<FormSkeleton />}>
        <Capture searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Capture({ searchParams }: { searchParams: PageProps<"/leads/capture">["searchParams"] }) {
  const ctx = await requireContext();
  if (!canAny(ctx.actor, "lead.capture", "marketing.work")) notFound();
  const { capture: captureId } = await searchParams;
  const availability = captureAvailability();
  const [branches, resumed] = await Promise.all([
    listActiveBranches(ctx),
    availability.mode !== "off" && typeof captureId === "string" ? getCaptureForReview(ctx, captureId) : Promise.resolve(null),
  ]);

  // People who route leads can pick the owner — for their branch, or any branch (as on the form).
  const assignScope = scopeOf(ctx.actor, "marketing.assign");
  let marketersByBranch: Record<string, { id: string; name: string }[]> | null = null;
  if (assignScope === "all" || assignScope === "branch") {
    const assignable = assignScope === "all" ? branches : branches.filter((b) => b.id === ctx.actor.branchId);
    const lists = await Promise.all(assignable.map((branch) => listMarketers(ctx, branch.id)));
    marketersByBranch = Object.fromEntries(assignable.map((branch, i) => [branch.id, lists[i]!]));
  }

  // A new lead goes to my own branch or "Not sure which branch"; only the CEO and Admin place it elsewhere.
  const selectable = canChooseAnyLeadBranch(ctx.actor) ? branches : branches.filter((b) => b.id === ctx.actor.branchId);

  return (
    <CaptureFlow
      availability={availability}
      samples={captureSamples(availability.mode)}
      branches={selectable.map(({ id, name }) => ({ id, name }))}
      allBranches={branches.map(({ id, name }) => ({ id, name }))}
      defaultBranchId={ctx.actor.branchId ?? ""}
      marketersByBranch={marketersByBranch}
      actorId={ctx.actor.id}
      initialCapture={resumed}
    />
  );
}
