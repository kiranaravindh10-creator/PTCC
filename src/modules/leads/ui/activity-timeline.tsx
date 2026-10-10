import Link from "next/link";
import { Avatar } from "@/components/ui/display";
import { cn, firstName } from "@/lib/format";
import { formatInr } from "@/lib/money";
import { formatAbsoluteDue, formatTimestamp } from "@/lib/time";
import { CALL_OUTCOME_LABEL, leadRef, QUOTATION_STATUS_LABEL, quotationRef, STAGE_LABEL, type LeadStage, type QuotationStatus } from "../model";
import type { ActivityItem } from "../queries";

function str(meta: Record<string, unknown> | null, key: string): string | null {
  const value = meta?.[key];
  return typeof value === "string" ? value : null;
}

function num(meta: Record<string, unknown> | null, key: string): number | null {
  const value = meta?.[key];
  return typeof value === "number" ? value : null;
}

/** One line describing what happened, in plain words. */
function describe(activity: ActivityItem): string {
  const who = firstName(activity.actorName);
  const meta = activity.meta;
  switch (activity.kind) {
    case "call":
      return `${who} called — ${activity.callOutcome ? CALL_OUTCOME_LABEL[activity.callOutcome] : "outcome not recorded"}`;
    case "note":
      return who;
    case "lead_created":
      return `${who} added the lead`;
    case "stage_changed": {
      const to = str(meta, "to") as LeadStage | null;
      return `${who} moved it to ${to ? STAGE_LABEL[to] : "another stage"}`;
    }
    case "assigned":
      return `${who} assigned it to ${str(meta, "ownerName") ?? "someone"}`;
    case "branch_assigned":
      return `${who} set the branch to ${str(meta, "branchName") ?? "another branch"}`;
    case "follow_up_scheduled": {
      const date = str(meta, "dueDate");
      return `${who} scheduled a follow-up${date ? ` for ${formatAbsoluteDue(date, str(meta, "dueTime"))}` : ""}`;
    }
    case "follow_up_done":
      return `${who} completed a follow-up`;
    case "requirement_added":
      return `${who} added a requirement`;
    case "quotation_created": {
      const number = num(meta, "number");
      const total = num(meta, "totalPaise");
      return `${who} created quotation${number ? ` ${quotationRef(number)}` : ""}${total !== null ? ` (${formatInr(total)})` : ""}`;
    }
    case "quotation_status": {
      const number = num(meta, "number");
      const to = str(meta, "to") as QuotationStatus | null;
      return `${who} marked ${number ? quotationRef(number) : "the quotation"} ${to ? QUOTATION_STATUS_LABEL[to].toLowerCase() : "updated"}`;
    }
    case "won": {
      const value = num(meta, "wonValuePaise");
      return `${who} marked it won${value ? ` (${formatInr(value)})` : ""}`;
    }
    case "lost":
      return `${who} marked it lost`;
    case "reopened":
      return `${who} reopened it`;
    case "customer_linked": {
      const relationship = str(meta, "relationship");
      return `${who} recorded it as a ${relationship ?? "prospect"}${activity.branchName ? ` of ${activity.branchName}` : ""}`;
    }
  }
}

/** Marketing history, newest first. On a customer page, each entry links to its lead. */
export function ActivityTimeline({ activities, now, showLead = false }: { activities: ActivityItem[]; now: Date; showLead?: boolean }) {
  if (activities.length === 0) return <p className="text-sm text-ink-muted">Nothing recorded yet.</p>;
  return (
    <ol className="space-y-4">
      {activities.map((activity) => {
        const isText = activity.kind === "note" || activity.kind === "call" || activity.kind === "lost" || activity.kind === "lead_created";
        return (
          <li key={activity.id} className="flex gap-3">
            {activity.kind === "note" || activity.kind === "call" ? (
              <Avatar name={activity.actorName} size="sm" />
            ) : (
              <span className="flex size-7 shrink-0 items-center justify-center" aria-hidden>
                <span className={cn("size-2 rounded-full", activity.kind === "won" ? "bg-success-700" : "bg-line-strong")} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm">
                <span className={activity.kind === "note" ? "font-medium" : "text-ink-muted"}>{describe(activity)}</span>
                <span className="text-ink-subtle"> · {formatTimestamp(activity.occurredAt, now)}</span>
                {showLead && activity.leadId && activity.leadNumber && (
                  <>
                    {" · "}
                    <Link href={`/leads/${activity.leadId}`} className="font-mono text-xs text-brand-600 hover:text-brand-700">
                      {leadRef(activity.leadNumber)}
                    </Link>
                  </>
                )}
              </p>
              {isText && activity.body && (
                <p
                  className={cn(
                    "mt-1 whitespace-pre-line",
                    activity.kind === "note" ? "rounded-panel rounded-tl-sm bg-subtle px-3 py-2 text-ink" : "text-sm text-ink-muted",
                  )}
                >
                  {activity.body}
                </p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
