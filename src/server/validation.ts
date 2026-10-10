import { z } from "zod";
import { isIsoDate, toHourMinute } from "@/lib/time";
import { normalizePhone } from "@/lib/phone";
import { ValidationError } from "./errors";

/**
 * Parses untrusted input with a Zod schema. On failure throws a ValidationError whose
 * `fieldErrors` hold the first message for each field — ready to show under inputs.
 */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const fieldErrors: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "form";
    fieldErrors[key] ??= issue.message;
  }
  throw new ValidationError("Please check the highlighted fields.", fieldErrors);
}

/** Converts FormData to a plain object of strings (repeated keys become arrays). */
export function formDataToObject(formData: FormData): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION")) continue; // React/Next internals
    if (typeof value !== "string") continue;
    const existing = result[key];
    if (existing === undefined) result[key] = value;
    else result[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return result;
}

// ─── Reusable field schemas ────────────────────────────────────────────────

/** Trimmed text; empty becomes undefined. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters.`)
    .optional()
    .transform((value) => (value ? value : undefined));

export const requiredText = (max: number, message = "This is required.") =>
  z.string({ error: message }).trim().min(1, message).max(max, `Keep this under ${max} characters.`);

export const optionalUuid = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined))
  .pipe(z.uuid({ error: "Choose a valid option." }).optional());

export const uuidField = z.uuid({ error: "Choose a valid option." });

export const optionalIsoDate = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? value : undefined))
  .refine((value) => value === undefined || isIsoDate(value), "Enter a valid date.");

export const optionalTime = z
  .string()
  .trim()
  .optional()
  .transform((value) => (value ? (toHourMinute(value) ?? "invalid") : undefined))
  .refine((value) => value === undefined || /^([01]\d|2[0-3]):[0-5]\d$/.test(value), "Enter a valid time.");

export const optionalPhone = z
  .string()
  .trim()
  .optional()
  .transform((value, ctx) => {
    if (!value) return undefined;
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({ code: "custom", message: "Enter a valid phone number, e.g. 98765 43210." });
      return z.NEVER;
    }
    return normalized;
  });

export const requiredPhone = z
  .string({ error: "Enter a phone number." })
  .trim()
  .min(1, "Enter a phone number.")
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({ code: "custom", message: "Enter a valid phone number, e.g. 98765 43210." });
      return z.NEVER;
    }
    return normalized;
  });

export const optionalEmail = z
  .string()
  .trim()
  .toLowerCase()
  .optional()
  .transform((value) => (value ? value : undefined))
  .pipe(z.email({ error: "Enter a valid email address." }).optional());
