"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { actionError, type ActionState } from "@/server/action-result";
import { getSessionId, requireContext } from "@/server/auth/current";
import { formDataToObject } from "@/server/validation";
import { formatPhone, normalizePhone } from "@/lib/phone";
import {
  changeOwnPassword,
  createPerson,
  resetPersonPassword,
  setPersonStatus,
  updatePerson,
  type PersonInput,
} from "./service";

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

function personInput(formData: FormData): PersonInput {
  return {
    name: text(formData, "name"),
    phone: text(formData, "phone"),
    email: text(formData, "email"),
    designation: text(formData, "designation"),
    roleKeys: formData.getAll("roleKeys").map(String),
    branchId: text(formData, "branchId"),
  };
}

export async function createPersonAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const input = personInput(formData);
    const { id, temporaryPassword } = await createPerson(ctx, input);
    return {
      status: "success",
      data: {
        id,
        name: input.name.trim(),
        phone: formatPhone(normalizePhone(input.phone)),
        temporaryPassword,
      },
    };
  } catch (error) {
    return actionError(error, formDataToObject(formData));
  }
}

export async function updatePersonAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    await updatePerson(ctx, { id: text(formData, "id"), ...personInput(formData) });
    refresh();
    return { status: "success", message: "Changes saved." };
  } catch (error) {
    return actionError(error, formDataToObject(formData));
  }
}

export async function setPersonStatusAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const status = text(formData, "status") === "inactive" ? "inactive" : "active";
    await setPersonStatus(ctx, { id: text(formData, "id"), status });
    refresh();
    return {
      status: "success",
      message: status === "inactive" ? "Deactivated and signed out everywhere." : "Reactivated. They can sign in again.",
    };
  } catch (error) {
    return actionError(error);
  }
}

export async function resetPasswordAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const ctx = await requireContext();
    const { temporaryPassword } = await resetPersonPassword(ctx, { id: text(formData, "id") });
    refresh();
    return { status: "success", data: { temporaryPassword } };
  } catch (error) {
    return actionError(error);
  }
}

export async function changePasswordAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  let firstTime = false;
  try {
    const ctx = await requireContext({ allowPasswordChange: true });
    firstTime = ctx.actor.mustChangePassword;
    await changeOwnPassword(
      ctx,
      {
        currentPassword: text(formData, "currentPassword"),
        newPassword: text(formData, "newPassword"),
        confirmPassword: text(formData, "confirmPassword"),
      },
      await getSessionId(),
    );
  } catch (error) {
    return actionError(error);
  }
  redirect(firstTime ? "/?welcome=1" : "/account?changed=1");
}
