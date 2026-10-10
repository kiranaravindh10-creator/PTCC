import { ChevronDown, CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn, initials } from "@/lib/format";

/** Display primitives — docs/DESIGN_SYSTEM.md §6. */

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 lg:mb-8">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-sm text-ink-muted">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Section({
  title,
  action,
  description,
  children,
  className,
}: {
  title: ReactNode;
  action?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          {description && <p className="text-sm text-ink-muted">{description}</p>}
        </div>
        {action && <div className="shrink-0 text-sm">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** A bordered panel. Surfaces are defined by hairlines, not shadows. */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-panel border border-line bg-surface", className)}>{children}</div>;
}

/** Grouped rows inside one container — the standard list. */
export function List({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ul className={cn("divide-y divide-line overflow-hidden rounded-panel border border-line bg-surface", className)}>
      {children}
    </ul>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-panel border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
      {icon && <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-full bg-subtle text-ink-muted [&_svg]:size-5">{icon}</div>}
      <p className="font-medium text-ink">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

type NoticeTone = "info" | "success" | "warning" | "danger";

const noticeStyles: Record<NoticeTone, { box: string; icon: ReactNode }> = {
  info: { box: "border-brand-200 bg-brand-50 text-brand-700", icon: <Info aria-hidden /> },
  success: { box: "border-success-700/25 bg-success-50 text-success-700", icon: <CircleCheck aria-hidden /> },
  warning: { box: "border-warning-700/25 bg-warning-50 text-warning-700", icon: <TriangleAlert aria-hidden /> },
  danger: { box: "border-danger-700/25 bg-danger-50 text-danger-700", icon: <CircleAlert aria-hidden /> },
};

export function Notice({ tone = "info", title, children }: { tone?: NoticeTone; title?: ReactNode; children?: ReactNode }) {
  const style = noticeStyles[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-panel border px-4 py-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0", style.box)}
    >
      {style.icon}
      <div className="space-y-0.5">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={title ? "text-ink" : undefined}>{children}</div>}
      </div>
    </div>
  );
}

const avatarTones = [
  "bg-brand-50 text-brand-700",
  "bg-teal-50 text-teal-700",
  "bg-warning-50 text-warning-700",
  "bg-accent-50 text-accent-500",
  "bg-success-50 text-success-700",
  "bg-subtle text-ink-muted",
];

/** Initials on a soft tint, stable per person. */
export function Avatar({ name, size = "md" }: { name: string; size?: "sm" | "md" | "lg" }) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const sizes = { sm: "size-7 text-xs", md: "size-9 text-sm", lg: "size-12 text-base" };
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-medium",
        sizes[size],
        avatarTones[hash % avatarTones.length],
      )}
    >
      {initials(name)}
    </span>
  );
}

/** Big number + label (Home). Never more than four in a row. */
export function Stat({ value, label, tone = "default" }: { value: number | string; label: string; tone?: "default" | "danger" | "warning" }) {
  return (
    <div className="min-w-0">
      <div
        className={cn(
          "tabular text-display font-semibold tracking-tight",
          tone === "danger" ? "text-danger-700" : tone === "warning" ? "text-warning-700" : "text-ink",
        )}
      >
        {value}
      </div>
      <div className="truncate text-sm text-ink-muted">{label}</div>
    </div>
  );
}

export function StatRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:flex sm:flex-wrap sm:gap-x-12 sm:[&>*]:min-w-28">{children}</div>
  );
}

/** Progressive disclosure: "Add more details". Native <details>, works without JavaScript. */
export function MoreDetails({
  summary = "Add more details",
  children,
  defaultOpen,
}: {
  summary?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="group" open={defaultOpen}>
      <summary className="inline-flex items-center gap-1.5 rounded-control py-1 text-sm font-medium text-brand-600 hover:text-brand-700">
        <ChevronDown className="size-4 transition-transform duration-150 group-open:rotate-180" aria-hidden />
        {summary}
      </summary>
      <div className="mt-4 space-y-5">{children}</div>
    </details>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-control bg-subtle", className)} />;
}

/** Definition list for facts on detail pages. */
export function Facts({ children }: { children: ReactNode }) {
  return <dl className="divide-y divide-line">{children}</dl>;
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 px-4 py-3 sm:grid-cols-[9rem_1fr] sm:gap-4">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="min-w-0 text-ink">{children}</dd>
    </div>
  );
}
