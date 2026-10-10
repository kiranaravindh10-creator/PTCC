import { ArrowLeft, BadgeCheck, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CustomersAreaTabs } from "@/components/ui/area-tabs";
import { Notice, PageHeader, Section } from "@/components/ui/display";
import { ListSkeleton } from "@/components/ui/skeletons";
import { can, canAny } from "@/server/access/actor";
import { requireContext } from "@/server/auth/current";
import { cn } from "@/lib/format";
import { companyToday, formatDayLabel } from "@/lib/time";
import { listAccreditations, listGroupEntries, scopeOverview } from "@/modules/catalogue/queries";
import { listActiveBranches } from "@/modules/customers/queries";
import { ScopeBrowserSearch } from "./scope-browser";

export const metadata: Metadata = { title: "Services" };

export default function ServicesPage({ searchParams }: PageProps<"/services">) {
  return (
    <Suspense fallback={<ListSkeleton title="Services" />}>
      <Services searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * PTCC's accredited calibration scope, by branch — controlled reference data imported from
 * the NABL accreditation documents (docs/SERVICE_CATALOGUE.md). Read-only here.
 */
async function Services({ searchParams }: { searchParams: PageProps<"/services">["searchParams"] }) {
  const ctx = await requireContext();
  if (!can(ctx.actor, "catalogue.read")) notFound();
  const { group } = await searchParams;
  const today = companyToday(ctx.now);
  const [accreditations, overview, activeBranches] = await Promise.all([listAccreditations(ctx), scopeOverview(ctx), listActiveBranches(ctx)]);
  // Branches with no confirmed certificate have NO accredited scope — say so, never borrow another branch's.
  const unaccredited = activeBranches.filter(
    (branch) => !accreditations.some((a) => a.branchId === branch.id && a.branchLinkStatus === "confirmed"),
  );
  const branchNames = accreditations.map((a) => a.branchName ?? "Needs verification");
  const showTabs = canAny(ctx.actor, "customer.read", "customer.read.all");

  if (typeof group === "string") {
    const selected = overview.find((g) => g.groupId === group);
    if (!selected) notFound();
    const entries = await listGroupEntries(ctx, group);
    return (
      <div className="max-w-5xl space-y-6">
        <Link href="/services" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden />
          Services
        </Link>
        <PageHeader title={selected.groupLabel} description={`${selected.disciplineLabel} · ${entries.length} accredited rows`} />
        <div className="overflow-x-auto rounded-panel border border-line bg-surface">
          <table className="w-full min-w-[44rem] text-left text-sm">
            <thead className="border-b border-line text-xs text-ink-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Branch</th>
                <th className="px-3 py-2 font-medium">Instrument / measurand</th>
                <th className="px-3 py-2 font-medium">Method</th>
                <th className="px-3 py-2 font-medium">Range</th>
                <th className="px-3 py-2 font-medium">CMC (±)</th>
                <th className="px-3 py-2 font-medium">Facility</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {entries.map((entry) => (
                <tr key={entry.id} className="align-top">
                  <td className="px-3 py-2 font-medium whitespace-nowrap">{entry.branchName ?? "Needs verification"}</td>
                  <td className="px-3 py-2">{entry.measurandOrInstrument}</td>
                  <td className="px-3 py-2 text-ink-muted">{entry.method}</td>
                  <td className="tabular px-3 py-2">{entry.rangeText}</td>
                  <td className="tabular px-3 py-2">{entry.cmcText}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-ink-muted">{entry.facilityType === "site" ? "Site" : "Permanent"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink-subtle">As printed in the NABL scope annexures. Source page numbers are kept with every row.</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <PageHeader title="Services" description="What each PTCC branch is accredited to calibrate (ISO/IEC 17025, NABL)" />
      {showTabs && <CustomersAreaTabs active="services" />}

      <div className="space-y-10">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {accreditations.map((accreditation) => {
            const expired = accreditation.validUntil !== null && accreditation.validUntil < today;
            return (
              <li key={accreditation.id} className="rounded-panel border border-line bg-surface px-4 py-3">
                <p className="flex items-center gap-1.5 font-semibold">
                  <BadgeCheck className={cn("size-4", expired ? "text-danger-700" : "text-success-700")} aria-hidden />
                  {accreditation.branchName ?? "Branch needs verification"}
                </p>
                <p className="mt-0.5 text-sm text-ink-muted">
                  {accreditation.accreditationBody} {accreditation.certificateNumber}
                </p>
                <p className={cn("text-sm", expired ? "font-medium text-danger-700" : "text-ink-muted")}>
                  {expired ? "Expired " : "Valid until "}
                  {accreditation.validUntil ? formatDayLabel(accreditation.validUntil, today) : "—"}
                </p>
                <p className="mt-1 text-xs text-ink-subtle">
                  {accreditation.permanentEntries} at lab · {accreditation.siteEntries} at site
                </p>
              </li>
            );
          })}
          {unaccredited.map((branch) => (
            <li key={branch.id} className="rounded-panel border border-warning-700/25 bg-warning-50 px-4 py-3">
              <p className="flex items-center gap-1.5 font-semibold">
                <TriangleAlert className="size-4 text-warning-700" aria-hidden />
                {branch.name}
              </p>
              <p className="mt-0.5 text-sm font-medium text-warning-700">Accreditation not verified</p>
              <p className="mt-1 text-xs text-ink-muted">No certificate or scope supplied yet — nothing is shown as accredited here.</p>
            </li>
          ))}
        </ul>

        <Section title="Search the scope" description="Every row shows the branch, range and CMC. Not finding it means PTCC's accreditation for it is not confirmed.">
          <ScopeBrowserSearch />
        </Section>

        <Section title="Browse by group" description="Rows per branch — a dash means the branch is not accredited for that group">
          <div className="overflow-x-auto rounded-panel border border-line bg-surface">
            <table className="w-full min-w-[34rem] text-left text-sm">
              <thead className="border-b border-line text-xs text-ink-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Group</th>
                  {branchNames.map((name) => (
                    <th key={name} className="px-3 py-2 text-right font-medium">
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {overview.map((row) => (
                  <tr key={row.groupId}>
                    <td className="px-3 py-2">
                      <Link href={`/services?group=${row.groupId}`} className="font-medium hover:text-brand-700">
                        {row.groupLabel}
                      </Link>
                      <span className="block text-xs text-ink-subtle">{row.disciplineLabel}</span>
                    </td>
                    {branchNames.map((name) => (
                      <td key={name} className="tabular px-3 py-2 text-right">
                        {row.byBranch[name] ? row.byBranch[name] : <span className="text-ink-subtle">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Notice tone="info" title="Controlled reference information">
          Imported from PTCC&apos;s NABL scope documents. It is never edited here. When a scope is amended, the new document is
          imported and earlier rows are kept for history. A requirement outside the scope is shown as &ldquo;Scope not
          confirmed — verify with PTCC&rdquo;.
        </Notice>
      </div>
    </div>
  );
}
