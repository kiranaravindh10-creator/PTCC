/**
 * Security fix: the capture upload endpoint limits the request body WHILE reading it. With or
 * without Content-Length, reading stops once the body passes the limit and the request is
 * refused with 413 — nothing beyond the limit is buffered. The session and origin checks still
 * come first, and the existing error handling is unchanged.
 *
 * The session lookup and the capture service are replaced by test doubles: this file is about
 * how the endpoint reads the request, not about capture itself (tests/capture.test.ts).
 */
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/capture/route";
import { MAX_AUDIO_BYTES, MAX_IMAGE_BYTES } from "@/modules/leads/capture-limits";
import { startCapture } from "@/modules/leads/capture-service";
import { getContextOrNull } from "@/server/auth/current";
import { ValidationError } from "@/server/errors";
import { readBodyWithin } from "@/server/http";

vi.mock("@/server/auth/current", () => ({ getContextOrNull: vi.fn() }));
vi.mock("@/modules/leads/capture-service", async () => {
  const limits = await vi.importActual<typeof import("@/modules/leads/capture-limits")>("@/modules/leads/capture-limits");
  return { MAX_IMAGE_BYTES: limits.MAX_IMAGE_BYTES, MAX_AUDIO_BYTES: limits.MAX_AUDIO_BYTES, startCapture: vi.fn() };
});

/** The endpoint's limit: the largest file plus room for the other form fields. */
const LIMIT = Math.max(MAX_IMAGE_BYTES, MAX_AUDIO_BYTES) + 512 * 1024;
const CHUNK = 64 * 1024;
const URL = "http://localhost:3000/api/capture";
const SAME_ORIGIN = { origin: "http://localhost:3000", host: "localhost:3000" };
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** A body of `total` bytes, produced in chunks on demand; `seen.bytes` is how much was pulled. */
function countingBody(total: number, chunk = CHUNK) {
  const seen = { bytes: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (seen.bytes >= total) return controller.close();
      const size = Math.min(chunk, total - seen.bytes);
      seen.bytes += size;
      controller.enqueue(new Uint8Array(size).fill(seen.bytes % 251));
    },
  });
  return { stream, seen };
}

/** Streams known bytes in chunks — like a real upload, it carries no length of its own. */
const chunked = (bytes: Uint8Array, chunk = CHUNK) => {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(offset, offset + chunk));
      offset += chunk;
    },
  });
};

const post = (body: ReadableStream<Uint8Array> | null, headers: Record<string, string> = {}) =>
  new NextRequest(URL, { method: "POST", headers: { ...SAME_ORIGIN, ...headers }, body, duplex: "half" } as ConstructorParameters<typeof NextRequest>[1]);

/** A multipart form exactly as a browser would encode it. */
async function multipart(fields: Record<string, string | File>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  const encoded = new Request(URL, { method: "POST", body: form });
  return { bytes: new Uint8Array(await encoded.arrayBuffer()), contentType: encoded.headers.get("content-type")! };
}

describe("reading a body within a limit", () => {
  it("returns the whole body, in order, up to exactly the limit — and nothing at limit + 1", async () => {
    const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 256);
    expect(await readBodyWithin(post(chunked(bytes, 300)), 1000)).toEqual(bytes);
    expect(await readBodyWithin(post(countingBody(1001, 300).stream), 1000)).toBeNull();
    expect(await readBodyWithin(new Request(URL, { method: "POST" }), 1000)).toEqual(new Uint8Array(0));
  });

  it("stops reading as soon as the limit is passed, and releases the stream", async () => {
    const { stream, seen } = countingBody(50 * 1024 * 1024);
    const request = post(stream);
    expect(await readBodyWithin(request, LIMIT)).toBeNull();
    // At most the chunk that crossed the limit and one the stream had queued — not 50 MB.
    expect(seen.bytes).toBeLessThanOrEqual(LIMIT + 2 * CHUNK);
    expect(request.body!.locked).toBe(false);
  });

  it("throws if the upload breaks off, and still releases the stream", async () => {
    let pulls = 0;
    const broken = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulls++ === 0) controller.enqueue(new Uint8Array(10));
        else controller.error(new Error("client went away"));
      },
    });
    const request = post(broken);
    await expect(readBodyWithin(request, LIMIT)).rejects.toThrow("client went away");
    expect(request.body!.locked).toBe(false);
  });
});

