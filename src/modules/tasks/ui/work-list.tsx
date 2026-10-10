import { Navigation, Phone } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { List } from "@/components/ui/display";
import { cn, firstName } from "@/lib/format";
import { mapsDirectionsHref, telHref } from "@/lib/links";
import { dueGroup, formatDue, type DueGroup, type IsoDate } from "@/lib/time";
import { isFieldKind, KIND_LABEL, OPEN_FOR_ASSIGNEE_STATUSES } from "../model";
import type { TaskListItem } from "../queries";
import { BranchTag } from "@/modules/leads/ui/badges";
import { KindIcon, PriorityTag, StatusPill } from "./badges";

/**
 * The work row — docs/DESIGN_SYSTEM.md §7.
 *   [icon]  Who (or what)                                  When
 *           Kind · what · where              [tags]       [quick action]
 */
export function WorkRow({
  task,
  today,
  showAssignee = false,
  showBranch = false,
  hideDay = false,
}: {
  task: TaskListItem;
  today: IsoDate;
  showAssignee?: boolean;
  /** For company-wide viewers, whose lists mix branches. */
  showBranch?: boolean;
  /** Omit "Today" from the time when the row is already under a Today heading. */
  hideDay?: boolean;
}) {
  const overdue = dueGroup(task.dueDate, today) === "overdue" && OPEN_FOR_ASSIGNEE_STATUSES.includes(task.status);
  const primary = task.companyName ?? task.title;
  const secondary = [KIND_LABEL[task.kind], task.companyName ? task.title : null, task.locationArea]
    .filter(Boolean)
    .join(" · ");
  const quickAction = quickActionFor(task);
  const when = formatDue(task.dueDate, task.dueTime, today, { includeDay: !hideDay });
  const whenTone = overdue ? "font-medium text-danger-700" : "text-ink-muted";

  return (
    <li className="flex items-stretch">
      <Link
        href={`/work/${task.id}`}
        className="flex min-w-0 flex-1 gap-3 px-4 py-3 transition-colors duration-150 hover:bg-subtle/60 focus-visible:-outline-offset-2"
      >
        <KindIcon kind={task.kind} />
        <div className="min-w-0 flex-1">
          {/* Phones: the time leads the second line so the name gets the full width. */}
          <div className="flex items-baseline justify-between gap-3">
            <span className="truncate font-medium text-ink">{primary}</span>
            <span className={cn("tabular hidden shrink-0 text-sm sm:inline", whenTone)}>{when}</span>
          </div>
          <div className="truncate text-sm text-ink-muted">
            <span className={cn("tabular sm:hidden", whenTone)}>{when} · </span>
            {secondary}
          </div>
          {(task.status !== "assigned" || task.priority === "high" || task.priority === "urgent" || showAssignee || showBranch) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {task.status !== "assigned" && <StatusPill status={task.status} />}
              <PriorityTag priority={task.priority} />
              {showBranch && <BranchTag name={task.branchName} />}
              {showAssignee && (
                <span className="text-xs text-ink-muted">
                  {task.assigneeName ? firstName(task.assigneeName) : "Not assigned"}
                </span>
              )}
            </div>
          )}
        </div>
      </Link>
      {quickAction && (
        <a
          href={quickAction.href}
          target={quickAction.external ? "_blank" : undefined}
          rel={quickAction.external ? "noopener noreferrer" : undefined}
          aria-label={`${quickAction.label}: ${primary}`}
          title={quickAction.label}
          className="flex w-14 shrink-0 items-center justify-center border-l border-line text-brand-600 transition-colors duration-150 hover:bg-brand-50 focus-visible:-outline-offset-2 [&_svg]:size-5"
        >
          {quickAction.icon}
        </a>
      )}
    </li>
  );
}

function quickActionFor(task: TaskListItem): { href: string; label: string; icon: ReactNode; external: boolean } | null {
  if (!OPEN_FOR_ASSIGNEE_STATUSES.includes(task.status)) return null;
  if (isFieldKind(task.kind)) {
    const href = mapsDirectionsHref({ latitude: task.latitude, longitude: task.longitude, address: task.locationAddress });
    return href ? { href, label: "Route", icon: <Navigation strokeWidth={1.75} />, external: true } : null;
  }
  if ((task.kind === "call" || task.kind === "follow_up") && task.contactPhone) {
    return { href: telHref(task.contactPhone), label: "Call", icon: <Phone strokeWidth={1.75} />, external: false };
  }
  return null;
}

const GROUP_LABEL: Record<DueGroup, string> = {
  overdue: "Overdue",
  today: "Today",
  tomorrow: "Tomorrow",
  upcoming: "Later",
  unscheduled: "No date",
};

const GROUP_ORDER: DueGroup[] = ["overdue", "today", "tomorrow", "upcoming", "unscheduled"];

/** Work grouped by when it is due: Overdue / Today / Tomorrow / Later / No date. */
export function GroupedWorkList({
  tasks,
  today,
  showAssignee,
  showBranch,
}: {
  tasks: TaskListItem[];
  today: IsoDate;
  showAssignee?: boolean;
  showBranch?: boolean;
}) {
  const groups = new Map<DueGroup, TaskListItem[]>();
  for (const task of tasks) {
    const group = dueGroup(task.dueDate, today);
    groups.set(group, [...(groups.get(group) ?? []), task]);
  }
  return (
    <div className="space-y-6">
      {GROUP_ORDER.filter((group) => groups.has(group)).map((group) => (
        <section key={group} aria-labelledby={`group-${group}`}>
          <h2
            id={`group-${group}`}
            className={cn(
              "mb-2 flex items-center gap-2 text-sm font-medium",
              group === "overdue" ? "text-danger-700" : "text-ink-muted",
            )}
          >
            {GROUP_LABEL[group]}
            <span className="tabular rounded-full bg-subtle px-1.5 text-xs text-ink-muted">{groups.get(group)!.length}</span>
          </h2>
          <List>
            {groups.get(group)!.map((task) => (
              <WorkRow key={task.id} task={task} today={today} showAssignee={showAssignee} showBranch={showBranch} hideDay={group === "today"} />
            ))}
          </List>
        </section>
      ))}
    </div>
  );
}

/** Flat list (Done view, Home sections). `hideToday` drops "Today" when the list is all about today. */
export function WorkList({
  tasks,
  today,
  showAssignee,
  showBranch,
  hideToday,
}: {
  tasks: TaskListItem[];
  today: IsoDate;
  showAssignee?: boolean;
  showBranch?: boolean;
  hideToday?: boolean;
}) {
  return (
    <List>
      {tasks.map((task) => (
        <WorkRow key={task.id} task={task} today={today} showAssignee={showAssignee} showBranch={showBranch} hideDay={hideToday} />
      ))}
    </List>
  );
}
