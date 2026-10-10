/**
 * Company-name normalisation for duplicate detection: one company must have ONE record,
 * used by every department (docs/PRODUCT_ARCHITECTURE.md). Only used for matching —
 * the name people typed is what is stored and shown.
 */

const LEGAL_FORM_WORDS = new Set([
  "pvt",
  "private",
  "ltd",
  "limited",
  "llp",
  "inc",
  "corp",
  "corporation",
  "co",
  "company",
]);

/** "M/s. ABC Engineering Pvt. Ltd." → "abc engineering" */
export function normalizeCompanyName(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words[0] === "m" && words[1] === "s") words.splice(0, 2); // "M/s"
  let strippedLegalForm = false;
  while (words.length > 1 && LEGAL_FORM_WORDS.has(words[words.length - 1]!)) {
    words.pop();
    strippedLegalForm = true;
  }
  // "… & Co." leaves a dangling "and"
  if (strippedLegalForm && words.length > 1 && words[words.length - 1] === "and") words.pop();
  return words.join(" ");
}
