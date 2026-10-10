import { CircleCheck, Plus, Truck } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/display";
import { ListSkeleton } from "@/components/ui/skeletons";
import { Tabs } from "@/components/ui/tabs";
import { can, scopeOf } from "@/server/access/actor";
import { requireContext } from "@/server/auth/current";
import { companyToday } from "@/lib/time";
import { FIELD_KINDS } from "@/modules/tasks/model";
import { listWork } from "@/modules/tasks/queries";
import { GroupedWorkList, WorkList } from "@/modules/tasks/ui/work-list";

export const metadata: Metadata = { title: "Collections" };

export default function CollectionsPage({ searchParams }: PageProps<"/collections">) {
  return (
    <Suspense fallback={<ListSkeleton title="Collections" />}>
      <Collections searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * Pickups and deliveries. Collection staff see their own; coordinators, operations
 * and the CEO see everyone's. Parcels, proof and route planning come in Phase 4.
 */
async function Collections({ searchParams }: { searchParams: PageProps<"/collections">["searchParams"] }) {
  const ctx = await requireContext();
  const fieldScope = scopeOf(ctx.actor, "collection.read");
  if (!fieldScope) notFound();
  const { view } = await searchParams;
  const done = view === "done";
  const everyone = fieldScope === "branch" || fieldScope === "all";
  const today = companyToday(ctx.now);

  const tasks = await listWork(ctx, {
    scope: everyone ? "team" : "mine",
    view: done ? "done" : "open",
    kinds: FIELD_KINDS,
  });
  const assignScope = scopeOf(ctx.actor, "task.assign");
  const canCreate = can(ctx.actor, "task.create") && (assignScope === "branch" || assignScope === "all");

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="Collections"
        description={
          fieldScope === "all"
            ? "All pickups and deliveries, every branch"
            : fieldScope === "branch"
              ? `${ctx.actor.branchName} pickups and deliveries`
              : "Your pickups and deliveries"
        }
        actions={
          canCreate ? (
            <>
              <ButtonLink href="/work/new?kind=delivery" variant="secondary">
                <Plus aria-hidden />
                Delivery
              </ButtonLink>
              <ButtonLink href="/work/new?kind=pickup" variant="primary">
                <Plus aria-hidden />
                Pickup
              </ButtonLink>
            </>
          ) : undefined
        }
      />
      <div className="mb-6">
        <Tabs
          label="Collection views"
          items={[
            { href: "/collections", label: everyone ? "Open" : "To do", active: !done },
            { href: "/collections?view=done", label: "Done", active: done },
          ]}
        />
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          icon={done ? <CircleCheck /> : <Truck />}
          title={done ? "Nothing finished in the last two weeks" : "No pickups or deliveries"}
          description={done ? undefined : everyone ? "New pickups and deliveries will appear here." : "When a pickup or delivery is assigned to you, it appears here and you get a notification."}
        />
      ) : done ? (
        <WorkList tasks={tasks} today={today} showAssignee={everyone} showBranch={fieldScope === "all"} />
      ) : (
        <GroupedWorkList tasks={tasks} today={today} showAssignee={everyone} showBranch={fieldScope === "all"} />
      )}

      <p className="mt-8 text-sm text-ink-muted">
        Parcel records, proof of pickup and delivery, and multi-stop route planning arrive in Phase 4.
      </p>
    </div>
  );
}
