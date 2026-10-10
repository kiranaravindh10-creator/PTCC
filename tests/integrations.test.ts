import { describe, expect, it } from "vitest";
import { prepareLeadDraft } from "@/modules/leads/capture";
import { captureProviders } from "@/server/integrations/ai";
import { tally } from "@/server/integrations/tally";
import { NotImplementedError } from "@/server/errors";

/** External integrations are boundaries only in Phase 2 — they must say so, not pretend. */
describe("integration boundaries", () => {
  it("Tally reports that it is not connected", () => {
    expect(tally.status()).toEqual({ connected: false, reason: expect.stringContaining("kept in Tally") });
  });

  it("AI capture fails clearly instead of producing anything", async () => {
    await expect(
      prepareLeadDraft({ method: "voice", audio: new Uint8Array([1]), mimeType: "audio/webm", languageHint: "kn" }, captureProviders),
    ).rejects.toBeInstanceOf(NotImplementedError);
    await expect(prepareLeadDraft({ method: "photo", image: new Uint8Array([1]), mimeType: "image/jpeg" }, captureProviders)).rejects.toThrow(
      "Photo capture isn't connected yet",
    );
    await expect(prepareLeadDraft({ method: "text", text: "ABC Engineering" }, captureProviders)).rejects.toThrow(
      "Lead extraction isn't connected yet",
    );
  });
});
