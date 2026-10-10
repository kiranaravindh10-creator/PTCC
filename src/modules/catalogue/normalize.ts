/**
 * Pure helpers that turn scope rows (as printed) into catalogue structure.
 * Nothing here invents or "corrects" scope content: stored text stays as printed; these
 * functions only split the Discipline/Group column and derive display labels and search keys.
 */

/**
 * Disciplines that appear in PTCC's scope documents. Derived from the documents, not from
 * general knowledge: an unknown discipline makes the import fail so a person can look at it.
 */
const DISCIPLINE_PATTERN = /^(ELECTRO-\s?TECHNICAL|MECHANICAL|THERMAL|FLUID FLOW)-\s+(.+)$/;

export type DisciplineGroup = { discipline: string; group: string };

/** "ELECTRO- TECHNICAL- DIRECT CURRENT (Source)" → { "ELECTRO-TECHNICAL", "DIRECT CURRENT (Source)" } */
export function splitDisciplineGroup(value: string): DisciplineGroup | null {
  const match = DISCIPLINE_PATTERN.exec(value.trim());
  if (!match) return null;
  return { discipline: match[1]!.replace(/-\s+/, "-"), group: match[2]!.trim() };
}

/** Abbreviations that must stay upper-case in labels (seen in the scope). */
const KEEP_UPPER = new Set(["UTM"]);

/**
 * Sentence-case display label for a scope heading (the stored name keeps the printed text):
 * "UTM, TENSION CREEP AND TORSION TESTING MACHINE" → "UTM, tension creep and torsion testing machine"
 * "Alternating Current (< 1 GHz) (Source)"        → "Alternating current (< 1 GHz) (source)"
 * Words in capitals or capitalised are lowered; abbreviations and units with inner capitals
 * ("GHz") are kept.
 */
export function scopeLabel(value: string): string {
  const lowered = value
    .split(/(\s+)/)
    .map((word) => {
      const letters = word.replace(/[^A-Za-z]/g, "");
      if (letters.length < 2 || KEEP_UPPER.has(letters)) return word;
      const allCaps = letters === letters.toUpperCase();
      const capitalised = letters[0] === letters[0]!.toUpperCase() && letters.slice(1) === letters.slice(1).toLowerCase();
      return allCaps || capitalised ? word.toLowerCase() : word;
    })
    .join("");
  const first = lowered.search(/[A-Za-z]/);
  return first === -1 ? lowered : lowered.slice(0, first) + lowered.charAt(first).toUpperCase() + lowered.slice(first + 1);
}

/** Lower-cased, single-spaced text used for search. */
export function searchTextOf(parts: readonly (string | null | undefined)[]): string {
  return parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Letters and digits only — tolerant of words wrapped across lines in the source ("Veloci ty"). */
export function compact(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Splits a search query into tokens. Very short tokens are dropped; simple plurals also
 * match their singular ("gauges" finds "gauge").
 */
export function queryTokens(query: string): string[][] {
  return query
    .toLowerCase()
    .split(/[\s,/;:()]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .map((token) => (token.length > 3 && token.endsWith("s") ? [token, token.slice(0, -1)] : [token]));
}
