import "server-only";
import type { CaptureProviders } from "@/modules/leads/capture";
import { NotImplementedError } from "@/server/errors";

/**
 * AI providers for lead capture — docs/SYSTEM_ARCHITECTURE.md §7. NOT CONNECTED.
 *
 * The interfaces, validation and review flow live in src/modules/leads/capture.ts. This is
 * where real providers will be wired in once PTCC chooses them:
 * - speech-to-text that handles English, Kannada and Hindi (and a mix of them);
 * - OCR for visiting cards and enquiry letters;
 * - extraction of lead fields from the recognised text.
 * Customer names and phone numbers are personal data, so the providers (and where they
 * process data) need PTCC's approval before anything is connected. Keys will come from
 * environment variables, never from code.
 *
 * Until then every call fails with a clear message, and no screen offers AI capture.
 */

const notConnected = (what: string) => new NotImplementedError(`${what} isn't connected yet. Add the lead by typing it in.`);

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
