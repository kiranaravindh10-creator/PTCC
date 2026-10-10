import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Notice, PageHeader } from "@/components/ui/display";
import { FormSkeleton } from "@/components/ui/skeletons";
import { can, scopeOf } from "@/server/access/actor";
import { requireContext } from "@/server/auth/current";
import { companyToday } from "@/lib/time";
import { TASK_KINDS, type TaskKind } from "@/modules/tasks/model";
import { listActiveBranches } from "@/modules/customers/queries";
import { listAssignablePeople, listCompanyOptions } from "@/modules/tasks/queries";
import { NewTaskForm } from "@/modules/tasks/ui/new-task-form";

export const metadata: Metadata = { title: "New work" };

export default function NewWorkPage({ searchParams }: PageProps<"/work/new">) {
  return (
    <div className="space-y-6">
      <Link href="/work" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        My Work
      </Link>
      <PageHeader title="New work" />
      <Suspense fallback={<FormSkeleton />}>
        <NewWork searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function NewWork({ searchParams }: { searchParams: PageProps<"/work/new">["searchParams"] }) {
  const ctx = await requireContext();
  if (!can(ctx.actor, "task.create")) {
    return (
      <div className="max-w-2xl">
        <Notice tone="info" title="Work is assigned to you by your coordinator">
          If something needs doing, add a note on the related work or ask your coordinator.
        </Notice>
      </div>
    );
  }
  const { kind } = await searchParams;
  const defaultKind: TaskKind = TASK_KINDS.includes(kind as TaskKind) ? (kind as TaskKind) : "general";
  const assignScope = scopeOf(ctx.actor, "task.assign");
  const [companies, people, branches] = await Promise.all([
    listCompanyOptions(ctx),
    assignScope === "branch" || assignScope === "all" ? listAssignablePeople(ctx) : Promise.resolve(null),
    assignScope === "all" ? listActiveBranches(ctx) : Promise.resolve(null),
  ]);

  return (
    <NewTaskForm
      companies={companies}
      people={people}
      actorId={ctx.actor.id}
      today={companyToday(ctx.now)}
      defaultKind={defaultKind}
      branches={branches?.map(({ id, name }) => ({ id, name })) ?? null}
      defaultBranchId={ctx.actor.branchId ?? ""}
    />
  );
}
