import { Construction } from "lucide-react";
import { PageHeader, Panel } from "@/components/ui/display";

/**
 * Honest placeholder for a module that is designed but not built yet
 * (docs/UX_PRINCIPLES.md — "Honest interface"). No fake data.
 */
export function PlannedModule({
  title,
  phase,
  summary,
  features,
  examples,
}: {
  title: string;
  phase: number;
  summary: string;
  features: string[];
  examples?: { heading: string; items: string[] };
}) {
  return (
    <div className="max-w-2xl">
      <PageHeader title={title} description={summary} />
      <Panel className="p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-subtle text-ink-muted">
            <Construction className="size-[18px]" strokeWidth={1.75} aria-hidden />
          </span>
          <div className="space-y-4">
            <div>
              <p className="font-medium">Not built yet — planned for Phase {phase}</p>
              <p className="text-sm text-ink-muted">This is what it will do:</p>
            </div>
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink">
              {features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
            {examples && (
              <div>
                <p className="text-sm font-medium">{examples.heading}</p>
                <ul className="mt-2 space-y-1.5">
                  {examples.items.map((item) => (
                    <li key={item} className="rounded-control bg-subtle px-3 py-2 text-sm text-ink-muted">
                      “{item}”
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
