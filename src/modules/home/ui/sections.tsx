import { ArrowRight, ChevronRight, Inbox, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Avatar, EmptyState, List, MoreDetails, Panel, Section, Stat, StatRow } from "@/components/ui/display";
import { cn, firstName, plural } from "@/lib/format";
import { formatInr, formatInrShort } from "@/lib/money";
import { formatDue, type IsoDate } from "@/lib/time";
import type { BranchComparisonRow, MarketingMetrics, PersonPerformance } from "@/modules/insights/queries";
import { leadRef } from "@/modules/leads/model";
import type { LeadListItem } from "@/modules/leads/queries";
import { AssignLeadForm } from "@/modules/leads/ui/lead-actions";
import { KIND_LABEL_PLURAL, type TaskKind } from "@/modules/tasks/model";
import type { CompanyWorkSnapshot, PersonOption, TaskListItem, TeamMemberLoad } from "@/modules/tasks/queries";
import { KindIcon, PriorityTag } from "@/modules/tasks/ui/badges";
import { AssignForm } from "@/modules/tasks/ui/task-actions";
import { WorkList } from "@/modules/tasks/ui/work-list";
import type { Briefing } from "../briefing";
import { NextUpPanel } from "./next-up";

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function kindLabel(kind: TaskKind, count: number) {
  const [singular, pluralForm] = KIND_LABEL_PLURAL[kind];
  return capitalise(count === 1 ? singular : pluralForm);
}

/**
 * An employee's day: counts, the next thing to do, and the rest of today.
 * Marketers also see how many new leads are waiting for their first contact.
 */
export function TodayBriefing({
  briefing,
  today,
  newLeads = null,
}: {
  briefing: Briefing<TaskListItem>;
  today: IsoDate;
  /** Leads I own that nobody has contacted yet (marketing). */
  newLeads?: number | null;
}) {
  const hasToday = briefing.nextUp !== null;
  const later = briefing.upcomingCount + briefing.unscheduledCount;
  const showNewLeads = newLeads !== null && newLeads > 0;
  const kinds = briefing.countsByKind.slice(0, showNewLeads ? 2 : 3);

  return (
    <div className="space-y-8">
      <section aria-labelledby="today-heading" className="space-y-4">
        <h2 id="today-heading" className="text-sm font-medium text-ink-muted">
          Today&apos;s work
        </h2>
        {hasToday || showNewLeads ? (
          <StatRow>
            {kinds.map(({ kind, count }) => (
              <Stat key={kind} value={count} label={kindLabel(kind, count)} />
            ))}
            {showNewLeads && (
              <Link href="/leads?view=mine&stage=new" className="rounded-control hover:text-brand-700">
                <Stat value={newLeads} label={newLeads === 1 ? "New lead" : "New leads"} />
              </Link>
            )}
            {briefing.overdue.length > 0 && <Stat value={briefing.overdue.length} label="Overdue" tone="danger" />}
          </StatRow>
        ) : (
          <EmptyState
            icon={<Inbox />}
            title="Nothing due today"
            description={
              later > 0
                ? `You have ${plural(later, "item")} coming up. New work assigned to you will appear here.`
                : "New work assigned to you will appear here."
            }
            action={
              later > 0 ? (
                <Link href="/work" className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">
                  Open My Work <ArrowRight className="size-4" aria-hidden />
                </Link>
              ) : undefined
            }
          />
        )}
      </section>

      {briefing.nextUp && <NextUpPanel task={briefing.nextUp} today={today} />}

      {briefing.rest.length > 0 && (
        <Section
          title="Also today"
          action={
            <Link href="/work" className="font-medium text-brand-600 hover:text-brand-700">
              All my work
            </Link>
          }
        >
          <WorkList tasks={briefing.rest} today={today} hideToday />
        </Section>
      )}

      {hasToday && later > 0 && (
        <p className="text-sm text-ink-muted">
          {briefing.upcomingCount > 0 && `${plural(briefing.upcomingCount, "item")} coming up`}
          {briefing.upcomingCount > 0 && briefing.unscheduledCount > 0 && " · "}
          {briefing.unscheduledCount > 0 && `${briefing.unscheduledCount} with no date`}
          {" · "}
          <Link href="/work" className="font-medium text-brand-600 hover:text-brand-700">
            See My Work
          </Link>
        </p>
      )}
    </div>
  );
}

