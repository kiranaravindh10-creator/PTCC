import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader } from "@/components/ui/display";
import { FormSkeleton } from "@/components/ui/skeletons";
import { can } from "@/server/access/actor";
import { requireContext } from "@/server/auth/current";
import { linkableBranches } from "@/modules/customers/queries";
import { NewCustomerForm } from "@/modules/customers/ui/customer-forms";

export const metadata: Metadata = { title: "Add customer" };

export default function NewCustomerPage() {
  return (
    <div className="space-y-6">
      <Link href="/customers" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Customers
      </Link>
      <PageHeader title="Add customer" />
      <Suspense fallback={<FormSkeleton />}>
        <NewCustomer />
      </Suspense>
    </div>
  );
}

async function NewCustomer() {
  const ctx = await requireContext();
  if (!can(ctx.actor, "customer.write")) notFound();
  const companyWide = can(ctx.actor, "customer.read.all");
  const branches = await linkableBranches(ctx);
  return <NewCustomerForm branches={companyWide ? branches : null} defaultBranchId={ctx.actor.branchId ?? branches[0]?.id ?? ""} />;
}
