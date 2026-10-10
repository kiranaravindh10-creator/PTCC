import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Fact, Facts, List, PageHeader, Panel, Section } from "@/components/ui/display";
import { ListSkeleton } from "@/components/ui/skeletons";
import { can } from "@/server/access/actor";
import { requireContext } from "@/server/auth/current";
import { cn } from "@/lib/format";
import { companyToday, daysBetween, formatDayLabel, formatTimestamp } from "@/lib/time";
import { listAccreditations, listScopeDocuments, type AccreditationView } from "@/modules/catalogue/queries";
import { AdminTabs } from "@/modules/users/ui/admin-tabs";

export const metadata: Metadata = { title: "Scope documents" };

export default function ScopePage() {
  return (
    <Suspense fallback={<ListSkeleton title="Scope documents" />}>
      <Scope />
    </Suspense>
  );
}

async function Scope() {
  const ctx = await requireContext();
  if (!can(ctx.actor, "catalogue.manage")) notFound();
  const [accreditations, documents] = await Promise.all([listAccreditations(ctx), listScopeDocuments(ctx)]);
  const today = companyToday(ctx.now);

  return (
    <div className="max-w-4xl">
      <PageHeader title="People & access" description="PTCC's NABL scope — the only source for what the platform shows as accredited" />
      <AdminTabs actor={ctx.actor} active="scope" />

      <div className="space-y-10">
        <Section title="Certificates" description="Imported from the certificate and scope documents. Read-only.">
          {accreditations.length === 0 ? (
            <Panel className="p-4 text-sm text-ink-muted">No scope has been imported yet. Run npm run scope:import.</Panel>
          ) : (
            <div className="space-y-4">
              {accreditations.map((accreditation) => (
                <Certificate key={accreditation.id} accreditation={accreditation} today={today} />
              ))}
            </div>
          )}
        </Section>

        <Section title="Source documents" description="Each import is identified by the file's SHA-256, so the same file is never imported twice.">
          <List>
            {documents.map((document) => (
              <li key={document.id} className="grid gap-1 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] sm:gap-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">{document.fileName}</p>
                  <p className="truncate font-mono text-xs text-ink-subtle" title={document.sha256}>
                    SHA-256 {document.sha256.slice(0, 16)}…
                  </p>
                </div>
                <div className="min-w-0 text-ink-muted">
                  <p className="truncate">
                    {document.kind === "scope"
                      ? `${document.currentEntries} current rows${document.retiredEntries ? `, ${document.retiredEntries} superseded` : ""}`
                      : "Certificate details"}
                  </p>
                  <p className="truncate text-xs text-ink-subtle">
                    Imported {formatTimestamp(document.importedAt, ctx.now)}
                    {document.importedByName ? ` by ${document.importedByName}` : " from the command line"}
                  </p>
                </div>
              </li>
            ))}
          </List>
        </Section>

        <Section title="When the scope changes">
          <Panel className="space-y-3 p-4 text-sm text-ink-muted">
            <p>
              When NABL amends a scope or issues a new certificate, the technical team parses the new PDF with{" "}
              <code className="font-mono text-xs">tools/scope-parser</code>, checks the output and runs{" "}
              <code className="font-mono text-xs">npm run scope:import</code>.
            </p>
            <p>
              Rows from the earlier version are kept and marked superseded, so existing leads and quotations still show
              exactly what they referred to. A certificate whose branch PTCC has not confirmed is imported as{" "}
              <span className="font-medium text-ink">Needs verification</span> and is not shown as any branch&apos;s scope
              until it is confirmed.
            </p>
            <p>
              Details: <code className="font-mono text-xs">docs/SERVICE_CATALOGUE.md</code>. Branch details are edited
              under{" "}
              <Link href="/admin/branches" className="font-medium text-brand-600 hover:text-brand-700">
                Branches
              </Link>
              .
            </p>
          </Panel>
        </Section>
      </div>
    </div>
  );
}

function Certificate({ accreditation, today }: { accreditation: AccreditationView; today: string }) {
  const daysLeft = accreditation.validUntil ? daysBetween(today, accreditation.validUntil) : null;
  const validity =
    accreditation.validFrom && accreditation.validUntil
      ? `${formatDayLabel(accreditation.validFrom, today)} – ${formatDayLabel(accreditation.validUntil, today)}`
      : "Not stated in the document";
  return (
    <Panel>
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
        <h3 className="font-semibold">
          {accreditation.accreditationBody} {accreditation.certificateNumber}
        </h3>
        <span
          className={cn(
            "text-sm",
            accreditation.branchLinkStatus === "confirmed" ? "text-ink-muted" : "font-medium text-warning-700",
          )}
        >
          {accreditation.branchLinkStatus === "confirmed" && accreditation.branchName
            ? `${accreditation.branchName} branch`
            : "Branch needs verification"}
        </span>
      </header>
      <Facts>
        <Fact label="Valid">
          {validity}
          {daysLeft !== null && daysLeft < 0 && <span className="ml-2 font-medium text-danger-700">Expired</span>}
          {daysLeft !== null && daysLeft >= 0 && daysLeft <= 90 && (
            <span className="ml-2 font-medium text-warning-700">Expires in {daysLeft} days</span>
          )}
        </Fact>
        <Fact label="Last amended">
          {accreditation.lastAmendedOn ? formatDayLabel(accreditation.lastAmendedOn, today) : "Not stated"}
        </Fact>
        <Fact label="Scope rows">
          {accreditation.currentEntries}
          <span className="text-ink-muted">
            {" "}
            ({accreditation.permanentEntries} at the laboratory, {accreditation.siteEntries} on site)
          </span>
        </Fact>
        <Fact label="Standard">{[accreditation.standard, accreditation.field].filter(Boolean).join(" · ") || "Not stated"}</Fact>
        <Fact label="Facility">
          <span className="break-words text-sm">{accreditation.facilityAddress ?? "Not stated"}</span>
        </Fact>
      </Facts>
    </Panel>
  );
}
