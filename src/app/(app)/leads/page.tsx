import { Handshake, Plus, ScanText, Search } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/display";
import { ListSkeleton } from "@/components/ui/skeletons";
import { Tabs } from "@/components/ui/tabs";
import { canAny } from "@/server/access/actor";
import { requireContext } from "@/server/auth/current";
import { companyToday } from "@/lib/time";
import { canSeeLeads } from "@/components/shell/nav";
import { listActiveBranches } from "@/modules/customers/queries";
import { defaultLeadView, leadViewsFor, listLeads, type LeadStageFilter, type LeadView } from "@/modules/leads/queries";
import { LeadList } from "@/modules/leads/ui/lead-list";

export const metadata: Metadata = { title: "Leads" };

const VIEW_LABEL: Record<LeadView, string> = {
  mine: "Mine",
  added: "Added by me",
  branch: "Branch",
  all: "All branches",
  needs_owner: "Needs owner",
  needs_branch: "Needs branch",
};

const STAGE_FILTERS: { key: LeadStageFilter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "new", label: "New" },
  { key: "quotation", label: "Quoted" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
];

export default function LeadsPage({ searchParams }: PageProps<"/leads">) {
  return (
    <Suspense fallback={<ListSkeleton title="Leads" />}>
      <Leads searchParams={searchParams} />
    </Suspense>
  );
}

async function Leads({ searchParams }: { searchParams: PageProps<"/leads">["searchParams"] }) {
  const ctx = await requireContext();
  if (!canSeeLeads(ctx.actor) && !ctx.actor.permissions.has("lead.capture")) notFound();
  const params = await searchParams;
  const views = leadViewsFor(ctx.actor);
  const requested = typeof params.view === "string" ? (params.view as LeadView) : undefined;
  const view: LeadView = requested && views.includes(requested) ? requested : defaultLeadView(ctx.actor);
  const stageParam = typeof params.stage === "string" ? params.stage : "open";
  const stage = (STAGE_FILTERS.some((s) => s.key === stageParam) ? stageParam : "open") as LeadStageFilter;
  const query = typeof params.q === "string" ? params.q : "";
  const branchParam = typeof params.branch === "string" ? params.branch : "";
  const branches = view === "all" ? await listActiveBranches(ctx) : [];
  const branchId = branches.some((b) => b.id === branchParam) ? branchParam : null;

  const leads = await listLeads(ctx, { view, stage, query, branchId });
  const today = companyToday(ctx.now);
  const href = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams();
    const merged = { view, stage, q: query, branch: branchId ?? "", ...changes };
    for (const [key, val] of Object.entries(merged)) if (val) next.set(key, val);
    return `/leads?${next.toString()}`;
  };

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Leads"
        description={
          view === "needs_owner"
            ? "New leads waiting for someone to own them"
            : view === "needs_branch"
              ? "Leads whose branch isn't known yet — decide where they go"
              : views.length === 1
                ? "Leads you passed to Marketing, and what happened to them"
                : "Sales opportunities, from first contact to won"
        }
        actions={
          canAny(ctx.actor, "lead.capture", "marketing.work") ? (
            <>
              <ButtonLink href="/leads/capture" variant="secondary">
                <ScanText aria-hidden />
                Capture lead
              </ButtonLink>
              <ButtonLink href="/leads/new" variant="primary">
                <Plus aria-hidden />
                Add lead
              </ButtonLink>
            </>
          ) : undefined
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        {views.length > 1 && (
          <Tabs label="Lead views" items={views.map((v) => ({ href: href({ view: v, branch: null }), label: VIEW_LABEL[v], active: v === view }))} />
        )}
      </div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Tabs label="Stage" items={STAGE_FILTERS.map((s) => ({ href: href({ stage: s.key }), label: s.label, active: s.key === stage }))} />
        <form action="/leads" className="relative min-w-48 flex-1">
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="stage" value={stage} />
          {branchId && <input type="hidden" name="branch" value={branchId} />}
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
          <label htmlFor="lead-search" className="sr-only">
            Search by company
          </label>
          <input
            id="lead-search"
            name="q"
            defaultValue={query}
            placeholder="Search by company"
            className="block h-9 w-full rounded-control border border-line-strong bg-surface pr-3 pl-9 text-sm placeholder:text-ink-subtle focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25 focus:outline-none"
          />
        </form>
      </div>
      {view === "all" && branches.length > 0 && (
        <div className="mb-6">
          <Tabs
            label="Branch"
            items={[
              { href: href({ branch: null }), label: "All", active: !branchId },
              ...branches.map((b) => ({ href: href({ branch: b.id }), label: b.name, active: b.id === branchId })),
            ]}
          />
        </div>
      )}

      {leads.length === 0 ? (
        <EmptyState
          icon={<Handshake />}
          title={query ? "No leads match that search" : view === "needs_owner" ? "Every lead has an owner" : view === "needs_branch" ? "Every lead has a branch" : "No leads here yet"}
          description={
            query
              ? undefined
              : view === "mine"
                ? "Leads assigned to you appear here, with their next follow-up."
                : view === "added"
                  ? "Met a company that needs calibration? Add a lead — the branch's marketing team takes it from there."
                  : undefined
          }
        />
      ) : (
        <LeadList leads={leads} today={today} showBranch={view === "all" || view === "needs_branch" || view === "added"} />
      )}
    </div>
  );
}
