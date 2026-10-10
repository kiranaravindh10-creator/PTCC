/**
 * Session cookie settings, shared by the auth layer and proxy.ts.
 * Kept free of database and `server-only` imports so the proxy stays lightweight.
 */

export const SESSION_COOKIE = "ptcc_session";

/** Matches SESSION_DURATION_MS in session.ts (30 days). */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
} as const;
