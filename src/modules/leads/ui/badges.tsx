import { BadgeCheck, CircleHelp, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/format";
import type { ScopeStatus } from "@/modules/catalogue/status";
import { scopeStatusText } from "@/modules/catalogue/status";
import { STAGE_LABEL, type LeadStage } from "../model";

const stageTone: Record<LeadStage, string> = {
  new: "bg-brand-50 text-brand-700",
  qualification: "bg-subtle text-ink-muted",
  contact: "bg-subtle text-ink-muted",
  follow_up: "bg-subtle text-ink-muted",
  requirement: "bg-subtle text-ink-muted",
  quotation: "bg-teal-50 text-teal-700",
  won: "bg-success-50 text-success-700",
  lost: "bg-subtle text-ink-subtle",
};

export function StagePill({ stage, className }: { stage: LeadStage; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        stageTone[stage],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {STAGE_LABEL[stage]}
    </span>
  );
}

/** Which branch a record belongs to. A missing branch is shown, never hidden. */
export function BranchTag({ name, className }: { name: string | null; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        name ? "border-line text-ink-muted" : "border-warning-700/30 bg-warning-50 text-warning-700",
        className,
      )}
    >
      {name ?? "Needs branch"}
    </span>
  );
}

const toneClasses = {
  success: "bg-success-50 text-success-700",
  warning: "bg-warning-50 text-warning-700",
  danger: "bg-danger-50 text-danger-700",
  neutral: "bg-subtle text-ink-muted",
} as const;

/** Whether a requirement is within PTCC's accredited scope at the lead's branch. */
export function ScopeStatusBadge({ status }: { status: ScopeStatus }) {
  const { label, tone } = scopeStatusText(status);
  const Icon = tone === "success" ? BadgeCheck : tone === "neutral" ? CircleHelp : TriangleAlert;
  return (
    <span className={cn("inline-flex items-start gap-1.5 rounded-control px-2 py-1 text-xs font-medium", toneClasses[tone])}>
      <Icon className="mt-px size-3.5 shrink-0" aria-hidden />
      {label}
    </span>
  );
}
