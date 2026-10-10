"use client";

import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { buttonClasses } from "@/components/ui/button";
import { Field, FieldError, Input, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/display";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatInr, parseRupeesToPaise } from "@/lib/money";
import type { ActionState } from "@/server/action-result";
import { createQuotationAction } from "../actions";

const IDLE: ActionState = { status: "idle" };

type Line = { key: number; description: string; quantity: string; unitPrice: string; scopeEntryId: string };

/**
 * A quotation is a list of lines with prices typed by the marketer — PTCC's prices are not
 * stored in the platform. Totals are before tax; invoicing and tax stay in Tally.
 */
export function QuotationForm({
  leadId,
  initialLines,
}: {
  leadId: string;
  initialLines: { description: string; quantity: number | null; scopeEntryId: string | null }[];
}) {
  const [state, formAction] = useActionState(createQuotationAction, IDLE);
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const [lines, setLines] = useState<Line[]>(
    (initialLines.length ? initialLines : [{ description: "", quantity: null, scopeEntryId: null }]).map((line, index) => ({
      key: index,
      description: line.description,
      quantity: line.quantity ? String(line.quantity) : "1",
      unitPrice: "",
      scopeEntryId: line.scopeEntryId ?? "",
    })),
  );
  const update = (key: number, change: Partial<Line>) => setLines((current) => current.map((line) => (line.key === key ? { ...line, ...change } : line)));
  const amounts = lines.map((line) => {
    const price = parseRupeesToPaise(line.unitPrice);
    const quantity = Number(line.quantity);
    return price !== null && Number.isInteger(quantity) && quantity > 0 ? price * quantity : null;
  });
  const total = amounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0);

  return (
    <form action={formAction} className="max-w-3xl space-y-6" noValidate>
      <input type="hidden" name="leadId" value={leadId} />
      {state.status === "error" && <Notice tone="danger">{state.message}</Notice>}

      <fieldset className="space-y-3">
        <legend className="mb-1 text-sm font-medium">Lines</legend>
        <FieldError id="lines" error={errors.lines} />
        {lines.map((line, index) => (
          <div key={line.key} className="grid gap-3 rounded-panel border border-line bg-surface p-3 sm:grid-cols-[1fr_5rem_8rem_7rem_auto] sm:items-end">
            <input type="hidden" name="lineScopeEntryId" value={line.scopeEntryId} />
            <Field id={`desc-${line.key}`} label="Description" error={errors[`lines.${index}.description`]}>
              <Input id={`desc-${line.key}`} name="lineDescription" value={line.description} onChange={(e) => update(line.key, { description: e.target.value })} />
            </Field>
            <Field id={`qty-${line.key}`} label="Qty" error={errors[`lines.${index}.quantity`]}>
              <Input id={`qty-${line.key}`} name="lineQuantity" inputMode="numeric" value={line.quantity} onChange={(e) => update(line.key, { quantity: e.target.value })} />
            </Field>
            <Field id={`price-${line.key}`} label="Price per unit (₹)" error={errors[`lines.${index}.unitPrice`]}>
              <Input
                id={`price-${line.key}`}
                name="lineUnitPrice"
                inputMode="decimal"
                placeholder="e.g. 1,250"
                value={line.unitPrice}
                onChange={(e) => update(line.key, { unitPrice: e.target.value })}
              />
            </Field>
            <div className="text-sm sm:pb-2.5">
              <span className="text-ink-muted sm:hidden">Amount: </span>
              <span className="tabular font-medium">{amounts[index] !== null ? formatInr(amounts[index]!) : "—"}</span>
            </div>
            <button
              type="button"
              disabled={lines.length === 1}
              onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
              className="flex size-10 items-center justify-center justify-self-end rounded-control text-ink-muted hover:bg-subtle hover:text-ink disabled:opacity-30"
              aria-label={`Remove line ${index + 1}`}
            >
              <Trash2 className="size-4" aria-hidden />
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setLines((current) => [...current, { key: Math.max(...current.map((l) => l.key)) + 1, description: "", quantity: "1", unitPrice: "", scopeEntryId: "" }])
          }
          className={buttonClasses("secondary", "sm")}
        >
          <Plus aria-hidden />
          Add line
        </button>
      </fieldset>

      <div className="flex items-baseline justify-between rounded-panel border border-line bg-surface px-4 py-3">
        <span className="text-sm text-ink-muted">Total before tax</span>
        <span className="tabular text-xl font-semibold">{formatInr(total)}</span>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="validUntil" label="Valid until" optional>
          <Input id="validUntil" name="validUntil" type="date" />
        </Field>
      </div>
      <Field id="quotation-notes" label="Notes for the customer" optional>
        <Textarea id="quotation-notes" name="notes" rows={3} placeholder="e.g. Taxes extra as applicable. Pickup and delivery included." />
      </Field>

      <div className="flex flex-wrap gap-3 border-t border-line pt-6">
        <SubmitButton size="lg" pendingLabel="Saving…" className="max-sm:w-full">
          Save quotation
        </SubmitButton>
        <Link href={`/leads/${leadId}`} className={buttonClasses("ghost", "lg", "max-sm:w-full")}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
