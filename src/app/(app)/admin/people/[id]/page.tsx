import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { PageHeader, Panel, Section } from "@/components/ui/display";
import { DetailSkeleton } from "@/components/ui/skeletons";
import { can } from "@/server/access/actor";
import { requireContext } from "@/server/auth/current";
import { formatPhone } from "@/lib/phone";
import { formatTimestamp } from "@/lib/time";
import { listActiveBranches } from "@/modules/customers/queries";
import { getPerson, listRoles } from "@/modules/users/queries";
import { PersonForm, ResetPasswordForm, StatusForm } from "@/modules/users/ui/person-form";

export const metadata: Metadata = { title: "Person" };

export default function PersonPage({ params }: PageProps<"/admin/people/[id]">) {
  return (
    <div className="space-y-6">
      <Link href="/admin/people" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        People
      </Link>
      <Suspense fallback={<DetailSkeleton />}>
        <Person params={params} />
      </Suspense>
    </div>
  );
}

async function Person({ params }: { params: PageProps<"/admin/people/[id]">["params"] }) {
  const ctx = await requireContext();
  if (!can(ctx.actor, "user.manage")) notFound();
  const { id } = await params;
  const [person, roles, branches] = await Promise.all([getPerson(ctx, id), listRoles(ctx), listActiveBranches(ctx)]);
  if (!person) notFound();
  const isSelf = person.id === ctx.actor.id;

  return (
    <div className="space-y-10">
      <PageHeader
        title={person.name}
        description={[
          person.branchName ?? "Company level",
          formatPhone(person.phone),
          person.status === "inactive" ? "Inactive" : null,
          person.lastLoginAt ? `Last signed in ${formatTimestamp(person.lastLoginAt, ctx.now)}` : "Never signed in",
        ]
          .filter(Boolean)
          .join(" · ")}
      />
      <PersonForm
        roles={roles.map(({ key, name, description }) => ({ key, name, description }))}
        branches={branches.map(({ id, name }) => ({ id, name }))}
        person={{
          branchId: person.branchId ?? "",
          id: person.id,
          name: person.name,
          phone: formatPhone(person.phone),
          email: person.email ?? "",
          designation: person.designation ?? "",
          roleKeys: person.roleKeys,
        }}
      />
      {!isSelf && (
        <div className="grid max-w-2xl gap-6 sm:grid-cols-2">
          <Section title="Password">
            <Panel className="p-4">
              <ResetPasswordForm id={person.id} name={person.name} />
            </Panel>
          </Section>
          <Section title="Access">
            <Panel className="p-4">
              <StatusForm id={person.id} name={person.name} status={person.status} />
            </Panel>
          </Section>
        </div>
      )}
    </div>
  );
}
