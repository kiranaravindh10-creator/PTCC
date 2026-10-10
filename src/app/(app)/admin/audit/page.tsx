import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { List, PageHeader } from "@/components/ui/display";
import { ListSkeleton } from "@/components/ui/skeletons";
import { can } from "@/server/access/actor";
import { requireContext } from "@/server/auth/current";
import { formatTimestamp } from "@/lib/time";
import { listAuditLog } from "@/modules/users/queries";
import { AdminTabs } from "@/modules/users/ui/admin-tabs";

export const metadata: Metadata = { title: "Activity log" };

const ACTION_LABEL: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.login_failed": "Failed sign-in",
  "auth.logout": "Signed out",
  "user.create": "Added a person",
  "user.update": "Updated a person",
  "user.roles_changed": "Changed roles",
  "user.deactivate": "Deactivated a person",
  "user.reactivate": "Reactivated a person",
  "user.password_reset": "Reset a password",
  "user.password_change": "Changed own password",
  "task.create": "Created work",
  "task.assign": "Assigned work",
  "task.status_change": "Updated work status",
  "branch.create": "Added a branch",
  "branch.update": "Updated a branch",
  "branch.deactivate": "Deactivated a branch",
  "branch.reactivate": "Reactivated a branch",
  "customer.create": "Added a customer",
  "customer.update": "Updated a customer",
  "customer.relationship": "Changed relationship",
  "contact.create": "Added a contact",
  "lead.create": "Added a lead",
  "lead.update": "Updated a lead",
  "lead.assign": "Assigned a lead",
  "lead.branch": "Set a lead's branch",
  "lead.stage": "Moved a lead",
  "lead.won": "Marked a lead won",
  "lead.lost": "Marked a lead lost",
  "lead.reopen": "Reopened a lead",
  "quotation.create": "Created a quotation",
  "quotation.status": "Updated a quotation",
  "scope.import": "Imported NABL scope",
};

export default function AuditPage() {
  return (
    <Suspense fallback={<ListSkeleton title="Activity log" />}>
      <Audit />
    </Suspense>
  );
}

async function Audit() {
  const ctx = await requireContext();
  if (!can(ctx.actor, "audit.read")) notFound();
  const entries = await listAuditLog(ctx, { limit: 200 });

  return (
    <div className="max-w-4xl">
      <PageHeader title="People & access" description="The latest 200 security and business changes" />
      <AdminTabs actor={ctx.actor} active="audit" />
      <List>
        {entries.map((entry) => (
          <li key={entry.id} className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[9rem_10rem_minmax(0,1fr)] sm:gap-4">
            <span className="tabular text-ink-muted">{formatTimestamp(entry.createdAt, ctx.now)}</span>
            <span className={entry.action === "auth.login_failed" ? "font-medium text-danger-700" : "font-medium"}>
              {ACTION_LABEL[entry.action] ?? entry.action}
            </span>
            <span className="min-w-0 text-ink-muted">
              {entry.actorName ?? (entry.action.startsWith("auth.") ? "Unknown" : "System")}
              {entry.summary && <span className="text-ink"> — {entry.summary}</span>}
              {entry.ip && <span className="ml-1 text-xs text-ink-subtle">({entry.ip})</span>}
            </span>
          </li>
        ))}
      </List>
    </div>
  );
}
