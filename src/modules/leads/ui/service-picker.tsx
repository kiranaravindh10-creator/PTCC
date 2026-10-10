"use client";

import { BadgeCheck, Plus, Search, TriangleAlert, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/lib/format";

/**
 * Search PTCC's accredited scope and pick services — so nobody has to remember hundreds of
 * calibrations. Availability is shown per branch; nothing outside the scope is ever offered
 * as accredited.
 */

export type ScopeEntryResult = {
  id: string;
  measurandOrInstrument: string;
  method: string;
  rangeText: string;
  cmcText: string;
  facilityType: "permanent" | "site";
  groupLabel: string;
  certificateNumber: string;
  branchId: string | null;
  branchName: string | null;
};

type SearchGroup = { instrument: string; groupLabel: string; disciplineLabel: string; entries: ScopeEntryResult[] };

const FACILITY = { permanent: "At lab", site: "At customer site" } as const;

/** Debounced scope search. Results belong to `query`; while they're for an older query, it's loading. */
function useScopeSearch(input: string) {
  const query = input.trim();
  const [result, setResult] = useState<{ query: string; groups: SearchGroup[]; error: string | null }>({
    query: "",
    groups: [],
    error: null,
  });
  useEffect(() => {
    if (query.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/catalogue/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (!response.ok) throw new Error("search failed");
        const data = (await response.json()) as { groups: SearchGroup[] };
        setResult({ query, groups: data.groups, error: null });
      } catch (error) {
        if ((error as Error).name !== "AbortError") {
          setResult({ query, groups: [], error: "Couldn't search the scope. Check your connection and try again." });
        }
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  if (query.length < 2) return { query, groups: [], loading: false, error: null };
  const loading = result.query !== query;
  return { ...result, error: loading ? null : result.error, loading };
}

export function ServiceSearch({
  branchId,
  branchName,
  onPick,
  onAddText,
  pickLabel = "Add",
}: {
  /** The lead's branch, if known — its rows are listed first and marked. */
  branchId: string | null;
  branchName: string | null;
  /** Without onPick the list is read-only (browsing the scope). */
  onPick?: (entry: ScopeEntryResult) => void;
  onAddText?: (text: string) => void;
  pickLabel?: string;
}) {
  const inputId = useId();
  const [query, setQuery] = useState("");
  const { groups, loading, error, query: searched } = useScopeSearch(query);
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="sr-only">
        Search PTCC&apos;s scope
      </label>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden />
        <input
          id={inputId}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
          placeholder={`Search PTCC's scope, e.g. "pressure gauge"`}
          autoComplete="off"
          className="block h-11 w-full rounded-control border border-line-strong bg-surface pr-3 pl-9 text-base placeholder:text-ink-subtle focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25 focus:outline-none lg:h-10"
        />
      </div>

      {loading && <p className="px-1 text-sm text-ink-muted">Searching…</p>}
      {error && <p className="px-1 text-sm text-danger-700">{error}</p>}

      {!loading && !error && searched.length >= 2 && groups.length === 0 && (
        <div className="rounded-panel border border-warning-700/25 bg-warning-50 px-3 py-2.5 text-sm text-warning-700">
          <p className="flex items-center gap-1.5 font-medium">
            <TriangleAlert className="size-4" aria-hidden />
            Not found in PTCC&apos;s accredited scope
          </p>
          <p className="mt-0.5 text-ink">Scope not confirmed — verify with PTCC before promising this calibration.</p>
          {onAddText && (
            <button type="button" onClick={() => onAddText(searched)} className={buttonClasses("secondary", "sm", "mt-2")}>
              <Plus aria-hidden />
              Add “{searched}” as text (scope not confirmed)
            </button>
          )}
        </div>
      )}

      {groups.length > 0 && (
        <ul className="max-h-96 divide-y divide-line overflow-y-auto rounded-panel border border-line bg-surface">
          {groups.map((group) => {
            const key = `${group.groupLabel}|${group.instrument}`;
            const entries = [...group.entries].sort(
              (a, b) => Number(b.branchId === branchId) - Number(a.branchId === branchId) || (a.branchName ?? "").localeCompare(b.branchName ?? ""),
            );
            const visible = expanded === key ? entries : entries.slice(0, 3);
            const atBranch = branchId ? entries.some((e) => e.branchId === branchId) : null;
            return (
              <li key={key} className="px-3 py-2.5">
                <p className="text-sm font-medium text-ink">{group.instrument}</p>
                <p className="text-xs text-ink-muted">
                  {group.disciplineLabel} · {group.groupLabel}
                  {atBranch === false && branchName && (
                    <span className="font-medium text-warning-700"> · Not in {branchName}&apos;s scope</span>
                  )}
                </p>
                <ul className="mt-2 space-y-1">
                  {visible.map((entry) => {
                    const here = branchId !== null && entry.branchId === branchId;
                    return (
                      <li key={entry.id} className="flex items-center gap-2">
                        <div className={cn("min-w-0 flex-1 text-xs", here ? "text-ink" : "text-ink-muted")}>
                          <span className={cn("font-medium", here && "text-success-700")}>
                            {here && <BadgeCheck className="mr-0.5 inline size-3.5 align-[-2px]" aria-hidden />}
                            {entry.branchName ?? "Branch needs verification"}
                          </span>
                          {" · "}
                          {FACILITY[entry.facilityType]} · {entry.rangeText} · CMC ±{entry.cmcText}
                        </div>
                        {onPick && (
                          <button
                            type="button"
                            onClick={() => onPick(entry)}
                            className={buttonClasses("ghost", "sm", "h-8 shrink-0 px-2 text-brand-600 lg:h-7")}
                            aria-label={`${pickLabel}: ${entry.measurandOrInstrument}, ${entry.branchName ?? ""}, ${entry.rangeText}`}
                          >
                            {pickLabel}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {entries.length > 3 && (
                  <button
                    type="button"
                    onClick={() => setExpanded(expanded === key ? null : key)}
                    className="mt-1 text-xs font-medium text-brand-600 hover:text-brand-700"
                  >
                    {expanded === key ? "Show fewer" : `Show all ${entries.length} ranges`}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Multi-select for forms: chosen services are submitted as `scopeEntryIds`. */
export function ServiceSelector({
  name = "scopeEntryIds",
  branchId,
  branchName,
}: {
  name?: string;
  branchId: string | null;
  branchName: string | null;
}) {
  const [picked, setPicked] = useState<ScopeEntryResult[]>([]);
  return (
    <div className="space-y-3">
      {picked.length > 0 && (
        <ul className="space-y-2">
          {picked.map((entry) => {
            const here = branchId !== null && entry.branchId === branchId;
            return (
              <li key={entry.id} className="flex items-start gap-2 rounded-panel border border-line bg-surface px-3 py-2">
                <input type="hidden" name={name} value={entry.id} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{entry.measurandOrInstrument}</p>
                  <p className="text-xs text-ink-muted">
                    {entry.branchName} · {FACILITY[entry.facilityType]} · {entry.rangeText} · CMC ±{entry.cmcText}
                  </p>
                  {branchId && !here && (
                    <p className="mt-1 text-xs font-medium text-warning-700">
                      {entry.branchName}&apos;s scope, not {branchName ?? "this branch"}&apos;s — verify with PTCC
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setPicked((current) => current.filter((e) => e.id !== entry.id))}
                  className="flex size-8 shrink-0 items-center justify-center rounded-control text-ink-muted hover:bg-subtle hover:text-ink"
                  aria-label={`Remove ${entry.measurandOrInstrument}`}
                >
                  <X className="size-4" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <ServiceSearch
        branchId={branchId}
        branchName={branchName}
        onPick={(entry) => setPicked((current) => (current.some((e) => e.id === entry.id) ? current : [...current, entry]))}
      />
    </div>
  );
}
