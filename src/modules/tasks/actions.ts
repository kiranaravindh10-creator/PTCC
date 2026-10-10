"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { actionError, type ActionState } from "@/server/action-result";
import { requireContext } from "@/server/auth/current";
import { formDataToObject } from "@/server/validation";
import { addTaskComment, assignTask, createTask, transitionTask, type CreateTaskInput } from "./service";

/**
 * Form entry points for work. Each one authenticates, hands the raw input to the
 * service (which validates and authorises), then refreshes or redirects.
 */

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

export async function createTaskAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const values = formDataToObject(formData);
  let taskId: string;
  try {
    const ctx = await requireContext();
    ({ id: taskId } = await createTask(ctx, values as unknown as CreateTaskInput));
  } catch (error) {
    return actionError(error, values);
  }
  redirect(`/work/${taskId}?created=1`);
}

export async function transitionTaskAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await transitionTask(ctx, {
      taskId: text(formData, "taskId"),
      action: text(formData, "action"),
      reason: text(formData, "reason") || undefined,
    });
    refresh();
    return { status: "success" };
  } catch (error) {
    return actionError(error, formDataToObject(formData));
  }
}

/**
 * Called when someone taps "Start route": the map opens immediately (it is a link)
 * and this marks the work as in progress in the background. If it was already
 * started, there is nothing to do.
 */
export async function startTaskFromRouteAction(taskId: string): Promise<void> {
  try {
    const ctx = await requireContext();
    await transitionTask(ctx, { taskId, action: "start" });
    refresh();
  } catch (error) {
    actionError(error); // logs unexpected errors; expected ones (already started) are fine to ignore
  }
}

export async function assignTaskAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const { assigneeName } = await assignTask(ctx, {
      taskId: text(formData, "taskId"),
      assigneeId: text(formData, "assigneeId"),
    });
    refresh();
    return { status: "success", message: `Assigned to ${assigneeName}. They've been notified.` };
  } catch (error) {
    return actionError(error, formDataToObject(formData));
  }
}

export async function addCommentAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await addTaskComment(ctx, { taskId: text(formData, "taskId"), body: text(formData, "body") });
    refresh();
    return { status: "success" };
  } catch (error) {
    return actionError(error, formDataToObject(formData));
  }
}
