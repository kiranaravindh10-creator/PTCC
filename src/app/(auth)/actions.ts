"use server";

import { redirect } from "next/navigation";
import type { ActionState } from "@/server/action-result";
import { writeAudit } from "@/server/audit";
import { clearSessionCookie, getActor, getRequestMeta, getSessionId, setSessionCookie } from "@/server/auth/current";
import { deleteSession } from "@/server/auth/session";
import { signIn } from "@/server/auth/sign-in";
import { getDb } from "@/server/db/client";

/** Only same-site paths are allowed as a post-sign-in destination (no open redirects). */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

export async function signInAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const identifier = String(formData.get("identifier") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const values = { identifier };

  const fieldErrors: Record<string, string> = {};
  if (!identifier) fieldErrors.identifier = "Enter your mobile number or email.";
  if (!password) fieldErrors.password = "Enter your password.";
  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", message: "Please fill in both fields.", fieldErrors, values };
  }

  const result = await signIn(getDb(), { identifier, password }, await getRequestMeta());
  if (!result.ok) {
    return {
      status: "error",
      message:
        result.reason === "locked"
          ? "Too many unsuccessful attempts. Please wait 15 minutes, or ask your administrator to reset your password."
          : "That mobile number or email and password don't match. Please try again.",
      values,
    };
  }

  await setSessionCookie(result.token);
  redirect(safeNext(formData.get("next")));
}

export async function signOutAction(): Promise<void> {
  const [actor, sessionId, meta] = await Promise.all([getActor(), getSessionId(), getRequestMeta()]);
  if (sessionId) {
    const db = getDb();
    await deleteSession(db, sessionId);
    if (actor) {
      await writeAudit(db, { actorId: actor.id, action: "auth.logout", entityType: "user", entityId: actor.id, meta });
    }
  }
  await clearSessionCookie();
  redirect("/login");
}
