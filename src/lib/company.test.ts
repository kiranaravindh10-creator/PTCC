import { describe, expect, it } from "vitest";
import { normalizeCompanyName } from "./company";
import { formatInr, formatInrShort, parseRupeesToPaise } from "./money";

describe("normalizeCompanyName", () => {
  it.each([
    ["ABC Engineering", "abc engineering"],
    ["M/s. ABC Engineering Pvt. Ltd.", "abc engineering"],
    ["ABC ENGINEERING PRIVATE LIMITED", "abc engineering"],
    ["Sri Lakshmi Hydraulics & Co.", "sri lakshmi hydraulics"],
    ["Marks & Spencer", "marks and spencer"],
    ["Kaveri Pharma Labs LLP", "kaveri pharma labs"],
    ["The Gauge Company", "the gauge"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeCompanyName(input)).toBe(expected);
  });

  it("keeps a name that is only a legal-form word", () => {
    expect(normalizeCompanyName("Limited")).toBe("limited");
  });
});

describe("money", () => {
  it("formats paise in Indian style", () => {
    expect(formatInr(12_500_000)).toBe("₹1,25,000");
    expect(formatInr(12_550)).toBe("₹125.5");
    expect(formatInrShort(124_000_000)).toBe("₹12.4 L");
    expect(formatInrShort(1_200_000_000)).toBe("₹1.2 Cr");
  });

  it("parses typed rupee amounts", () => {
    expect(parseRupeesToPaise("25,000")).toBe(2_500_000);
    expect(parseRupeesToPaise("₹ 1,25,000.50")).toBe(12_500_050);
    expect(parseRupeesToPaise("Rs. 99.9")).toBe(9_990);
    expect(parseRupeesToPaise("-5")).toBeNull();
    expect(parseRupeesToPaise("abc")).toBeNull();
    expect(parseRupeesToPaise("1.234")).toBeNull();
  });
});
