import type { Actor } from "./access/actor";
import type { Database } from "./db/client";

export type RequestMeta = {
  ip: string | null;
  userAgent: string | null;
};

/**
 * Everything a module query or service needs to act on someone's behalf.
 * Pages, server actions, scripts, tests and (later) Ask PTCC all build a Ctx and call
 * the same functions — so permission checks live in exactly one place.
 */
export type Ctx = {
  db: Database;
  actor: Actor;
  meta: RequestMeta;
  /** "Now" for this request, so all time-based logic agrees (and tests can fix it). */
  now: Date;
};
