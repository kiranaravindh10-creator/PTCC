/**
 * Phone numbers are stored in E.164 (`+919876543210`) and shown the way people in
 * India write them (`98765 43210`). See docs/UX_PRINCIPLES.md — Indian formats.
 */

const INDIAN_MOBILE = /^\+91[6-9]\d{9}$/;

/**
 * Normalises user input to E.164. Accepts the common ways Indian numbers are typed:
 * `98765 43210`, `+91 98765-43210`, `09876543210`, `919876543210`, `080 2345 6789`.
 * Returns null when the input cannot be a valid number.
 */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");

  if (hasPlus) {
    if (digits.startsWith("91")) {
      return digits.length === 12 ? `+${digits}` : null;
    }
    // Other countries: accept any plausible E.164 length.
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }

  if (digits.startsWith("0091")) digits = digits.slice(4);
  else if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);

  if (digits.length !== 10 || digits.startsWith("0")) return null;
  return `+91${digits}`;
}

/**
 * True for numbers in the Indian mobile range (+91 6–9…). Note: some landlines with a
 * trunk-stripped STD code (e.g. Bengaluru 080 → 80…) fall in the same range and cannot
 * be told apart, so they are treated as possibly mobile.
 */
export function isIndianMobile(e164: string): boolean {
  return INDIAN_MOBILE.test(e164);
}

/** `+919876543210` → `98765 43210`; Indian landline `+911123456789` → `011 2345 6789`. */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  if (isIndianMobile(e164)) {
    const n = e164.slice(3);
    return `${n.slice(0, 5)} ${n.slice(5)}`;
  }
  if (e164.startsWith("+91") && e164.length === 13) {
    const n = e164.slice(3);
    // STD codes vary in length; this grouping suits the 2–3 digit metro codes PTCC deals with most.
    return `0${n.slice(0, 2)} ${n.slice(2, 6)} ${n.slice(6)}`;
  }
  return e164;
}
