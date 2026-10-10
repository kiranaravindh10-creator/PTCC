import { ChevronRight, LogOut, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { signOutAction } from "@/app/(auth)/actions";
import { mainNav, manageNav, mobileNav } from "@/components/shell/nav";
import { Avatar, List, PageHeader } from "@/components/ui/display";
import { ListSkeleton } from "@/components/ui/skeletons";
import { ROLES } from "@/server/access/roles";
import { requireContext } from "@/server/auth/current";
import { unreadNotificationCount } from "@/modules/notifications/queries";
import { UnreadBadge } from "@/components/shell/nav-links";

export const metadata: Metadata = { title: "More" };

/** Phone overflow menu: everything not in the bottom bar, plus account and sign out. */
export default function MorePage() {
  return (
    <Suspense fallback={<ListSkeleton title="More" />}>
      <More />
    </Suspense>
  );
}

async function More() {
  const ctx = await requireContext();
  const inBottomBar = new Set(mobileNav(ctx.actor).map((item) => item.href));
  const items = [...mainNav(ctx.actor), ...manageNav(ctx.actor)].filter((item) => !inBottomBar.has(item.href));
  const unread = await unreadNotificationCount(ctx);

  return (
    <div className="max-w-xl space-y-6">
      <PageHeader title="More" />
      <Link href="/account" className="flex items-center gap-3 rounded-panel border border-line bg-surface px-4 py-3 hover:bg-subtle/60">
        <Avatar name={ctx.actor.name} size="lg" />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{ctx.actor.name}</span>
          <span className="block text-sm text-ink-muted">{ctx.actor.roleKeys.map((key) => ROLES[key].name).join(", ")}</span>
        </span>
        <UserRound className="size-5 text-ink-subtle" aria-hidden />
      </Link>
      <List>
        {items.map((item) => (
          <li key={item.href}>
            <Link href={item.href} className="flex h-14 items-center gap-3 px-4 hover:bg-subtle/60">
              <span className="flex-1 font-medium">{item.label}</span>
              {item.planned && <span className="text-xs text-ink-subtle">Phase {item.planned.phase}</span>}
              {item.showsUnread && unread > 0 && <UnreadBadge count={unread} />}
              <ChevronRight className="size-4 text-ink-subtle" aria-hidden />
            </Link>
          </li>
        ))}
      </List>
      <form action={signOutAction}>
        <button
          type="submit"
          className="flex h-14 w-full items-center gap-3 rounded-panel border border-line bg-surface px-4 font-medium text-danger-700 hover:bg-danger-50"
        >
          <LogOut className="size-5" strokeWidth={1.75} aria-hidden />
          Sign out
        </button>
      </form>
    </div>
  );
}
