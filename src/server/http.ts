import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { AppError, ForbiddenError, NotFoundError, NotImplementedError, RateLimitError, ValidationError } from "./errors";

/**
 * Helpers for JSON Route Handlers. Server Actions get an Origin check from Next.js; Route
 * Handlers that change data must do it themselves (the session cookie is also SameSite=Lax).
 */

/** True when a state-changing request comes from our own pages. */
export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return host !== null && new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Reads a request body, but never more than `limit` bytes: reading stops as soon as the body
 * passes the limit, whatever Content-Length says — or if it says nothing. Returns null when the
 * body is too large, and throws if it can't be read (e.g. the client went away). The reader is
 * always released. The rest of a too-large body is left unread: answer with `Connection: close`
 * so the server drops the connection instead of draining it.
 */
export async function readBodyWithin(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) return null;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** Maps a service error to a JSON response; anything unexpected is re-thrown. */
export function errorResponse(error: unknown): NextResponse {
  const headers = { "Cache-Control": "no-store" };
  if (error instanceof ValidationError) {
    return NextResponse.json({ error: error.message, fieldErrors: error.fieldErrors }, { status: 400, headers });
  }
  if (error instanceof ForbiddenError) return NextResponse.json({ error: error.message }, { status: 403, headers });
  if (error instanceof NotFoundError) return NextResponse.json({ error: error.message }, { status: 404, headers });
  if (error instanceof RateLimitError) return NextResponse.json({ error: error.message }, { status: 429, headers });
  if (error instanceof NotImplementedError) return NextResponse.json({ error: error.message }, { status: 503, headers });
  if (error instanceof AppError) return NextResponse.json({ error: error.message }, { status: 409, headers });
  throw error;
}
