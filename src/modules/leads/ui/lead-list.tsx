import Link from "next/link";
import { List } from "@/components/ui/display";
import { cn, firstName } from "@/lib/format";
import { formatInr } from "@/lib/money";
import { dueGroup, formatDue, type IsoDate } from "@/lib/time";
import { isOpenStage, leadRef } from "../model";
import type { LeadListItem } from "../queries";
import { BranchTag, StagePill } from "./badges";

/**
 * The lead row — the marketing equivalent of the work row:
 *   Company                                        Next follow-up
 *   Requirement · area · L-1042        [stage] [owner] [branch]
 */
export function LeadRow({
  lead,
  today,
  showBranch,
  showOwner = true,
}: {
  lead: LeadListItem;
  today: IsoDate;
  showBranch?: boolean;
  showOwner?: boolean;
}) {
  const open = isOpenStage(lead.stage);
  const next = lead.nextFollowUp;
  const overdue = open && next ? dueGroup(next.dueDate, today) === "overdue" : false;
  const trailing = !open
    ? lead.stage === "won" && lead.wonValuePaise
      ? formatInr(lead.wonValuePaise)
      : null
    : next
      ? formatDue(next.dueDate, next.dueTime, today)
      : "No follow-up";

  return (
    <li>
      <Link href={`/leads/${lead.id}`} className="block px-4 py-3 transition-colors duration-150 hover:bg-subtle/60 focus-visible:-outline-offset-2">
        <div className="flex items-baseline justify-between gap-3">
          <span className="truncate font-medium text-ink">{lead.companyName}</span>
          {trailing && (
            <span
              className={cn(
                "tabular hidden shrink-0 text-sm sm:inline",
                overdue ? "font-medium text-danger-700" : next || !open ? "text-ink-muted" : "text-ink-subtle",
              )}
            >
              {trailing}
            </span>
          )}
        </div>
        <div className="truncate text-sm text-ink-muted">
          {trailing && (
            <span className={cn("tabular sm:hidden", overdue ? "font-medium text-danger-700" : undefined)}>{trailing} · </span>
          )}
          {[lead.requirement, lead.companyArea, leadRef(lead.number)].filter(Boolean).join(" · ")}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <StagePill stage={lead.stage} />
          {showOwner && (
            <span className={cn("text-xs", lead.ownerName ? "text-ink-muted" : "font-medium text-warning-700")}>
              {lead.ownerName ? firstName(lead.ownerName) : "No owner yet"}
            </span>
          )}
          {showBranch && <BranchTag name={lead.branchName} />}
        </div>
      </Link>
    </li>
  );
}

export function LeadList({
  leads,
  today,
  showBranch,
  showOwner,
}: {
  leads: LeadListItem[];
  today: IsoDate;
  showBranch?: boolean;
  showOwner?: boolean;
}) {
  return (
    <List>
      {leads.map((lead) => (
        <LeadRow key={lead.id} lead={lead} today={today} showBranch={showBranch} showOwner={showOwner} />
      ))}
    </List>
  );
}
