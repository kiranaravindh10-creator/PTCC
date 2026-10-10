"use client";

import {
  Building2,
  Ellipsis,
  Handshake,
  House,
  ListChecks,
  MessageCircleQuestion,
  MessagesSquare,
  Truck,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/format";
import type { NavIcon, NavItem } from "./nav";

const ICONS: Record<NavIcon, LucideIcon> = {
  home: House,
  work: ListChecks,
  leads: Handshake,
  customers: Building2,
  collections: Truck,
  communication: MessagesSquare,
  ask: MessageCircleQuestion,
  people: UserCog,
};

function isActive(pathname: string, item: Pick<NavItem, "href" | "also">): boolean {
  if (item.href === "/") return pathname === "/";
  return [item.href, ...(item.also ?? [])].some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function SidebarLinks({ items, unread }: { items: NavItem[]; unread: number }) {
  const pathname = usePathname();
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const active = isActive(pathname, item);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex h-10 items-center gap-3 rounded-control px-3 text-[0.9375rem] font-medium transition-colors duration-150",
                active ? "bg-brand-50 text-brand-700" : "text-ink-muted hover:bg-subtle hover:text-ink",
                item.planned && !active && "text-ink-subtle",
              )}
            >
              <Icon className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
              <span className="flex-1 truncate">{item.label}</span>
              {item.planned && (
                <span className="rounded-full border border-line px-1.5 text-[0.6875rem] leading-4 font-medium text-ink-subtle">
                  Soon
                </span>
              )}
              {item.showsUnread && unread > 0 && <UnreadBadge count={unread} />}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function BottomLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const moreActive = !items.some((item) => isActive(pathname, item)) && pathname !== "/";
  return (
    <ul className="grid h-16 auto-cols-fr grid-flow-col">
      {items.map((item) => (
        <BottomLink key={item.href} href={item.href} label={item.label} icon={ICONS[item.icon]} active={isActive(pathname, item)} />
      ))}
      <BottomLink href="/more" label="More" icon={Ellipsis} active={moreActive} />
    </ul>
  );
}

function BottomLink({ href, label, icon: Icon, active }: { href: string; label: string; icon: LucideIcon; active: boolean }) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-full flex-col items-center justify-center gap-1 text-xs font-medium transition-colors duration-150 focus-visible:-outline-offset-4",
          active ? "text-brand-700" : "text-ink-muted",
        )}
      >
        <Icon className="size-[22px]" strokeWidth={active ? 2 : 1.75} aria-hidden />
        {label}
      </Link>
    </li>
  );
}

export function UnreadBadge({ count }: { count: number }) {
  return (
    <span className="tabular inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-500 px-1.5 text-[0.6875rem] font-semibold text-white">
      <span className="sr-only">Unread: </span>
      {count > 99 ? "99+" : count}
    </span>
  );
}
