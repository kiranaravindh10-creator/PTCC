import Link from "next/link";
import { cn } from "@/lib/format";

/** Link-based segmented control for switching list views (state lives in the URL). */
export function Tabs({ items, label }: { items: { href: string; label: string; active: boolean; count?: number }[]; label: string }) {
  return (
    <nav aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-control border border-line bg-surface p-0.5">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.active ? "page" : undefined}
          className={cn(
            "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[5px] px-3.5 text-sm font-medium whitespace-nowrap transition-colors duration-150 lg:h-8",
            item.active ? "bg-brand-50 text-brand-700" : "text-ink-muted hover:text-ink",
          )}
        >
          {item.label}
          {item.count !== undefined && <span className="tabular text-xs opacity-80">{item.count}</span>}
        </Link>
      ))}
    </nav>
  );
}
