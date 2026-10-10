import { ArrowRight, CalendarPlus, MessageCircle, NotebookPen, Phone } from "lucide-react";
import { ButtonLink, ExternalButton } from "@/components/ui/button";
import { Panel } from "@/components/ui/display";
import { cn } from "@/lib/format";
import { mapsDirectionsHref, telHref, whatsappHref } from "@/lib/links";
import { formatPhone } from "@/lib/phone";
import { dueGroup, formatDue, type IsoDate } from "@/lib/time";
import { BranchTag } from "@/modules/leads/ui/badges";
import { isFieldKind, KIND_LABEL } from "@/modules/tasks/model";
import type { TaskListItem } from "@/modules/tasks/queries";
import { KindIcon, PriorityTag, StatusPill } from "@/modules/tasks/ui/badges";
import { StartRouteButton } from "@/modules/tasks/ui/task-actions";

/**
 * The single most important thing to do next, with its actions one tap away.
 * Collection: Start route · Call · View.
 * Marketing (a lead's follow-up): Call · WhatsApp · Add note · Schedule.
 */
export function NextUpPanel({ task, today }: { task: TaskListItem; today: IsoDate }) {
  const overdue = dueGroup(task.dueDate, today) === "overdue";
  const route = isFieldKind(task.kind)
    ? mapsDirectionsHref({ latitude: task.latitude, longitude: task.longitude, address: task.locationAddress })
    : null;
  const phone = task.contactPhone;
  const whatsapp = phone ? whatsappHref(phone) : null;
  const phoneIsPrimary = !route && (task.kind === "call" || task.kind === "follow_up") && Boolean(phone);
  const leadHref = task.leadId ? `/leads/${task.leadId}` : null;
  const isFollowUp = task.kind === "follow_up" || task.kind === "call";

  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-canvas/60 px-4 py-2.5 text-sm lg:px-5">
        <span className="font-medium text-ink-muted">{leadHref && isFollowUp ? "Next follow-up" : "Next up"}</span>
        <span className={cn("tabular font-medium", overdue ? "text-danger-700" : "text-ink")}>
          {overdue && "Overdue · "}
          {formatDue(task.dueDate, task.dueTime, today)}
        </span>
      </div>

      <div className="space-y-4 px-4 py-4 lg:px-5 lg:py-5">
        <div className="flex gap-3">
          <KindIcon kind={task.kind} className="mt-0.5" />
          <div className="min-w-0">
            <p className="text-lg font-semibold text-ink">{task.companyName ?? task.title}</p>
            <p className="text-ink-muted">
              {leadHref ? "" : `${KIND_LABEL[task.kind]}${task.companyName ? " · " : ""}`}
              {task.companyName ? task.title : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {task.status !== "assigned" && <StatusPill status={task.status} />}
              <PriorityTag priority={task.priority} />
              {leadHref && <BranchTag name={`${task.branchName} branch`} />}
            </div>
          </div>
        </div>

        {(task.contactName || phone || task.locationAddress || task.locationArea) && (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 sm:pl-12">
            {(task.contactName || phone) && (
              <div>
                <dt className="text-ink-muted">Who</dt>
                <dd className="text-ink">{[task.contactName, phone ? formatPhone(phone) : null].filter(Boolean).join(" · ")}</dd>
              </div>
            )}
            {(task.locationAddress || task.locationArea) && !leadHref && (
              <div>
                <dt className="text-ink-muted">Where</dt>
                <dd className="text-ink">{task.locationAddress ?? task.locationArea}</dd>
              </div>
            )}
          </dl>
        )}

        <div className="flex flex-wrap gap-2 sm:pl-12">
          {route && <StartRouteButton href={route} taskId={task.id} startOnOpen={task.status === "assigned"} className="max-sm:w-full" />}
          {phone && (
            <ExternalButton href={telHref(phone)} variant={phoneIsPrimary ? "primary" : "secondary"} className="max-sm:flex-1">
              <Phone aria-hidden />
              Call
            </ExternalButton>
          )}
          {whatsapp && (
            <ExternalButton href={whatsapp} target="_blank" rel="noopener noreferrer" variant="secondary" className="max-sm:flex-1">
              <MessageCircle aria-hidden />
              WhatsApp
            </ExternalButton>
          )}
          {leadHref ? (
            <>
              <ButtonLink href={`${leadHref}?action=note`} variant="secondary" className="max-sm:flex-1">
                <NotebookPen aria-hidden />
                Add note
              </ButtonLink>
              <ButtonLink href={`${leadHref}?action=schedule`} variant="secondary" className="max-sm:flex-1">
                <CalendarPlus aria-hidden />
                Schedule
              </ButtonLink>
              <ButtonLink href={leadHref} variant="ghost" className="max-sm:flex-1">
                View lead
                <ArrowRight aria-hidden />
              </ButtonLink>
            </>
          ) : (
            <ButtonLink href={`/work/${task.id}`} variant={!route && !phoneIsPrimary ? "primary" : "ghost"} className="max-sm:flex-1">
              View
              <ArrowRight aria-hidden />
            </ButtonLink>
          )}
        </div>
      </div>
    </Panel>
  );
}
