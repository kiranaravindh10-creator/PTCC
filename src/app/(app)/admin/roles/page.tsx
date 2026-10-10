import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { List, PageHeader } from "@/components/ui/display";
import { ListSkeleton } from "@/components/ui/skeletons";
import { canAny } from "@/server/access/actor";
import { requireContext } from "@/server/auth/current";
import { listRoles } from "@/modules/users/queries";
import { AdminTabs } from "@/modules/users/ui/admin-tabs";

export const metadata: Metadata = { title: "Roles" };

export default function RolesPage() {
  return (
    <Suspense fallback={<ListSkeleton title="Roles" />}>
      <Roles />
    </Suspense>
  );
}

async function Roles() {
  const ctx = await requireContext();
  if (!canAny(ctx.actor, "user.manage", "role.manage")) notFound();
  const roles = await listRoles(ctx);

  return (
    <div className="max-w-4xl">
      <PageHeader title="People & access" description="What each role can do" />
      <AdminTabs actor={ctx.actor} active="roles" />
      <div className="space-y-4">
        {roles.map((role) => (
          <section key={role.id} className="rounded-panel border border-line bg-surface">
            <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-3">
              <div>
                <h2 className="font-semibold">{role.name}</h2>
                <p className="text-sm text-ink-muted">{role.description}</p>
              </div>
              <span className="tabular text-sm text-ink-muted">
                {role.memberCount} {role.memberCount === 1 ? "person" : "people"}
              </span>
            </header>
            <List className="rounded-none border-0">
              {role.permissions.map((permission) => (
                <li key={permission.key} className="flex flex-wrap items-baseline justify-between gap-x-4 px-4 py-2 text-sm">
                  <span>{permission.description}</span>
                  <code className="font-mono text-xs text-ink-subtle">{permission.key}</code>
                </li>
              ))}
            </List>
          </section>
        ))}
      </div>
      <p className="mt-6 text-sm text-ink-muted">
        Role permissions are stored in the database and can be adjusted. Editing them from this screen arrives in a
        later release; until then, defaults are defined in <code className="font-mono text-xs">src/server/access/roles.ts</code>.
      </p>
    </div>
  );
}
