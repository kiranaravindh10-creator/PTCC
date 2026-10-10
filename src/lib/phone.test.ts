import { describe, expect, it } from "vitest";
import { whatsappHref, mapsDirectionsHref } from "./links";
import { formatPhone, isIndianMobile, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it.each([
    ["98765 43210", "+919876543210"],
    ["+91 98765-43210", "+919876543210"],
    ["09876543210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["0091 98765 43210", "+919876543210"],
    ["080 2345 6789", "+918023456789"],
    ["011 2345 6789", "+911123456789"],
    ["+44 20 7946 0958", "+442079460958"],
  ])("normalises %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["", "12345", "98765", "+91 98765", "abc"])("rejects %j", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe("formatPhone", () => {
  it("shows Indian mobiles as 5 + 5 digits", () => {
    expect(formatPhone("+919876543210")).toBe("98765 43210");
  });
  it("shows numbers that cannot be mobiles as landlines with a leading zero", () => {
    expect(formatPhone("+911123456789")).toBe("011 2345 6789");
  });
  it("recognises mobile numbers", () => {
    expect(isIndianMobile("+919876543210")).toBe(true);
    expect(isIndianMobile("+911123456789")).toBe(false);
    // Bengaluru landlines (080…) share digits with the 80xxx mobile series; once the
    // trunk 0 is dropped they are indistinguishable, so they are treated as possibly mobile.
    expect(isIndianMobile("+918023456789")).toBe(true);
  });
});

describe("deep links", () => {
  it("offers WhatsApp only for mobiles", () => {
    expect(whatsappHref("+919876543210")).toBe("https://wa.me/919876543210");
    expect(whatsappHref("+911123456789")).toBeNull();
  });

  it("prefers coordinates for navigation, falling back to the address", () => {
    expect(mapsDirectionsHref({ latitude: "13.028500", longitude: "77.519700", address: "Peenya" })).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=13.0285%2C77.5197&travelmode=driving",
    );
    expect(mapsDirectionsHref({ address: "Peenya Industrial Area, Bengaluru" })).toContain(
      "destination=Peenya+Industrial+Area%2C+Bengaluru",
    );
    expect(mapsDirectionsHref({})).toBeNull();
  });
});
