import { NextResponse, type NextRequest } from "next/server";
import { getContextOrNull } from "@/server/auth/current";
import { errorResponse, isSameOrigin, readBodyWithin } from "@/server/http";
import { MAX_AUDIO_BYTES, MAX_IMAGE_BYTES, startCapture } from "@/modules/leads/capture-service";

/**
 * Starts an AI-assisted lead capture: a photo, a recording or a typed description in, a
 * DRAFT for the employee to review out. Never creates a lead (docs/SYSTEM_ARCHITECTURE.md §7).
 * The photo or recording is checked and fingerprinted, then dropped — it is not stored.
 *
 * The body is limited WHILE it is read, with or without Content-Length: reading stops at
 * MAX_BODY_BYTES and the request is refused with 413. The proxy skips this route (src/proxy.ts),
 * so the upload streams straight here instead of being buffered by Next.js first. Refusals that
 * leave the upload unread close the connection rather than drain it.
 */
const MAX_BODY_BYTES = Math.max(MAX_IMAGE_BYTES, MAX_AUDIO_BYTES) + 512 * 1024; // the file + the other form fields
const CLOSE = { Connection: "close" };

export async function POST(request: NextRequest) {
  const ctx = await getContextOrNull();
  if (!ctx) return NextResponse.json({ error: "Not signed in" }, { status: 401, headers: CLOSE });
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Not allowed" }, { status: 403, headers: CLOSE });
  const tooLarge = () => NextResponse.json({ error: "The file is too large." }, { status: 413, headers: CLOSE });
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return tooLarge();
  let form: FormData;
  try {
    const body = await readBodyWithin(request, MAX_BODY_BYTES);
    if (!body) return tooLarge();
    form = await new Response(body, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return NextResponse.json({ error: "The upload couldn't be read. Try again." }, { status: 400 });
  }
  const value = (key: string) => {
    const entry = form.get(key);
    return typeof entry === "string" && entry !== "" ? entry : undefined;
  };
  const upload = form.get("file");
  try {
    const file =
      upload instanceof File && upload.size > 0 ? { bytes: new Uint8Array(await upload.arrayBuffer()), type: upload.type } : null;
    const result = await startCapture(ctx, {
      method: value("method") ?? "",
      language: value("language"),
      sample: value("sample"),
      text: value("text"),
      file,
    });
    return NextResponse.json(result, { status: result.status === "failed" ? 422 : 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
