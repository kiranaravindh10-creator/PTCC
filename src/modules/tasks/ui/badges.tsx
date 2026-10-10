import { ClipboardList, Package, PackageCheck, Phone, Repeat, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/format";
import { PRIORITY_LABEL, STATUS_LABEL, type TaskKind, type TaskPriority, type TaskStatus } from "../model";

const statusTone: Record<TaskStatus, string> = {
  pending: "bg-warning-50 text-warning-700",
  assigned: "bg-subtle text-ink-muted",
  in_progress: "bg-brand-50 text-brand-700",
  collected: "bg-teal-50 text-teal-700",
  delivered: "bg-success-50 text-success-700",
  completed: "bg-success-50 text-success-700",
  cancelled: "bg-subtle text-ink-subtle",
};

/** Status as text + dot — never colour alone. */
export function StatusPill({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        statusTone[status],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Only high and urgent get a tag; normal and low are the quiet default. */
export function PriorityTag({ priority }: { priority: TaskPriority }) {
  if (priority !== "high" && priority !== "urgent") return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        priority === "urgent" ? "bg-danger-50 text-danger-700" : "bg-warning-50 text-warning-700",
      )}
    >
      {PRIORITY_LABEL[priority]}
    </span>
  );
}

export const KIND_ICON: Record<TaskKind, LucideIcon> = {
  general: ClipboardList,
  call: Phone,
  follow_up: Repeat,
  pickup: Package,
  delivery: PackageCheck,
};

export function KindIcon({ kind, className }: { kind: TaskKind; className?: string }) {
  const Icon = KIND_ICON[kind];
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full bg-subtle text-ink-muted [&_svg]:size-[18px]",
        className,
      )}
    >
      <Icon strokeWidth={1.75} />
    </span>
  );
}
