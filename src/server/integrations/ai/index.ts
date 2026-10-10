import "server-only";
import type { CaptureProviders } from "@/modules/leads/capture";
import { CAPTURE_LANGUAGES, type CaptureLanguage } from "@/modules/leads/model";
import { NotImplementedError } from "@/server/errors";
import { PHOTO_SAMPLES, simulatedProviders, TEXT_SAMPLES, VOICE_SAMPLES } from "./simulated";

/**
 * AI providers for lead capture — docs/SYSTEM_ARCHITECTURE.md §7.
 *
 * NO REAL PROVIDER IS CONNECTED. Selection is by environment variable:
 *   CAPTURE_PROVIDER=simulated  built-in samples, clearly labelled (development and tests;
 *                               the default outside production)
 *   CAPTURE_PROVIDER=off        capture shows "not available yet" (the default in production)
 * Simulated results are refused in production whatever the setting, so employees never see
 * sample data presented as theirs.
 *
 * A real provider (OCR, speech-to-text for English/Kannada/Hindi, extraction) is added as a
 * new mode returning the same CaptureProviders interface — the capture workflow, review screen
 * and lead creation don't change. Customer names, numbers, photos and voices are personal
 * data: a provider (and where it processes data) needs PTCC's approval before it is
 * connected, and its keys come from environment variables — never from code or the browser.
 */

export type CaptureMode = "simulated" | "off";

export function captureMode(env: Record<string, string | undefined> = process.env): CaptureMode {
  if (env.NODE_ENV === "production") return "off";
  return env.CAPTURE_PROVIDER?.trim().toLowerCase() === "off" ? "off" : "simulated";
}

export type CaptureAvailability = {
  mode: CaptureMode;
  /** True when results come from built-in samples. */
  simulated: boolean;
  photo: boolean;
  voice: boolean;
  text: boolean;
};

export function captureAvailability(mode: CaptureMode = captureMode()): CaptureAvailability {
  const on = mode === "simulated";
  return { mode, simulated: on, photo: on, voice: on, text: on };
}

const notConnected = (what: string) =>
  new NotImplementedError(`${what} isn't connected yet. Add the lead with the form instead.`);

/** Providers that refuse every call — used when capture is off. */
export const captureProviders: CaptureProviders = {
  speech: {
    async transcribe() {
      throw notConnected("Voice capture");
    },
  },
  vision: {
    async read() {
      throw notConnected("Photo capture");
    },
  },
  extractor: {
    async extract() {
      throw notConnected("Lead extraction");
    },
  },
};

/** The providers for one capture request. `sample` selects a built-in sample in simulated mode. */
export function providersFor(mode: CaptureMode, options: { sample?: string | null } = {}): CaptureProviders {
  return mode === "simulated" ? simulatedProviders(options) : captureProviders;
}

export type SampleOption = { key: string; label: string; text?: string };

/** The built-in samples, for the capture screen in simulated mode only. */
export function captureSamples(mode: CaptureMode): {
  photo: SampleOption[];
  voice: Record<CaptureLanguage, SampleOption[]>;
  text: SampleOption[];
} | null {
  if (mode !== "simulated") return null;
  return {
    photo: PHOTO_SAMPLES.map(({ key, label }) => ({ key, label })),
    voice: Object.fromEntries(
      CAPTURE_LANGUAGES.map((language) => [language, VOICE_SAMPLES[language].map(({ key, label }) => ({ key, label }))]),
    ) as Record<CaptureLanguage, SampleOption[]>,
    text: TEXT_SAMPLES.map(({ key, label, text }) => ({ key, label, text })),
  };
}
