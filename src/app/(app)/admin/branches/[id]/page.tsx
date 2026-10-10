import { ArrowLeft, MapPin } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ExternalButton } from "@/components/ui/button";
import { PageHeader, Panel, Section } from "@/components/ui/display";
import { DetailSkeleton } from "@/components/ui/skeletons";
import { can } from "@/server/access/actor";
import { requireContext } from "@/server/auth/current";
import { formatPhone } from "@/lib/phone";
import { companyToday, formatDayLabel } from "@/lib/time";
import { getBranch } from "@/modules/branches/service";
import { BranchForm, BranchStatusForm } from "@/modules/branches/ui/branch-form";
import { listAccreditations } from "@/modules/catalogue/queries";

export const metadata: Metadata = { title: "Branch" };

export default function BranchPage({ params }: PageProps<"/admin/branches/[id]">) {
  return (
    <div className="space-y-6">
      <Link href="/admin/branches" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Branches
      </Link>
      <Suspense fallback={<DetailSkeleton />}>
        <Branch params={params} />
      </Suspense>
    </div>
  );
}

async function Branch({ params }: { params: PageProps<"/admin/branches/[id]">["params"] }) {
  const ctx = await requireContext();
  if (!can(ctx.actor, "branch.manage")) notFound();
  const { id } = await params;
  const [branch, accreditations] = await Promise.all([getBranch(ctx, id), listAccreditations(ctx)]);
  if (!branch) notFound();
  const certificates = accreditations.filter((accreditation) => accreditation.branchId === branch.id);
  const today = companyToday(ctx.now);

  return (
    <div className="space-y-10">
      <PageHeader
        title={branch.name}
        description={[
          [branch.city, branch.state].filter(Boolean).join(", ") || null,
          branch.verification === "verified" ? "Details confirmed" : "Needs verification",
          certificates.length === 0 ? "Accreditation not verified" : null,
          branch.status === "inactive" ? "Inactive" : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          branch.mapsUrl ? (
            <ExternalButton href={branch.mapsUrl} target="_blank" rel="noopener noreferrer">
              <MapPin aria-hidden />
              Open in Google Maps
            </ExternalButton>
          ) : undefined
        }
      />
      {branch.description && <p className="-mt-6 max-w-2xl text-ink-muted">{branch.description}</p>}
      <BranchForm
        branch={{
          id: branch.id,
          name: branch.name,
          addressLine: branch.addressLine ?? "",
          city: branch.city ?? "",
          state: branch.state ?? "",
          pincode: branch.pincode ?? "",
          phone: branch.phone ? formatPhone(branch.phone) : "",
          email: branch.email ?? "",
          mapsUrl: branch.mapsUrl ?? "",
          description: branch.description ?? "",
          notes: branch.notes ?? "",
          verified: branch.verification === "verified",
        }}
      />
      <div className="grid max-w-2xl gap-6 sm:grid-cols-2">
        <Section title="Accreditation">
          <Panel className="space-y-2 p-4 text-sm">
            {certificates.length > 0 ? (
              certificates.map((certificate) => (
                <p key={certificate.id}>
                  <span className="font-medium">
                    {certificate.accreditationBody} {certificate.certificateNumber}
                  </span>
                  <span className="text-ink-muted">
                    {" "}
                    · {certificate.currentEntries} scope rows
                    {certificate.validUntil ? ` · valid until ${formatDayLabel(certificate.validUntil, today)}` : ""}
                  </span>
                </p>
              ))
            ) : (
              <p>
                <span className="font-medium text-warning-700">Accreditation not verified.</span>{" "}
                <span className="text-ink-muted">
                  No NABL certificate or scope has been supplied for this branch, so no service is shown as accredited here —
                  including services accredited at other branches.
                </span>
              </p>
            )}
            {can(ctx.actor, "catalogue.manage") && (
              <Link href="/admin/scope" className="inline-block font-medium text-brand-600 hover:text-brand-700">
                Scope documents
              </Link>
            )}
          </Panel>
        </Section>
        <Section title="Status">
          <Panel className="p-4">
            <BranchStatusForm id={branch.id} name={branch.name} status={branch.status} />
          </Panel>
        </Section>
      </div>
    </div>
  );
}