describe("POST /api/capture", () => {
  beforeEach(() => {
    vi.mocked(getContextOrNull).mockResolvedValue({} as Awaited<ReturnType<typeof getContextOrNull>>);
    vi.mocked(startCapture)
      .mockReset()
      .mockResolvedValue({ status: "ready", capture: { id: "capture-1" } } as Awaited<ReturnType<typeof startCapture>>);
  });

  it("refuses an oversized body sent without Content-Length: reads only up to the limit, answers 413, closes the connection", async () => {
    const { stream, seen } = countingBody(50 * 1024 * 1024);
    const request = post(stream, { "content-type": "multipart/form-data; boundary=x" });
    expect(request.headers.get("content-length")).toBeNull();
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "The file is too large." });
    expect(response.headers.get("connection")).toBe("close");
    expect(seen.bytes).toBeLessThanOrEqual(LIMIT + 2 * CHUNK);
    expect(startCapture).not.toHaveBeenCalled();
  });

  it("refuses a body that declares an oversized Content-Length before reading any of it", async () => {
    const request = post(countingBody(LIMIT + 1).stream, {
      "content-type": "multipart/form-data; boundary=x",
      "content-length": String(LIMIT + 1),
    });
    const response = await POST(request);
    expect(response.status).toBe(413);
    expect(response.headers.get("connection")).toBe("close");
    expect(request.bodyUsed).toBe(false);
    expect(startCapture).not.toHaveBeenCalled();
  });

  it("accepts a valid body within the limit — the largest allowed photo, with or without Content-Length", async () => {
    const photo = new Uint8Array(MAX_IMAGE_BYTES);
    photo.set([0xff, 0xd8, 0xff, 0xe0]);
    const { bytes, contentType } = await multipart({
      method: "photo",
      sample: "business-card",
      file: new File([photo], "card.jpg", { type: "image/jpeg" }),
    });
    expect(bytes.length).toBeLessThanOrEqual(LIMIT); // the form fields fit in the allowance
    for (const declared of [false, true]) {
      vi.mocked(startCapture).mockClear();
      const length: Record<string, string> = declared ? { "content-length": String(bytes.length) } : {};
      const response = await POST(post(chunked(bytes), { "content-type": contentType, ...length }));
      expect(response.status).toBe(200);
      expect(response.headers.get("connection")).toBeNull();
      const input = vi.mocked(startCapture).mock.calls[0]![1];
      expect(input).toMatchObject({ method: "photo", sample: "business-card", text: undefined, language: undefined });
      expect(input.file!.type).toBe("image/jpeg");
      expect(sha256(input.file!.bytes)).toBe(sha256(photo)); // passed on unchanged
    }
  });

  it("still checks the session and the origin first, without reading the upload", async () => {
    vi.mocked(getContextOrNull).mockResolvedValueOnce(null);
    const anonymous = post(countingBody(1000).stream, { "content-type": "multipart/form-data; boundary=x" });
    const unauthenticated = await POST(anonymous);
    expect(unauthenticated.status).toBe(401);
    expect(anonymous.bodyUsed).toBe(false);

    const foreign = post(countingBody(1000).stream, { origin: "https://elsewhere.example", "content-type": "multipart/form-data; boundary=x" });
    expect((await POST(foreign)).status).toBe(403);
    expect(foreign.bodyUsed).toBe(false);
    expect(startCapture).not.toHaveBeenCalled();
  });

  it("keeps the existing answers: unreadable form 400, invalid input 400, failed reading 422", async () => {
    const garbage = await POST(post(chunked(new TextEncoder().encode("not a form")), { "content-type": "multipart/form-data; boundary=x" }));
    expect(garbage.status).toBe(400);
    expect(await garbage.json()).toEqual({ error: "The upload couldn't be read. Try again." });

    const text = await multipart({ method: "text", text: "Met a buyer, call 98765 43210 tomorrow." });
    vi.mocked(startCapture).mockRejectedValueOnce(new ValidationError("Choose photo, voice or text."));
    expect((await POST(post(chunked(text.bytes), { "content-type": text.contentType }))).status).toBe(400);

    vi.mocked(startCapture).mockResolvedValueOnce({ status: "failed", message: "Nothing was recognised." });
    const failed = await POST(post(chunked(text.bytes), { "content-type": text.contentType }));
    expect(failed.status).toBe(422);
    expect(vi.mocked(startCapture).mock.calls.at(-1)![1]).toMatchObject({ method: "text", text: "Met a buyer, call 98765 43210 tomorrow." });
  });
});
