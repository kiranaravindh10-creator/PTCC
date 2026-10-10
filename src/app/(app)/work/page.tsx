import { CircleCheck, Inbox, Plus } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/display";
import { ListSkeleton } from "@/components/ui/skeletons";
import { Tabs } from "@/components/ui/tabs";
import { can, scopeOf } from "@/server/access/actor";
import { requireContext } from "@/server/auth/current";
import { companyToday } from "@/lib/time";
import { listWork } from "@/modules/tasks/queries";
import { GroupedWorkList, WorkList } from "@/modules/tasks/ui/work-list";

export const metadata: Metadata = { title: "My Work" };

type View = "todo" | "done" | "team";

export default function MyWorkPage({ searchParams }: PageProps<"/work">) {
  return (
    <Suspense fallback={<ListSkeleton title="My Work" />}>
      <MyWork searchParams={searchParams} />
    </Suspense>
  );
}

async function MyWork({ searchParams }: { searchParams: PageProps<"/work">["searchParams"] }) {
  const ctx = await requireContext();
  const params = await searchParams;
  const workScope = scopeOf(ctx.actor, "task.read");
  const canSeeTeam = workScope === "branch" || workScope === "all";
  const teamLabel = workScope === "all" ? "Everyone" : "Branch";
  const requested = params.view;
  const view: View = requested === "done" ? "done" : requested === "team" && canSeeTeam ? "team" : "todo";
  const today = companyToday(ctx.now);

  const tasks =
    view === "team"
      ? await listWork(ctx, { scope: "team", view: "open" })
      : await listWork(ctx, { scope: "mine", view: view === "done" ? "done" : "open" });

  const tabs = [
    { href: "/work", label: "To do", active: view === "todo" },
    { href: "/work?view=done", label: "Done", active: view === "done" },
    ...(canSeeTeam ? [{ href: "/work?view=team", label: teamLabel, active: view === "team" }] : []),
  ];

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="My Work"
        description={
          view === "team"
            ? workScope === "all"
              ? "Open work across all branches"
              : `Open work in ${ctx.actor.branchName}`
            : view === "done"
              ? "Finished in the last two weeks"
              : "Everything assigned to you, in order"
        }
        actions={
          can(ctx.actor, "task.create") ? (
            <ButtonLink href="/work/new" variant="primary">
              <Plus aria-hidden />
              New work
            </ButtonLink>
          ) : undefined
        }
      />
      <div className="mb-6">
        <Tabs label="Work views" items={tabs} />
      </div>

      {tasks.length === 0 ? (
        view === "done" ? (
          <EmptyState icon={<CircleCheck />} title="Nothing finished yet" description="Work you complete in the next two weeks will be listed here." />
        ) : (
          <EmptyState
            icon={<Inbox />}
            title={view === "team" ? "No open work" : "You're all caught up"}
            description={view === "team" ? "Nothing is open across the company." : "New work assigned to you will appear here, and you'll get a notification."}
          />
        )
      ) : view === "done" ? (
        <WorkList tasks={tasks} today={today} />
      ) : (
        <GroupedWorkList tasks={tasks} today={today} showAssignee={view === "team"} showBranch={view === "team" && workScope === "all"} />
      )}
    </div>
  );
}
