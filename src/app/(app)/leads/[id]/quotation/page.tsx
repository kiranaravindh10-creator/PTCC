import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Notice, PageHeader } from "@/components/ui/display";
import { FormSkeleton } from "@/components/ui/skeletons";
import { requireContext } from "@/server/auth/current";
import { canWorkLead } from "@/modules/leads/access";
import { isOpenStage, leadRef } from "@/modules/leads/model";
import { getLead, getLeadRequirements } from "@/modules/leads/queries";
import { QuotationForm } from "@/modules/leads/ui/quotation-form";

export const metadata: Metadata = { title: "New quotation" };

export default function NewQuotationPage({ params }: PageProps<"/leads/[id]/quotation">) {
  return (
    <Suspense fallback={<FormSkeleton />}>
      <NewQuotation params={params} />
    </Suspense>
  );
}

async function NewQuotation({ params }: { params: PageProps<"/leads/[id]/quotation">["params"] }) {
  const ctx = await requireContext();
  const { id } = await params;
  const lead = await getLead(ctx, id);
  if (!lead || !canWorkLead(ctx.actor, lead)) notFound();
  const requirements = await getLeadRequirements(ctx, lead);

  return (
    <div className="space-y-6">
      <Link href={`/leads/${lead.id}`} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        {lead.companyName} · {leadRef(lead.number)}
      </Link>
      <PageHeader title="New quotation" description={`${lead.companyName} · ${lead.branchName ?? "branch not set"}`} />
      {!isOpenStage(lead.stage) || !lead.branchId ? (
        <Notice tone="info">This lead can&apos;t be quoted: {lead.branchId ? "it is closed" : "choose its branch first"}.</Notice>
      ) : (
        <QuotationForm
          leadId={lead.id}
          initialLines={requirements.map((r) => ({ description: r.description, quantity: r.quantity, scopeEntryId: r.scopeEntryId }))}
        />
      )}
    </div>
  );
}
