import { Building2, Plus, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CustomersAreaTabs } from "@/components/ui/area-tabs";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, List, PageHeader } from "@/components/ui/display";
import { ListSkeleton } from "@/components/ui/skeletons";
import { Tabs } from "@/components/ui/tabs";
import { can, canAny } from "@/server/access/actor";
import { requireContext } from "@/server/auth/current";
import { cn } from "@/lib/format";
import type { CompanyRelationship } from "@/server/db/schema";
import { listActiveBranches, listCustomers } from "@/modules/customers/queries";

export const metadata: Metadata = { title: "Customers" };

const RELATIONSHIP_LABEL: Record<CompanyRelationship, string> = { prospect: "Prospect", customer: "Customer", inactive: "Inactive" };

export default function CustomersPage({ searchParams }: PageProps<"/customers">) {
  return (
    <Suspense fallback={<ListSkeleton title="Customers" />}>
      <Customers searchParams={searchParams} />
    </Suspense>
  );
}

async function Customers({ searchParams }: { searchParams: PageProps<"/customers">["searchParams"] }) {
  const ctx = await requireContext();
  if (!canAny(ctx.actor, "customer.read", "customer.read.all")) notFound();
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q : "";
  const filter = params.show === "customer" || params.show === "prospect" ? params.show : null;
  const companyWide = can(ctx.actor, "customer.read.all");
  const branches = companyWide ? await listActiveBranches(ctx) : [];
  const branchId = companyWide && typeof params.branch === "string" && branches.some((b) => b.id === params.branch) ? params.branch : null;
  const customers = await listCustomers(ctx, { query, relationship: filter ?? undefined, branchId });

  const href = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams();
    for (const [key, val] of Object.entries({ q: query, show: filter, branch: branchId, ...changes })) if (val) next.set(key, val);
    const qs = next.toString();
    return qs ? `/customers?${qs}` : "/customers";
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Customers"
        description={companyWide ? "Every company PTCC works with, across all branches" : `Companies ${ctx.actor.branchName ?? "your branch"} works with`}
        actions={
          can(ctx.actor, "customer.write") ? (
            <ButtonLink href="/customers/new" variant="primary">
              <Plus aria-hidden />
              Add customer
            </ButtonLink>
          ) : undefined
        }
      />
      <CustomersAreaTabs active="customers" />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Tabs
          label="Show"
          items={[
            { href: href({ show: null }), label: "All", active: !filter },
            { href: href({ show: "customer" }), label: "Customers", active: filter === "customer" },
            { href: href({ show: "prospect" }), label: "Prospects", active: filter === "prospect" },
          ]}
        />
        <form action="/customers" className="relative min-w-48 flex-1">
          {filter && <input type="hidden" name="show" value={filter} />}
          {branchId && <input type="hidden" name="branch" value={branchId} />}
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
          <label htmlFor="customer-search" className="sr-only">
            Search by name or area
          </label>
          <input
            id="customer-search"
            name="q"
            defaultValue={query}
            placeholder="Search by name or area"
            className="block h-9 w-full rounded-control border border-line-strong bg-surface pr-3 pl-9 text-sm placeholder:text-ink-subtle focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25 focus:outline-none"
          />
        </form>
      </div>
      {companyWide && branches.length > 0 && (
        <div className="mb-6">
          <Tabs
            label="Branch"
            items={[
              { href: href({ branch: null }), label: "All branches", active: !branchId },
              ...branches.map((b) => ({ href: href({ branch: b.id }), label: b.name, active: b.id === branchId })),
            ]}
          />
        </div>
      )}

      {customers.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title={query ? "No customers match that search" : "No customers yet"}
          description={query ? "Check the spelling, or search by area." : "Customers appear here when a lead or customer is added for your branch."}
        />
      ) : (
        <List>
          {customers.map((customer) => (
            <li key={customer.id}>
              <Link href={`/customers/${customer.id}`} className="block px-4 py-3 hover:bg-subtle/60 focus-visible:-outline-offset-2">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-medium">{customer.name}</span>
                  {customer.openLeads > 0 && (
                    <span className="shrink-0 text-sm text-ink-muted">
                      {customer.openLeads} open {customer.openLeads === 1 ? "lead" : "leads"}
                    </span>
                  )}
                </div>
                <div className="truncate text-sm text-ink-muted">
                  {[customer.area, customer.city, customer.industry].filter(Boolean).join(" · ") || "Address not recorded"}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {customer.relationships.map((relationship) => (
                    <span
                      key={relationship.branchId}
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                        relationship.relationship === "customer" ? "bg-success-50 text-success-700" : "bg-subtle text-ink-muted",
                      )}
                    >
                      {companyWide ? `${relationship.branchName} · ` : ""}
                      {RELATIONSHIP_LABEL[relationship.relationship]}
                    </span>
                  ))}
                </div>
              </Link>
            </li>
          ))}
        </List>
      )}
    </div>
  );
}
