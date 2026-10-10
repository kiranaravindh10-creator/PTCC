import { ChevronRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ButtonLink } from "@/components/ui/button";
import { List, Notice, PageHeader } from "@/components/ui/display";
import { ListSkeleton } from "@/components/ui/skeletons";
import { can } from "@/server/access/actor";
import { requireContext } from "@/server/auth/current";
import { plural } from "@/lib/format";
import { listBranches } from "@/modules/branches/service";
import { AdminTabs } from "@/modules/users/ui/admin-tabs";

export const metadata: Metadata = { title: "Branches" };

export default function BranchesPage({ searchParams }: PageProps<"/admin/branches">) {
  return (
    <Suspense fallback={<ListSkeleton title="Branches" />}>
      <Branches searchParams={searchParams} />
    </Suspense>
  );
}

async function Branches({ searchParams }: { searchParams: PageProps<"/admin/branches">["searchParams"] }) {
  const ctx = await requireContext();
  if (!can(ctx.actor, "branch.manage")) notFound();
  const [branches, { created }] = await Promise.all([listBranches(ctx), searchParams]);
  const active = branches.filter((branch) => branch.status === "active").length;

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="People & access"
        description={`${active} active ${active === 1 ? "branch" : "branches"} on one PTCC platform`}
        actions={
          <ButtonLink href="/admin/branches/new" variant="primary">
            <Plus aria-hidden />
            Add branch
          </ButtonLink>
        }
      />
      <AdminTabs actor={ctx.actor} active="branches" />
      {created === "1" && (
        <div className="mb-4">
          <Notice tone="success">Branch added. Assign people to it from People.</Notice>
        </div>
      )}
      <List>
        {branches.map((branch) => (
          <li key={branch.id}>
            <Link href={`/admin/branches/${branch.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-subtle/60">
              <div className="min-w-0 flex-1 sm:grid sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {branch.name}
                    {branch.status === "inactive" && (
                      <span className="ml-2 rounded-full bg-subtle px-2 py-0.5 text-xs font-medium text-ink-subtle">Inactive</span>
                    )}
                  </p>
                  <p className="truncate text-sm text-ink-muted">
                    {[branch.city, branch.state].filter(Boolean).join(", ") || "Location not recorded"}
                  </p>
                </div>
                <p className="truncate text-sm">
                  {branch.verification === "verified" ? (
                    <span className="text-ink-muted">Details confirmed</span>
                  ) : (
                    <span className="font-medium text-warning-700">Needs verification</span>
                  )}
                </p>
                <div className="min-w-0 text-sm">
                  {branch.certificates.length > 0 ? (
                    <p className="truncate text-ink-muted">NABL {branch.certificates.join(", ")}</p>
                  ) : (
                    <p className="truncate font-medium text-warning-700">Accreditation not verified</p>
                  )}
                  <p className="truncate text-xs text-ink-subtle">{plural(branch.activePeople, "active person", "active people")}</p>
                </div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-ink-subtle" aria-hidden />
            </Link>
          </li>
        ))}
      </List>
      <p className="mt-6 text-sm text-ink-muted">
        Branches with a NABL certificate are created from PTCC&apos;s scope documents. A branch added here has no
        accredited scope until its certificate is imported — services there show &ldquo;Scope not confirmed&rdquo;.
      </p>
    </div>
  );
}
