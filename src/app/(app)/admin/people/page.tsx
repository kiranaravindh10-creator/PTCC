import { ChevronRight, UserPlus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ButtonLink } from "@/components/ui/button";
import { Avatar, List, PageHeader } from "@/components/ui/display";
import { ListSkeleton } from "@/components/ui/skeletons";
import { can } from "@/server/access/actor";
import { requireContext } from "@/server/auth/current";
import { formatPhone } from "@/lib/phone";
import { formatTimestamp } from "@/lib/time";
import { listPeople } from "@/modules/users/queries";
import { AdminTabs } from "@/modules/users/ui/admin-tabs";

export const metadata: Metadata = { title: "People & access" };

export default function PeoplePage() {
  return (
    <Suspense fallback={<ListSkeleton title="People" />}>
      <People />
    </Suspense>
  );
}

async function People() {
  const ctx = await requireContext();
  if (!can(ctx.actor, "user.manage")) notFound();
  const people = await listPeople(ctx);
  const active = people.filter((person) => person.status === "active").length;

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="People & access"
        description={`${active} active ${active === 1 ? "person" : "people"}`}
        actions={
          <ButtonLink href="/admin/people/new" variant="primary">
            <UserPlus aria-hidden />
            Add person
          </ButtonLink>
        }
      />
      <AdminTabs actor={ctx.actor} active="people" />
      <List>
        {people.map((person) => (
          <li key={person.id}>
            <Link href={`/admin/people/${person.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-subtle/60">
              <Avatar name={person.name} />
              <div className="min-w-0 flex-1 sm:grid sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-4">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {person.name}
                    {person.status === "inactive" && (
                      <span className="ml-2 rounded-full bg-subtle px-2 py-0.5 text-xs font-medium text-ink-subtle">Inactive</span>
                    )}
                  </p>
                  <p className="truncate text-sm text-ink-muted">
                    {person.branchName ?? "Company level"}
                    {person.designation ? ` · ${person.designation}` : ""}
                  </p>
                </div>
                <p className="tabular hidden truncate text-sm text-ink-muted sm:block">{formatPhone(person.phone)}</p>
                <div className="min-w-0 text-sm">
                  <p className="truncate text-ink-muted max-sm:hidden">{person.roleNames.join(", ")}</p>
                  <p className="truncate text-xs text-ink-subtle">
                    {person.mustChangePassword
                      ? "Hasn't set a password yet"
                      : person.lastLoginAt
                        ? `Signed in ${formatTimestamp(person.lastLoginAt, ctx.now)}`
                        : "Never signed in"}
                  </p>
                </div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-ink-subtle" aria-hidden />
            </Link>
          </li>
        ))}
      </List>
    </div>
  );
}
