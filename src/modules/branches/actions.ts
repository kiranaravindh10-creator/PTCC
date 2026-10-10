"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { actionError, type ActionState } from "@/server/action-result";
import { requireContext } from "@/server/auth/current";
import { formDataToObject } from "@/server/validation";
import { createBranch, setBranchStatus, updateBranch, type BranchInput } from "./service";

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");

function branchInput(formData: FormData): BranchInput {
  return {
    name: text(formData, "name"),
    addressLine: text(formData, "addressLine"),
    city: text(formData, "city"),
    state: text(formData, "state"),
    pincode: text(formData, "pincode"),
    phone: text(formData, "phone"),
    email: text(formData, "email"),
    mapsUrl: text(formData, "mapsUrl"),
    description: text(formData, "description"),
    notes: text(formData, "notes"),
    verified: formData.get("verified") === "on",
  };
}

export async function createBranchAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await createBranch(await requireContext(), branchInput(formData));
  } catch (error) {
    return actionError(error, formDataToObject(formData));
  }
  redirect("/admin/branches?created=1");
}

export async function updateBranchAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await updateBranch(await requireContext(), { id: text(formData, "id"), ...branchInput(formData) });
    refresh();
    return { status: "success", message: "Saved." };
  } catch (error) {
    return actionError(error, formDataToObject(formData));
  }
}

export async function setBranchStatusAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const status = text(formData, "status") === "inactive" ? "inactive" : "active";
    await setBranchStatus(await requireContext(), { id: text(formData, "id"), status });
    refresh();
    return { status: "success", message: status === "inactive" ? "Branch deactivated." : "Branch reactivated." };
  } catch (error) {
    return actionError(error);
  }
}
