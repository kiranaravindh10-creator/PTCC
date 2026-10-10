"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { actionError, type ActionState } from "@/server/action-result";
import { requireContext } from "@/server/auth/current";
import { formDataToObject } from "@/server/validation";
import { createTask } from "@/modules/tasks/service";
import { addContact, createCustomer, setBranchRelationship, updateCustomer } from "./service";

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");
const optional = (formData: FormData, key: string) => text(formData, key) || undefined;

const companyFields = (formData: FormData) => ({
  name: text(formData, "name"),
  industry: optional(formData, "industry"),
  phone: optional(formData, "phone"),
  email: optional(formData, "email"),
  website: optional(formData, "website"),
  addressLine: optional(formData, "addressLine"),
  area: optional(formData, "area"),
  city: optional(formData, "city"),
  state: optional(formData, "state"),
  pincode: optional(formData, "pincode"),
});

export async function createCustomerAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const values = formDataToObject(formData);
  let id: string;
  try {
    ({ id } = await createCustomer(await requireContext(), {
      ...companyFields(formData),
      branchId: optional(formData, "branchId"),
      relationship: text(formData, "relationship") === "customer" ? "customer" : "prospect",
      contactName: optional(formData, "contactName"),
      contactPhone: optional(formData, "contactPhone"),
      contactEmail: optional(formData, "contactEmail"),
      contactDesignation: optional(formData, "contactDesignation"),
    }));
  } catch (error) {
    return actionError(error, values);
  }
  redirect(`/customers/${id}?created=1`);
}

export async function updateCustomerAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await updateCustomer(await requireContext(), {
      companyId: text(formData, "companyId"),
      ...companyFields(formData),
      notes: optional(formData, "notes"),
    });
    refresh();
    return { status: "success", message: "Saved." };
  } catch (error) {
    return actionError(error, formDataToObject(formData));
  }
}

export async function addContactAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await addContact(await requireContext(), {
      companyId: text(formData, "companyId"),
      name: text(formData, "name"),
      phone: optional(formData, "phone"),
      email: optional(formData, "email"),
      designation: optional(formData, "designation"),
      makePrimary: formData.get("makePrimary") === "on",
    });
    refresh();
    return { status: "success", message: "Contact added." };
  } catch (error) {
    return actionError(error, formDataToObject(formData));
  }
}

export async function setRelationshipAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await setBranchRelationship(await requireContext(), {
      companyId: text(formData, "companyId"),
      branchId: optional(formData, "branchId"),
      relationship: text(formData, "relationship"),
    });
    refresh();
    return { status: "success" };
  } catch (error) {
    return actionError(error, formDataToObject(formData));
  }
}

/** "Add follow-up" on a customer page: a follow-up for me about this customer (no lead needed). */
export async function addCompanyFollowUpAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await createTask(await requireContext(), {
      kind: "follow_up",
      title: text(formData, "title") || "Follow up",
      companyId: text(formData, "companyId"),
      dueDate: optional(formData, "dueDate"),
      dueTime: optional(formData, "dueTime"),
    });
    refresh();
    return { status: "success", message: "Follow-up added to your work." };
  } catch (error) {
    return actionError(error, formDataToObject(formData));
  }
}
