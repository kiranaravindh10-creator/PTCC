"use server";

import { redirect } from "next/navigation";
import { getRequestMeta, setSessionCookie } from "@/server/auth/current";
import { signIn } from "@/server/auth/sign-in";
import { getDb } from "@/server/db/client";
import { SAMPLE_PASSWORD, SAMPLE_PEOPLE } from "./sample-accounts";

/** DEVELOPMENT ONLY — signs in as a sample person using the normal password check. */
export async function devSignInAction(formData: FormData): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new Error("Not available.");
  const phone = String(formData.get("phone") ?? "");
  if (!SAMPLE_PEOPLE.some((person) => person.phone === phone)) throw new Error("Unknown sample account.");
  const result = await signIn(getDb(), { identifier: phone, password: SAMPLE_PASSWORD }, await getRequestMeta());
  if (!result.ok) redirect("/login");
  await setSessionCookie(result.token);
  redirect("/");
}