/** Coordinators: work nobody owns yet, assignable right here. */
export function NeedsAssignment({ tasks, people, today }: { tasks: TaskListItem[]; people: PersonOption[]; today: IsoDate }) {
  return (
    <Section title="Needs assignment" description={tasks.length > 0 ? `${plural(tasks.length, "item")} waiting for someone` : undefined}>
      {tasks.length === 0 ? (
        <p className="rounded-panel border border-line bg-surface px-4 py-3 text-sm text-ink-muted">Everything is assigned.</p>
      ) : (
        <List>
          {tasks.slice(0, 8).map((task) => (
            <li key={task.id} className="space-y-3 px-4 py-3">
              <Link href={`/work/${task.id}`} className="flex gap-3 rounded-control hover:text-brand-700">
                <KindIcon kind={task.kind} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate font-medium">{task.companyName ?? task.title}</span>
                    <span className="tabular shrink-0 text-sm text-ink-muted">{formatDue(task.dueDate, task.dueTime, today)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm text-ink-muted">
                      {[task.companyName ? task.title : null, task.locationArea].filter(Boolean).join(" · ")}
                    </span>
                    <PriorityTag priority={task.priority} />
                  </div>
                </div>
              </Link>
              <div className="sm:pl-12">
                <AssignForm taskId={task.id} people={people} currentAssigneeId={null} compact />
              </div>
            </li>
          ))}
        </List>
      )}
    </Section>
  );
}

/** Branch lead managers: new leads waiting for an owner, assignable right here. */
export function LeadsAwaitingOwner({
  leads,
  marketers,
}: {
  leads: LeadListItem[];
  /** Marketers of the manager's branch; null = assign from the lead page (company-wide). */
  marketers: { id: string; name: string }[] | null;
}) {
  if (leads.length === 0) return null;
  return (
    <Section
      title="Leads waiting for an owner"
      description={`${plural(leads.length, "lead")} to assign`}
      action={
        <Link href="/leads?view=needs_owner" className="font-medium text-brand-600 hover:text-brand-700">
          All
        </Link>
      }
    >
      <List>
        {leads.slice(0, 6).map((lead) => (
          <li key={lead.id} className="space-y-3 px-4 py-3">
            <Link href={`/leads/${lead.id}`} className="block rounded-control hover:text-brand-700">
              <span className="block truncate font-medium">{lead.companyName}</span>
              <span className="block truncate text-sm text-ink-muted">
                {lead.requirement} · added by {firstName(lead.capturedByName)} · {leadRef(lead.number)}
              </span>
            </Link>
            {marketers && marketers.length > 0 && <AssignLeadForm leadId={lead.id} marketers={marketers} ownerId={null} />}
          </li>
        ))}
      </List>
    </Section>
  );
}

/** Open work per person — who is loaded, who is free. */
export function TeamToday({ team, showBranch = false }: { team: TeamMemberLoad[]; showBranch?: boolean }) {
  return (
    <Section title="Team today" description="Open work per person">
      {team.length === 0 ? (
        <p className="rounded-panel border border-line bg-surface px-4 py-3 text-sm text-ink-muted">No one assigned to this branch yet.</p>
      ) : (
        <List>
          {team.map((member) => (
            <li key={member.id} className="flex items-center gap-3 px-4 py-3">
              <Avatar name={member.name} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{member.name}</p>
                <p className="truncate text-xs text-ink-muted">
                  {showBranch && member.branchName ? `${member.branchName} · ` : ""}
                  {member.roleNames.join(", ")}
                </p>
              </div>
              <div className="text-right">
                <p className="tabular text-sm font-medium">{member.open} open</p>
                <p className="tabular text-xs text-ink-muted">
                  {member.dueToday} today
                  {member.overdue > 0 && <span className="text-danger-700"> · {member.overdue} overdue</span>}
                </p>
              </div>
            </li>
          ))}
        </List>
      )}
    </Section>
  );
}

// ─── CEO overview ──────────────────────────────────────────────────────────

/** Today's work across the company (or one branch). */
export function WorkToday({ snapshot, scopeLabel }: { snapshot: CompanyWorkSnapshot; scopeLabel: string }) {
  return (
    <section aria-labelledby="ptcc-today" className="space-y-4">
      <h2 id="ptcc-today" className="text-sm font-medium text-ink-muted">
        {scopeLabel} today
      </h2>
      <StatRow>
        <Stat value={snapshot.dueToday} label="Due today" />
        <Stat value={snapshot.overdue} label="Overdue" tone={snapshot.overdue > 0 ? "danger" : "default"} />
        <Stat value={snapshot.unassigned} label="Unassigned" tone={snapshot.unassigned > 0 ? "warning" : "default"} />
        <Stat value={snapshot.completedToday} label="Completed today" />
      </StatRow>
    </section>
  );
}

export function Alerts({ needsBranch, needsOwner }: { needsBranch: number; needsOwner: number }) {
  if (needsBranch === 0 && needsOwner === 0) return null;
  return (
    <div className="space-y-2">
      {needsBranch > 0 && (
        <Link
          href="/leads?view=needs_branch"
          className="flex items-center gap-2 rounded-panel border border-warning-700/25 bg-warning-50 px-4 py-3 text-sm text-warning-700 hover:border-warning-700/50"
        >
          <TriangleAlert className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">
            <span className="font-medium">{plural(needsBranch, "lead")}</span> {needsBranch === 1 ? "needs" : "need"} a branch decided
          </span>
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      )}
      {needsOwner > 0 && (
        <Link
          href="/leads?view=needs_owner"
          className="flex items-center gap-2 rounded-panel border border-line bg-surface px-4 py-3 text-sm hover:border-line-strong"
        >
          <span className="flex-1">
            <span className="font-medium">{plural(needsOwner, "lead")}</span> waiting for an owner at a branch
          </span>
          <ChevronRight className="size-4 text-ink-subtle" aria-hidden />
        </Link>
      )}
    </div>
  );
}

/** Marketing numbers with progressive disclosure: four headline figures, the rest on request. */
export function MarketingSummary({
  metrics,
  performance,
  periodTabs,
}: {
  metrics: MarketingMetrics;
  performance: PersonPerformance[];
  periodTabs: React.ReactNode;
}) {
  return (
    <Panel className="p-4 lg:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Marketing</h2>
        {periodTabs}
      </div>
      <StatRow>
        <Stat value={metrics.callsMade} label={`Calls · ${metrics.callsConnected} connected`} />
        <Stat value={metrics.newLeads} label="New leads" />
        <Stat value={metrics.quotations} label="Quotations" />
        <Stat value={metrics.won} label={metrics.businessValuePaise ? `Won · ${formatInrShort(metrics.businessValuePaise)}` : "Won"} />
      </StatRow>
      <div className="mt-5 border-t border-line pt-4">
        <MoreDetails summary="More marketing numbers">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-ink-muted">Follow-ups done</dt>
              <dd className="tabular font-medium">{metrics.followUpsDone}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Follow-ups overdue</dt>
              <dd className={cn("tabular font-medium", metrics.followUpsOverdue > 0 && "text-danger-700")}>{metrics.followUpsOverdue}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Lost</dt>
              <dd className="tabular font-medium">{metrics.lost}</dd>
            </div>
            <div>
              <dt className="text-ink-muted">Win rate</dt>
              <dd className="tabular font-medium">{metrics.winRate === null ? "—" : `${Math.round(metrics.winRate * 100)}%`}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-ink-muted">Business won</dt>
              <dd className="tabular font-medium">{formatInr(metrics.businessValuePaise)}</dd>
            </div>
          </dl>
          {performance.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-136 text-left text-sm">
                <caption className="pb-2 text-left text-sm font-medium">By person</caption>
                <thead className="border-b border-line text-xs text-ink-muted">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Person</th>
                    <th className="px-2 py-2 text-right font-medium">Calls</th>
                    <th className="px-2 py-2 text-right font-medium">Connected</th>
                    <th className="px-2 py-2 text-right font-medium">New leads</th>
                    <th className="px-2 py-2 text-right font-medium">Follow-ups</th>
                    <th className="px-2 py-2 text-right font-medium">Quotes</th>
                    <th className="py-2 pl-2 text-right font-medium">Won</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {performance.map((person) => (
                    <tr key={person.id}>
                      <td className="py-2 pr-3">
                        {person.name}
                        {person.branchName && <span className="block text-xs text-ink-subtle">{person.branchName}</span>}
                      </td>
                      <td className="tabular px-2 py-2 text-right">{person.calls}</td>
                      <td className="tabular px-2 py-2 text-right">{person.connected}</td>
                      <td className="tabular px-2 py-2 text-right">{person.newLeads}</td>
                      <td className="tabular px-2 py-2 text-right">{person.followUpsDone}</td>
                      <td className="tabular px-2 py-2 text-right">{person.quotations}</td>
                      <td className="tabular py-2 pl-2 text-right">
                        {person.won}
                        {person.valuePaise > 0 && <span className="block text-xs text-ink-subtle">{formatInrShort(person.valuePaise)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </MoreDetails>
      </div>
    </Panel>
  );
}

/** Collections as a flow; "delayed" = open pickups/deliveries past their date. */
export function CollectionsFlow({ snapshot }: { snapshot: CompanyWorkSnapshot }) {
  const flow = [
    { label: "Pending", value: snapshot.field.pending },
    { label: "Assigned", value: snapshot.field.assigned },
    { label: "In progress", value: snapshot.field.in_progress },
    { label: "Collected", value: snapshot.field.collected },
    { label: "Delivered", value: snapshot.field.delivered },
  ];
  return (
    <Panel className="p-4 lg:p-5">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Collections</h2>
        <p className="text-sm">
          {snapshot.field.delayed > 0 && <span className="font-medium text-danger-700">{snapshot.field.delayed} delayed · </span>}
          <Link href="/collections" className="font-medium text-brand-600 hover:text-brand-700">
            {snapshot.field.completedToday} completed today
          </Link>
        </p>
      </div>
      <FlowStrip steps={flow} />
    </Panel>
  );
}

function FlowStrip({ steps }: { steps: { label: string; value: number | string }[] }) {
  return (
    <ol className="grid" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map((step, index) => (
        <li key={step.label} className={cn("relative pr-2", index > 0 && "pl-3 sm:pl-5")}>
          {index > 0 && <ChevronRight className="absolute top-2.5 -left-2 size-4 text-line-strong sm:top-3" aria-hidden />}
          <div className="tabular text-2xl font-semibold sm:text-display">{step.value}</div>
          <div className="text-xs text-ink-muted sm:text-sm">{step.label}</div>
        </li>
      ))}
    </ol>
  );
}

/** PTCC's confirmed lab workflow. Numbers arrive with lab tracking (Phase 5) — none are shown until then. */
export function LabStages() {
  const stages = ["Received", "Calibration / testing", "Certificate", "Dispatch", "Completed"];
  return (
    <Panel className="p-4 lg:p-5">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">Lab</h2>
        <p className="text-sm text-ink-muted">Tracking arrives in Phase 5</p>
      </div>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-ink-muted">
        {stages.map((stage, index) => (
          <li key={stage} className="flex items-center gap-1.5">
            {index > 0 && <ChevronRight className="size-3.5 text-line-strong" aria-hidden />}
            <span className="rounded-full border border-line px-2.5 py-0.5">{stage}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/** All branches side by side (CEO, "All branches" view), behind disclosure. */
export function BranchComparison({ rows, periodLabel }: { rows: BranchComparisonRow[]; periodLabel: string }) {
  return (
    <MoreDetails summary="Compare branches">
      <div className="overflow-x-auto rounded-panel border border-line bg-surface">
        <table className="w-full min-w-xl text-left text-sm">
          <caption className="px-4 pt-3 text-left text-xs text-ink-muted">Marketing: {periodLabel.toLowerCase()} · Collections: now</caption>
          <thead className="border-b border-line text-xs text-ink-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Branch</th>
              <th className="px-2 py-2 text-right font-medium">New leads</th>
              <th className="px-2 py-2 text-right font-medium">Calls</th>
              <th className="px-2 py-2 text-right font-medium">Won</th>
              <th className="px-2 py-2 text-right font-medium">Value</th>
              <th className="px-2 py-2 text-right font-medium">Open pickups &amp; deliveries</th>
              <th className="px-4 py-2 text-right font-medium">Delayed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => (
              <tr key={row.branchId}>
                <td className="px-4 py-2 font-medium">
                  <Link href={`/?branch=${row.branchId}`} className="hover:text-brand-700">
                    {row.branchName}
                  </Link>
                </td>
                <td className="tabular px-2 py-2 text-right">{row.newLeads}</td>
                <td className="tabular px-2 py-2 text-right">{row.calls}</td>
                <td className="tabular px-2 py-2 text-right">{row.won}</td>
                <td className="tabular px-2 py-2 text-right">{row.valuePaise ? formatInrShort(row.valuePaise) : "—"}</td>
                <td className="tabular px-2 py-2 text-right">{row.openPickupsAndDeliveries}</td>
                <td className={cn("tabular px-4 py-2 text-right", row.delayed > 0 && "font-medium text-danger-700")}>{row.delayed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </MoreDetails>
  );
}

