"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { requireContext } from "@/server/auth/current";
import { markAllNotificationsRead, markNotificationRead } from "./service";

/** Marks a notification read and opens what it points to. The target page re-checks access. */
export async function openNotificationAction(formData: FormData): Promise<void> {
  const ctx = await requireContext();
  const id = String(formData.get("id") ?? "");
  const result = /^[0-9a-f-]{36}$/i.test(id) ? await markNotificationRead(ctx, id) : null;
  const href = result?.href;
  if (href && href.startsWith("/") && !href.startsWith("//")) redirect(href);
  refresh();
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const ctx = await requireContext();
  await markAllNotificationsRead(ctx);
  refresh();
}
