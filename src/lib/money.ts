/**
 * Money is stored as integer paise (₹1 = 100) and shown in Indian format.
 * docs/UX_PRINCIPLES.md — Indian formats.
 */

const exact = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2, minimumFractionDigits: 0 });

/** 12500000 → "₹1,25,000"; 12550 → "₹125.5" */
export function formatInr(paise: number): string {
  return exact.format(paise / 100);
}

/** Summary form for large figures: ₹12.4 L, ₹1.2 Cr. */
export function formatInrShort(paise: number): string {
  const rupees = paise / 100;
  if (Math.abs(rupees) >= 1_00_00_000) return `₹${trim(rupees / 1_00_00_000)} Cr`;
  if (Math.abs(rupees) >= 1_00_000) return `₹${trim(rupees / 1_00_000)} L`;
  return formatInr(paise);
}

function trim(value: number): string {
  return value.toFixed(value >= 100 ? 0 : 1).replace(/\.0$/, "");
}

/**
 * Parses what people type for an amount in rupees — "25,000", "₹ 1,25,000.50", "2500" —
 * into paise. Returns null when it isn't a valid non-negative amount.
 */
export function parseRupeesToPaise(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, "").replace(/^rs\.?/i, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
