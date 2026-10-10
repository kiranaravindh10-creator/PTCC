import { Plus, ScanText } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ButtonLink } from "@/components/ui/button";
import { Notice, Skeleton } from "@/components/ui/display";
import { Tabs } from "@/components/ui/tabs";
import { can, canAny, scopeOf } from "@/server/access/actor";
import { requireContext } from "@/server/auth/current";
import { firstName } from "@/lib/format";
import { companyToday, formatLongDate, greetingFor } from "@/lib/time";
import { listActiveBranches } from "@/modules/customers/queries";
import { buildBriefing } from "@/modules/home/briefing";
import {
  Alerts,
  BranchComparison,
  CollectionsFlow,
  LabStages,
  LeadsAwaitingOwner,
  MarketingSummary,
  NeedsAssignment,
  TeamToday,
  TodayBriefing,
  WorkToday,
} from "@/modules/home/ui/sections";
import { branchComparison, marketingMetrics, marketingPerformance, PERIOD_LABEL, PERIODS, type Period } from "@/modules/insights/queries";
import { countMyNewLeads, leadsAwaitingAssignment, listMarketers } from "@/modules/leads/queries";
import { companyWorkSnapshot, listAssignablePeople, listUnassigned, listWork, teamWorkload } from "@/modules/tasks/queries";

export const metadata: Metadata = { title: "Home" };

