import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import type { Actor } from "../access/actor";
import { loadActor } from "../access/load";
import type { Ctx, RequestMeta } from "../context";
import { getDb } from "../db/client";
import { SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "./cookie";
import { validateSessionToken } from "./session";

/**
 * The Data Access Layer entry point: who is making this request?
 * Pages, layouts and server actions call these — never read the cookie directly.
 */

export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, SESSION_COOKIE_OPTIONS);
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

type CurrentSession = { actor: Actor; sessionId: string };

/**
 * Resolved once per request (React cache), however many components ask.
 * `connection()`: session checks read the clock and write to the database (sliding
 * expiry), so they must run for a real request — never during prerendering or caching.
 */
const currentSession = cache(async (): Promise<CurrentSession | null> => {
  await connection();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = getDb();
  const session = await validateSessionToken(db, token);
  if (!session) return null;
  const actor = await loadActor(db, session.userId);
  return actor ? { actor, sessionId: session.sessionId } : null;
});

export async function getActor(): Promise<Actor | null> {
  return (await currentSession())?.actor ?? null;
}

export async function getSessionId(): Promise<string | null> {
  return (await currentSession())?.sessionId ?? null;
}

/**
 * Returns the signed-in actor or redirects to sign-in. People who must choose a new
 * password are sent to do that first.
 */
export async function requireActor(options: { allowPasswordChange?: boolean } = {}): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.mustChangePassword && !options.allowPasswordChange) redirect("/account/password");
  return actor;
}

export const getRequestMeta = cache(async (): Promise<RequestMeta> => {
  const h = await headers();
  // Behind Vercel or a reverse proxy, the first X-Forwarded-For entry is the client.
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ip: forwarded || h.get("x-real-ip") || null,
    userAgent: h.get("user-agent"),
  };
});

/** Everything a module function needs to act for the current person. */
export async function requireContext(options: { allowPasswordChange?: boolean } = {}): Promise<Ctx> {
  const actor = await requireActor(options);
  return { db: getDb(), actor, meta: await getRequestMeta(), now: new Date() };
}

/**
 * For Route Handlers (JSON APIs): the context, or null when not signed in — the handler
 * answers 401 instead of redirecting. People who must change their password get null too.
 */
export async function getContextOrNull(): Promise<Ctx | null> {
  const actor = await getActor();
  if (!actor || actor.mustChangePassword) return null;
  return { db: getDb(), actor, meta: await getRequestMeta(), now: new Date() };
}
