import { Avatar } from "@/components/ui/display";
import { firstName } from "@/lib/format";
import { formatTimestamp } from "@/lib/time";
import type { TaskStatus } from "../model";
import type { TaskEventItem } from "../queries";

const STATUS_VERB: Partial<Record<TaskStatus, string>> = {
  in_progress: "started this",
  collected: "marked it collected",
  delivered: "marked it delivered",
  completed: "completed this",
  cancelled: "cancelled this",
};

function describe(event: TaskEventItem): string {
  const who = event.actorName ? firstName(event.actorName) : "PTCC";
  switch (event.type) {
    case "created":
      return `${who} created this`;
    case "assigned": {
      const name =
        event.assigneeName ?? (typeof event.meta?.assigneeName === "string" ? event.meta.assigneeName : "someone");
      return event.meta?.previousAssigneeId ? `${who} reassigned this to ${name}` : `${who} assigned this to ${name}`;
    }
    case "status_changed":
      // Closing a pickup or delivery is a hand-off, not just "completed".
      if (event.toStatus === "completed" && event.fromStatus === "collected") return `${who} received it at PTCC`;
      if (event.toStatus === "completed" && event.fromStatus === "delivered") return `${who} closed this`;
      return `${who} ${(event.toStatus && STATUS_VERB[event.toStatus]) ?? "updated the status"}`;
    case "comment":
      return who;
    case "updated":
      return `${who} updated the details`;
  }
}

/** History and notes of a work item, oldest first — the conversation lives with the work. */
export function TaskTimeline({ events, now }: { events: TaskEventItem[]; now: Date }) {
  return (
    <ol className="space-y-4">
      {events.map((event) => (
        <li key={event.id} className="flex gap-3">
          {event.type === "comment" ? (
            <Avatar name={event.actorName ?? "PTCC"} size="sm" />
          ) : (
            <span className="flex size-7 shrink-0 items-center justify-center" aria-hidden>
              <span className="size-2 rounded-full bg-line-strong" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm">
              <span className={event.type === "comment" ? "font-medium text-ink" : "text-ink-muted"}>{describe(event)}</span>
              <span className="text-ink-subtle"> · {formatTimestamp(event.createdAt, now)}</span>
            </p>
            {event.body && (
              <p
                className={
                  event.type === "comment"
                    ? "mt-1 rounded-panel rounded-tl-sm bg-subtle px-3 py-2 text-ink whitespace-pre-line"
                    : "mt-0.5 text-sm text-ink-muted"
                }
              >
                {event.type === "status_changed" ? `Reason: ${event.body}` : event.body}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
