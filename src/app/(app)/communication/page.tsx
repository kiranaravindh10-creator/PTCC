import { BellOff } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { EmptyState, List, PageHeader, Section } from "@/components/ui/display";
import { ListSkeleton } from "@/components/ui/skeletons";
import { SubmitButton } from "@/components/ui/submit-button";
import { requireContext } from "@/server/auth/current";
import { cn } from "@/lib/format";
import { formatRelative } from "@/lib/time";
import { markAllNotificationsReadAction, openNotificationAction } from "@/modules/notifications/actions";
import { listNotifications } from "@/modules/notifications/queries";

export const metadata: Metadata = { title: "Communication" };

export default function CommunicationPage() {
  return (
    <Suspense fallback={<ListSkeleton title="Communication" />}>
      <Communication />
    </Suspense>
  );
}

async function Communication() {
  const ctx = await requireContext();
  const notifications = await listNotifications(ctx, { limit: 100 });
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="max-w-3xl space-y-10">
      <PageHeader title="Communication" description="Alerts about your work. Conversations about a job live on that job." />

      <Section
        title="Notifications"
        description={unread > 0 ? `${unread} unread` : undefined}
        action={
          unread > 0 ? (
            <form action={markAllNotificationsReadAction}>
              <SubmitButton variant="ghost" size="sm" pendingLabel="Marking…">
                Mark all as read
              </SubmitButton>
            </form>
          ) : undefined
        }
      >
        {notifications.length === 0 ? (
          <EmptyState icon={<BellOff />} title="No notifications yet" description="When work is assigned to you or someone updates your work, you'll see it here." />
        ) : (
          <List>
            {notifications.map((notification) => (
              <li key={notification.id}>
                <form action={openNotificationAction}>
                  <input type="hidden" name="id" value={notification.id} />
                  <button
                    type="submit"
                    className={cn(
                      "flex w-full gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-subtle/60 focus-visible:-outline-offset-2",
                      !notification.readAt && "bg-brand-50/40",
                    )}
                  >
                    <span className="mt-2 flex w-2 shrink-0 justify-center" aria-hidden>
                      {!notification.readAt && <span className="size-2 rounded-full bg-accent-500" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className={cn("text-ink", !notification.readAt && "font-medium")}>{notification.title}</span>
                        <span className="tabular shrink-0 text-xs text-ink-subtle">{formatRelative(notification.createdAt, ctx.now)}</span>
                      </span>
                      {notification.body && <span className="mt-0.5 block text-sm text-ink-muted">{notification.body}</span>}
                      {notification.actorName && <span className="mt-0.5 block text-xs text-ink-subtle">From {notification.actorName}</span>}
                      {!notification.readAt && <span className="sr-only">Unread</span>}
                    </span>
                  </button>
                </form>
              </li>
            ))}
          </List>
        )}
      </Section>

      <Section title="Announcements and team messages">
        <p className="rounded-panel border border-dashed border-line-strong bg-surface px-4 py-3 text-sm text-ink-muted">
          Company announcements and direct team messages arrive in Phase 6. WhatsApp alerts for new work and reminders
          arrive in Phase 7 — until then, notifications appear here and in the bell.
        </p>
      </Section>
    </div>
  );
}
