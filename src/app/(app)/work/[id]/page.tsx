import { ArrowLeft, MessageCircle, Navigation, Phone } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ExternalButton } from "@/components/ui/button";
import { Fact, Facts, Notice, Panel, Section } from "@/components/ui/display";
import { DetailSkeleton } from "@/components/ui/skeletons";
import { canSeeLeads } from "@/components/shell/nav";
import { canAny, scopeOf } from "@/server/access/actor";
import { requireContext } from "@/server/auth/current";
import { taskRef } from "@/lib/format";
import { mapsDirectionsHref, telHref, whatsappHref } from "@/lib/links";
import { formatPhone } from "@/lib/phone";
import { companyToday, dueGroup, formatDue, formatTimestamp } from "@/lib/time";
import { isFieldKind, KIND_LABEL, OPEN_FOR_ASSIGNEE_STATUSES } from "@/modules/tasks/model";
import { getTask, listAssignablePeople, listTaskEvents } from "@/modules/tasks/queries";
import { PriorityTag, StatusPill } from "@/modules/tasks/ui/badges";
import { CommentForm } from "@/modules/tasks/ui/comment-form";
import { AssignForm, CancelTask, StartRouteButton, TransitionButtons } from "@/modules/tasks/ui/task-actions";
import { TaskTimeline } from "@/modules/tasks/ui/timeline";
import { availableActions, canAssign } from "@/modules/tasks/workflow";

export const metadata: Metadata = { title: "Work" };

