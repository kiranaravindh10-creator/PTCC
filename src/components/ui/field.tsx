import { CircleAlert } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/format";

/**
 * Form controls. Labels sit above fields; errors sit under them, linked with
 * aria-describedby. Text is 16px on phones so iOS doesn't zoom on focus.
 */

const control =
  "block w-full rounded-control border border-line-strong bg-surface px-3 text-base text-ink " +
  "placeholder:text-ink-subtle hover:border-ink-subtle focus:border-brand-500 focus:outline-none " +
  "focus:ring-2 focus:ring-brand-500/25 focus-visible:outline-none disabled:bg-subtle disabled:text-ink-muted " +
  "aria-[invalid=true]:border-danger-700 aria-[invalid=true]:focus:ring-danger-700/20";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(control, "h-11 lg:h-10", className)} {...props} />;
}

export function Textarea({ className, rows = 3, ...props }: ComponentProps<"textarea">) {
  return <textarea rows={rows} className={cn(control, "min-h-20 py-2.5", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return (
    <select
      className={cn(
        control,
        "h-11 appearance-none bg-[length:16px] bg-[right_0.75rem_center] bg-no-repeat pr-10 lg:h-10",
        "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%235b5f66' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]",
        className,
      )}
      {...props}
    />
  );
}

type FieldProps = {
  /** id of the control inside; used to link label, hint and error. */
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  className?: string;
  children: ReactNode;
};

export function Field({ id, label, hint, error, optional, className, children }: FieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink">
        {label}
        {optional && <span className="font-normal text-ink-subtle"> (optional)</span>}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-sm text-ink-muted">
          {hint}
        </p>
      )}
      <FieldError id={id} error={error} />
    </div>
  );
}

export function FieldError({ id, error }: { id: string; error?: string }) {
  if (!error) return null;
  return (
    <p id={`${id}-error`} className="flex items-start gap-1.5 text-sm text-danger-700" role="alert">
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      {error}
    </p>
  );
}

/** Props that connect a control to its Field's hint and error. */
export function describedBy(id: string, error?: string, hint?: boolean) {
  const ids = [error ? `${id}-error` : null, hint && !error ? `${id}-hint` : null].filter(Boolean);
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": ids.length ? ids.join(" ") : undefined,
  } as const;
}

type ChoiceOption = { value: string; label: string };

/**
 * A small set of visible options (≤ 5) — better than a dropdown.
 * Native radio inputs, so it works without JavaScript and with the keyboard.
 */
export function Choice({
  name,
  legend,
  options,
  defaultValue,
  value,
  onChange,
  error,
}: {
  name: string;
  legend: string;
  options: readonly ChoiceOption[];
  defaultValue?: string;
  /** Controlled use: the selected value, with onChange. */
  value?: string;
  onChange?: (value: string) => void;
  error?: string;
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1.5 text-sm font-medium text-ink">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option.value} className="relative">
            <input
              type="radio"
              name={name}
              value={option.value}
              {...(value !== undefined
                ? { checked: option.value === value, onChange: () => onChange?.(option.value) }
                : { defaultChecked: option.value === defaultValue })}
              className="peer absolute inset-0 cursor-pointer opacity-0"
            />
            <span
              className={cn(
                "inline-flex h-10 items-center rounded-full border border-line-strong bg-surface px-4 text-sm font-medium text-ink-muted",
                "transition-colors duration-150 peer-hover:border-ink-subtle peer-checked:border-brand-600 peer-checked:bg-brand-50 peer-checked:text-brand-700",
                "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-500 lg:h-9",
              )}
            >
              {option.label}
            </span>
          </label>
        ))}
      </div>
      <FieldError id={name} error={error} />
    </fieldset>
  );
}
