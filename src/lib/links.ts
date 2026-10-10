/**
 * Deep links that hand off to the phone's own apps — no copying numbers or addresses.
 * These need no API keys. Route planning with the Google Maps Platform APIs arrives in
 * Phase 4 (docs/SYSTEM_ARCHITECTURE.md §8).
 */

import { isIndianMobile } from "./phone";

export function telHref(e164: string): string {
  return `tel:${e164}`;
}

/** WhatsApp click-to-chat. Only offered for mobile numbers (landlines are rarely on WhatsApp). */
export function whatsappHref(e164: string, text?: string): string | null {
  if (!e164.startsWith("+")) return null;
  if (e164.startsWith("+91") && !isIndianMobile(e164)) return null;
  const base = `https://wa.me/${e164.slice(1)}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

export type Destination = {
  latitude?: string | number | null;
  longitude?: string | number | null;
  address?: string | null;
};

function destinationQuery(destination: Destination): string | null {
  const { latitude, longitude, address } = destination;
  if (latitude != null && longitude != null && latitude !== "" && longitude !== "") {
    return `${Number(latitude)},${Number(longitude)}`;
  }
  const text = address?.trim();
  return text ? text : null;
}

/** Opens Google Maps navigation to the destination (app on phones, web on desktop). */
export function mapsDirectionsHref(destination: Destination): string | null {
  const query = destinationQuery(destination);
  if (!query) return null;
  const params = new URLSearchParams({ api: "1", destination: query, travelmode: "driving" });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