export default function TaskPage({ params, searchParams }: PageProps<"/work/[id]">) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <TaskDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function TaskDetail({
  params,
  searchParams,
}: {
  params: PageProps<"/work/[id]">["params"];
  searchParams: PageProps<"/work/[id]">["searchParams"];
}) {
  const ctx = await requireContext();
  const { id } = await params;
  const { created } = await searchParams;

  // Scoped fetch: work outside your scope is indistinguishable from work that doesn't exist.
  const task = await getTask(ctx, id);
  if (!task) notFound();

  const assignable = canAssign(task, ctx.actor);
  const [events, people] = await Promise.all([
    listTaskEvents(ctx, id),
    assignable ? listAssignablePeople(ctx) : Promise.resolve(null),
  ]);

  const today = companyToday(ctx.now);
  const actions = availableActions(task, ctx.actor);
  const canCancel = actions.some((a) => a.action === "cancel");
  const isOpenForAssignee = OPEN_FOR_ASSIGNEE_STATUSES.includes(task.status);
  const route = mapsDirectionsHref({ latitude: task.latitude, longitude: task.longitude, address: task.locationAddress });
  const showRoute = Boolean(route) && isFieldKind(task.kind) && isOpenForAssignee && task.assigneeId === ctx.actor.id;
  const whatsapp = task.contactPhone ? whatsappHref(task.contactPhone) : null;
  const overdue = isOpenForAssignee && dueGroup(task.dueDate, today) === "overdue";

  return (
    <div className="max-w-3xl space-y-8">
      <Link href="/work" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        My Work
      </Link>

      {created && (
        <Notice tone="success" title="Work created">
          {task.assigneeId && task.assigneeId !== ctx.actor.id
            ? `${task.assigneeName} has been notified.`
            : task.assigneeId
              ? "It's on your list."
              : "It's waiting to be assigned."}
        </Notice>
      )}

      <header className="space-y-3">
        <p className="text-sm text-ink-muted">
          {KIND_LABEL[task.kind]} <span className="font-mono text-xs">{taskRef(task.number)}</span>
        </p>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{task.title}</h1>
          {(task.companyName || task.locationArea) && (
            <p className="mt-1 text-ink-muted">{[task.companyName, task.locationArea].filter(Boolean).join(" · ")}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <StatusPill status={task.status} />
          <PriorityTag priority={task.priority} />
        </div>
      </header>

      {(showRoute || actions.some((a) => a.action !== "cancel") || task.contactPhone) && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {showRoute && route && (
              <StartRouteButton href={route} taskId={task.id} startOnOpen={task.status === "assigned"} className="max-sm:w-full" />
            )}
            {task.contactPhone && (
              <ExternalButton href={telHref(task.contactPhone)} className="max-sm:flex-1">
                <Phone aria-hidden />
                Call
              </ExternalButton>
            )}
            {whatsapp && (
              <ExternalButton href={whatsapp} target="_blank" rel="noopener noreferrer" className="max-sm:flex-1">
                <MessageCircle aria-hidden />
                WhatsApp
              </ExternalButton>
            )}
          </div>
          <TransitionButtons
            taskId={task.id}
            actions={actions
              .filter((a) => !(showRoute && a.action === "start")) // Start route also starts the work
              .map(({ action, label }) => ({ action, label }))}
            primaryTaken={showRoute}
          />
        </div>
      )}

      <Panel>
        <Facts>
          {task.details && (
            <Fact label="What">
              <p className="whitespace-pre-line">{task.details}</p>
            </Fact>
          )}
          {task.companyName && (
            <Fact label="Customer">
              {task.companyId && canAny(ctx.actor, "customer.read", "customer.read.all") ? (
                <Link href={`/customers/${task.companyId}`} className="text-brand-600 hover:text-brand-700">
                  {task.companyName}
                </Link>
              ) : (
                task.companyName
              )}
            </Fact>
          )}
          {task.leadId && canSeeLeads(ctx.actor) && (
            <Fact label="Lead">
              <Link href={`/leads/${task.leadId}`} className="text-brand-600 hover:text-brand-700">
                View the lead
              </Link>
            </Fact>
          )}
          {(scopeOf(ctx.actor, "task.read") === "all" || task.branchId !== ctx.actor.branchId) && (
            <Fact label="Branch">{task.branchName}</Fact>
          )}
          {(task.contactName || task.contactPhone) && (
            <Fact label="Contact">
              {task.contactName}
              {task.contactName && task.contactPhone && " · "}
              {task.contactPhone && (
                <a href={telHref(task.contactPhone)} className="tabular text-brand-600 hover:text-brand-700">
                  {formatPhone(task.contactPhone)}
                </a>
              )}
            </Fact>
          )}
          {(task.locationAddress || task.locationArea) && (
            <Fact label="Where">
              <span>{task.locationAddress ?? task.locationArea}</span>
              {route && (
                <a
                  href={route}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 flex w-fit items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700"
                >
                  <Navigation className="size-4" aria-hidden />
                  Open in Google Maps
                </a>
              )}
            </Fact>
          )}
          <Fact label="When">
            <span className={overdue ? "font-medium text-danger-700" : undefined}>
              {overdue && "Overdue · "}
              {formatDue(task.dueDate, task.dueTime, today)}
            </span>
          </Fact>
          <Fact label="Assigned to">
            {task.assigneeName ?? <span className="text-warning-700">Not assigned yet</span>}
            {task.assignedByName && task.assignedAt && task.assigneeName && (
              <span className="block text-sm text-ink-muted">
                by {task.assignedByName}, {formatTimestamp(task.assignedAt, ctx.now)}
              </span>
            )}
            {assignable && people && (
              <div className="mt-3 max-w-md">
                <AssignForm taskId={task.id} people={people} currentAssigneeId={task.assigneeId} compact />
              </div>
            )}
          </Fact>
          <Fact label="Created">
            {task.createdByName}, {formatTimestamp(task.createdAt, ctx.now)}
          </Fact>
          {task.cancelReason && <Fact label="Cancelled because">{task.cancelReason}</Fact>}
        </Facts>
      </Panel>

      <Section title="History and notes">
        <TaskTimeline events={events} now={ctx.now} />
        <div className="pt-2">
          <CommentForm taskId={task.id} />
        </div>
      </Section>

      {canCancel && (
        <div className="border-t border-line pt-6">
          <CancelTask taskId={task.id} />
        </div>
      )}
    </div>
  );
}
