import { Bell, LogOut } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { signOutAction } from "@/app/(auth)/actions";
import { Avatar, Skeleton } from "@/components/ui/display";
import { requireContext } from "@/server/auth/current";
import { ROLES } from "@/server/access/roles";
import { unreadNotificationCount } from "@/modules/notifications/queries";
import { mainNav, manageNav, mobileNav } from "./nav";
import { BottomLinks, SidebarLinks, UnreadBadge } from "./nav-links";

/**
 * App shell pieces. The static frame renders instantly; the parts that depend on who
 * is signed in (nav, unread count, name) stream in behind Suspense boundaries.
 */

export function Logo({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/ptcc-logo.png"
      alt="Precise Testing and Calibration Centre"
      width={1274}
      height={275}
      priority
      className={className}
    />
  );
}

export async function SidebarNav() {
  const ctx = await requireContext();
  const unread = await unreadNotificationCount(ctx);
  const manage = manageNav(ctx.actor);
  const roleNames = ctx.actor.roleKeys.map((key) => ROLES[key].name).join(", ");

  return (
    <>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3">
        <SidebarLinks items={mainNav(ctx.actor)} unread={unread} />
        {manage.length > 0 && (
          <div className="mt-6">
            <p className="px-3 pb-1.5 text-xs font-medium text-ink-subtle">Manage</p>
            <SidebarLinks items={manage} unread={0} />
          </div>
        )}
      </nav>
      <div className="border-t border-line p-3">
        <div className="flex items-center gap-3 rounded-control px-2 py-2">
          <Avatar name={ctx.actor.name} />
          <Link href="/account" className="min-w-0 flex-1 rounded-control hover:text-brand-700">
            <span className="block truncate text-sm font-medium">{ctx.actor.name}</span>
            <span className="block truncate text-xs text-ink-muted">{roleNames}</span>
          </Link>
          <form action={signOutAction}>
            <button
              type="submit"
              title="Sign out"
              className="flex size-9 items-center justify-center rounded-control text-ink-muted transition-colors duration-150 hover:bg-subtle hover:text-ink"
            >
              <LogOut className="size-[18px]" strokeWidth={1.75} aria-hidden />
              <span className="sr-only">Sign out</span>
            </button>
          </form>
        </div>
      </div>
    </>
  );
}

export function SidebarNavSkeleton() {
  return (
    <div className="flex-1 space-y-2 px-6 pt-1" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <Skeleton key={i} className="h-6 w-36" />
      ))}
    </div>
  );
}

export async function MobileBell() {
  const ctx = await requireContext();
  const unread = await unreadNotificationCount(ctx);
  return (
    <Link
      href="/communication"
      className="relative flex size-11 items-center justify-center rounded-full text-ink-muted hover:bg-subtle"
      aria-label={unread > 0 ? `Communication, ${unread} unread` : "Communication"}
    >
      <Bell className="size-[22px]" strokeWidth={1.75} aria-hidden />
      {unread > 0 && (
        <span className="absolute top-1 right-0.5">
          <UnreadBadge count={unread} />
        </span>
      )}
    </Link>
  );
}

export async function BottomNav() {
  const ctx = await requireContext();
  return <BottomLinks items={mobileNav(ctx.actor)} />;
}