export default function HomePage({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <Home searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * Home is composed from the roles a person holds — docs/PRODUCT_ARCHITECTURE.md §4.
 * Every number here is computed live from the records people update while working.
 */
async function Home({ searchParams }: { searchParams: PageProps<"/">["searchParams"] }) {
  const ctx = await requireContext();
  const params = await searchParams;
  const today = companyToday(ctx.now);
  const actor = ctx.actor;
  const taskAssign = scopeOf(actor, "task.assign");
  const leadAssign = scopeOf(actor, "marketing.assign");
  const routesBranchLeads = leadAssign === "branch";

  const greeting = (
    <header className="mb-8">
      <h1 className="text-2xl font-semibold tracking-tight">
        {greetingFor(ctx.now)}, {firstName(actor.name)}
      </h1>
      <p className="mt-0.5 text-ink-muted">
        {formatLongDate(ctx.now)}
        {actor.branchName ? ` · ${actor.branchName} branch` : ""}
      </p>
      {/* Employees in the field: met a company that needs calibration? Capture it in seconds, or use the form. */}
      {actor.branchId && !can(actor, "overview.company") && canAny(actor, "lead.capture", "marketing.work") && (
        <div className="mt-4 flex flex-wrap gap-2">
          <ButtonLink href="/leads/capture" variant="secondary" className="max-sm:flex-1">
            <ScanText aria-hidden />
            Capture lead
          </ButtonLink>
          <ButtonLink href="/leads/new" variant="secondary" className="max-sm:flex-1">
            <Plus aria-hidden />
            Add lead
          </ButtonLink>
        </div>
      )}
      {params.welcome && (
        <div className="mt-4 max-w-xl">
          <Notice tone="success">Your password is set. Welcome to PTCC.</Notice>
        </div>
      )}
    </header>
  );

  const mine = await listWork(ctx, { scope: "mine", view: "open" });
  const briefing = buildBriefing(mine, today);
  const newLeads = actor.permissions.has("marketing.work") ? await countMyNewLeads(ctx) : null;

  // ─── CEO: the company (or one branch), then the team, then their own items ──
  if (can(actor, "overview.company")) {
    const branches = await listActiveBranches(ctx);
    const branchId = typeof params.branch === "string" && branches.some((b) => b.id === params.branch) ? params.branch : null;
    const branchName = branches.find((b) => b.id === branchId)?.name ?? null;
    const period: Period = PERIODS.includes(params.period as Period) ? (params.period as Period) : "today";
    const link = (changes: { branch?: string | null; period?: Period }) => {
      const next = new URLSearchParams();
      const branch = changes.branch === undefined ? branchId : changes.branch;
      const p = changes.period ?? period;
      if (branch) next.set("branch", branch);
      if (p !== "today") next.set("period", p);
      const qs = next.toString();
      return qs ? `/?${qs}` : "/";
    };
    const [snapshot, metrics, performance, comparison, awaiting, team] = await Promise.all([
      companyWorkSnapshot(ctx, { branchId }),
      marketingMetrics(ctx, { branchId, period }),
      marketingPerformance(ctx, { branchId, period }),
      branchId ? Promise.resolve(null) : branchComparison(ctx, { period }),
      leadsAwaitingAssignment(ctx, { branchId }),
      scopeOf(actor, "team.view") ? teamWorkload(ctx, { branchId }) : Promise.resolve(null),
    ]);
    return (
      <>
        {greeting}
        <div className="mb-8 overflow-x-auto">
          <Tabs
            label="Branch"
            items={[
              { href: link({ branch: null }), label: "All branches", active: !branchId },
              ...branches.map((b) => ({ href: link({ branch: b.id }), label: b.name, active: b.id === branchId })),
            ]}
          />
        </div>
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-6">
            <WorkToday snapshot={snapshot} scopeLabel={branchName ?? "PTCC"} />
            <Alerts needsBranch={branchId ? 0 : awaiting.needsBranch.length} needsOwner={awaiting.needsOwner.length} />
            <MarketingSummary
              metrics={metrics}
              performance={performance}
              periodTabs={
                <Tabs label="Period" items={PERIODS.map((p) => ({ href: link({ period: p }), label: PERIOD_LABEL[p], active: p === period }))} />
              }
            />
            <CollectionsFlow snapshot={snapshot} />
            <LabStages />
            {comparison && <BranchComparison rows={comparison} periodLabel={PERIOD_LABEL[period]} />}
            {briefing.nextUp && (
              <section className="space-y-4 pt-4">
                <h2 className="text-lg font-semibold">Your work</h2>
                <TodayBriefing briefing={briefing} today={today} />
              </section>
            )}
          </div>
          {team && <TeamToday team={team} showBranch={!branchId} />}
        </div>
      </>
    );
  }

  // ─── Branch coordinators and marketing managers ─────────────────────────
  const assignsWork = taskAssign === "branch" || taskAssign === "all";
  if (assignsWork || routesBranchLeads) {
    const [unassigned, people, team, awaiting, marketers] = await Promise.all([
      assignsWork ? listUnassigned(ctx) : Promise.resolve(null),
      assignsWork ? listAssignablePeople(ctx) : Promise.resolve(null),
      scopeOf(actor, "team.view") ? teamWorkload(ctx) : Promise.resolve(null),
      leadsAwaitingAssignment(ctx),
      routesBranchLeads && actor.branchId ? listMarketers(ctx, actor.branchId) : Promise.resolve(null),
    ]);
    const branchMetrics = !assignsWork && routesBranchLeads ? await marketingMetrics(ctx, { period: "7d" }) : null;
    const branchPeople = branchMetrics ? await marketingPerformance(ctx, { period: "7d" }) : null;
    return (
      <>
        {greeting}
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="space-y-10">
            {unassigned && people && <NeedsAssignment tasks={unassigned} people={people} today={today} />}
            <LeadsAwaitingOwner leads={awaiting.needsOwner} marketers={marketers} />
            <section className="space-y-4">
              <h2 className="text-lg font-semibold">Your work</h2>
              <TodayBriefing briefing={briefing} today={today} newLeads={newLeads} />
            </section>
            {branchMetrics && branchPeople && (
              <MarketingSummary
                metrics={branchMetrics}
                performance={branchPeople}
                periodTabs={<span className="text-sm text-ink-muted">{actor.branchName} · {PERIOD_LABEL["7d"].toLowerCase()}</span>}
              />
            )}
          </div>
          {team && <TeamToday team={team} />}
        </div>
      </>
    );
  }

  // ─── Everyone else: their day (Admin also sees leads waiting to be routed) ──
  const routing = can(actor, "lead.route") ? await leadsAwaitingAssignment(ctx) : null;
  return (
    <div className="max-w-3xl">
      {greeting}
      {routing && (
        <div className="mb-8">
          <Alerts needsBranch={routing.needsBranch.length} needsOwner={routing.needsOwner.length} />
        </div>
      )}
      <TodayBriefing briefing={briefing} today={today} newLeads={newLeads} />
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="max-w-3xl space-y-8" aria-busy="true" aria-label="Loading your day">
      <div className="space-y-2">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-5 w-40" />
      </div>
      <div className="flex gap-12">
        <Skeleton className="h-16 w-24" />
        <Skeleton className="h-16 w-24" />
        <Skeleton className="h-16 w-24" />
      </div>
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
