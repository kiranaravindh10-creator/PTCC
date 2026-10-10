"use client";

import { Building2, Check } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { describedBy, FieldError } from "@/components/ui/field";
import { cn } from "@/lib/format";

/**
 * Company name with suggestions from ALL of PTCC's customers — one company, one record.
 * Picking a suggestion reuses that company (and links it to the branch); typing a new
 * name creates a new company.
 */

type Suggestion = { id: string; name: string; area: string | null; city: string | null; known: boolean };

export type CompanyChoice = { id: string | null; name: string };

export function CompanyPicker({
  defaultId,
  defaultName,
  error,
  onChange,
}: {
  defaultId?: string;
  defaultName?: string;
  error?: string;
  onChange?: (choice: CompanyChoice) => void;
}) {
  const listId = useId();
  const [name, setName] = useState(defaultName ?? "");
  const [chosen, setChosen] = useState<Suggestion | null>(
    defaultId ? { id: defaultId, name: defaultName ?? "", area: null, city: null, known: true } : null,
  );
  const [found, setFound] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const query = chosen ? "" : name.trim();
  const suggestions = query.length < 2 ? [] : found;

  useEffect(() => {
    if (query.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/companies/suggest?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (response.ok) setFound(((await response.json()) as { suggestions: Suggestion[] }).suggestions);
      } catch {
        // Suggestions are a convenience; typing a name still works without them.
      }
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  const choose = (suggestion: Suggestion) => {
    setChosen(suggestion);
    setName(suggestion.name);
    setOpen(false);
    onChange?.({ id: suggestion.id, name: suggestion.name });
  };

  return (
    <div className="space-y-1.5">
      <label htmlFor="companyName" className="block text-sm font-medium">
        Company
      </label>
      <input type="hidden" name="companyId" value={chosen?.id ?? ""} />
      {chosen ? (
        <div className="flex items-center gap-3 rounded-control border border-brand-500 bg-brand-50/50 px-3 py-2">
          <Building2 className="size-4 shrink-0 text-brand-600" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{chosen.name}</p>
            <p className="text-xs text-ink-muted">
              {chosen.known ? "Existing customer" : "Existing PTCC company — it will be added to this branch's customers"}
            </p>
          </div>
          <button
            type="button"
            className="text-sm font-medium text-brand-600 hover:text-brand-700"
            onClick={() => {
              setChosen(null);
              onChange?.({ id: null, name });
            }}
          >
            Change
          </button>
        </div>
      ) : (
        <div className="relative">
          <input
            {...describedBy("companyName", error)}
            name="companyName"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setOpen(true);
              onChange?.({ id: null, name: event.target.value });
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            autoComplete="off"
            role="combobox"
            aria-expanded={open && suggestions.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            placeholder="Start typing — existing customers are suggested"
            className="block h-11 w-full rounded-control border border-line-strong bg-surface px-3 text-base placeholder:text-ink-subtle focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25 focus:outline-none aria-[invalid=true]:border-danger-700 lg:h-10"
          />
          {open && suggestions.length > 0 && (
            <ul
              id={listId}
              role="listbox"
              className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-panel border border-line bg-surface shadow-float"
            >
              {suggestions.map((suggestion) => (
                <li key={suggestion.id} role="option" aria-selected={false}>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(suggestion)}
                    className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-subtle"
                  >
                    <Check className={cn("mt-1 size-3.5 shrink-0", suggestion.known ? "text-success-700" : "text-ink-subtle")} aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{suggestion.name}</span>
                      <span className="block text-xs text-ink-muted">
                        {[suggestion.area, suggestion.city].filter(Boolean).join(", ") || "Address not recorded"}
                        {suggestion.known ? "" : " · Existing PTCC company"}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
              <li className="border-t border-line px-3 py-2 text-xs text-ink-muted">
                Not in the list? Keep typing — a new company will be created.
              </li>
            </ul>
          )}
        </div>
      )}
      <FieldError id="companyName" error={error} />
    </div>
  );
}
