"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { actionError, type ActionState } from "@/server/action-result";
import { requireContext } from "@/server/auth/current";
import { formDataToObject } from "@/server/validation";
import {
  addLeadNote,
  addRequirement,
  assignLead,
  changeStage,
  createLead,
  createQuotation,
  logCall,
  markLost,
  markWon,
  removeRequirement,
  reopenLead,
  scheduleFollowUp,
  setLeadBranch,
  setQuotationStatus,
  type CreateLeadInput,
} from "./service";

/** Form entry points for marketing. Each authenticates, hands raw input to the service, then refreshes or redirects. */

const text = (formData: FormData, key: string) => String(formData.get(key) ?? "");
const optional = (formData: FormData, key: string) => text(formData, key) || undefined;

async function run(formData: FormData, fn: () => Promise<unknown>, message?: string): Promise<ActionState> {
  try {
    await fn();
    refresh();
    return { status: "success", message };
  } catch (error) {
    return actionError(error, formDataToObject(formData));
  }
}

export async function createLeadAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const values = formDataToObject(formData);
  let leadId: string;
  try {
    const ctx = await requireContext();
    const input: CreateLeadInput = {
      companyId: optional(formData, "companyId"),
      companyName: optional(formData, "companyName"),
      industry: optional(formData, "industry"),
      companyPhone: optional(formData, "companyPhone"),
      addressLine: optional(formData, "addressLine"),
      area: optional(formData, "area"),
      city: optional(formData, "city"),
      contactName: optional(formData, "contactName"),
      contactPhone: optional(formData, "contactPhone"),
      contactEmail: optional(formData, "contactEmail"),
      requirement: text(formData, "requirement"),
      scopeEntryIds: formData.getAll("scopeEntryIds").map(String).filter(Boolean),
      source: (optional(formData, "source") as CreateLeadInput["source"]) ?? undefined,
      branchId: formData.has("branchId") ? text(formData, "branchId") : undefined,
      ownerId: optional(formData, "ownerId"),
      followUpDate: optional(formData, "followUpDate"),
      followUpTime: optional(formData, "followUpTime"),
      notes: optional(formData, "notes"),
    };
    ({ id: leadId } = await createLead(ctx, input));
  } catch (error) {
    return actionError(error, values);
  }
  redirect(`/leads/${leadId}?created=1`);
}

export async function logCallAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async () =>
    logCall(await requireContext(), {
      leadId: text(formData, "leadId"),
      outcome: text(formData, "outcome") as Parameters<typeof logCall>[1]["outcome"],
      notes: optional(formData, "notes"),
      followUpDate: optional(formData, "followUpDate"),
      followUpTime: optional(formData, "followUpTime"),
    }),
    "Call recorded.",
  );
}

export async function addLeadNoteAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async () => addLeadNote(await requireContext(), { leadId: text(formData, "leadId"), body: text(formData, "body") }));
}

export async function scheduleFollowUpAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return run(
    formData,
    async () =>
      scheduleFollowUp(await requireContext(), {
        leadId: text(formData, "leadId"),
        dueDate: optional(formData, "dueDate"),
        dueTime: optional(formData, "dueTime"),
        note: optional(formData, "note"),
      }),
    "Follow-up scheduled.",
  );
}

export async function changeStageAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async () => changeStage(await requireContext(), { leadId: text(formData, "leadId"), stage: text(formData, "stage") }));
}

export async function assignLeadAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { ownerName } = await assignLead(await requireContext(), {
      leadId: text(formData, "leadId"),
      ownerId: text(formData, "ownerId"),
    });
    refresh();
    return { status: "success", message: `Assigned to ${ownerName}. They've been notified.` };
  } catch (error) {
    return actionError(error, formDataToObject(formData));
  }
}

export async function setLeadBranchAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return run(
    formData,
    async () => setLeadBranch(await requireContext(), { leadId: text(formData, "leadId"), branchId: text(formData, "branchId") }),
    "Branch set. Its coordinators have been told.",
  );
}

export async function addRequirementAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async () =>
    addRequirement(await requireContext(), {
      leadId: text(formData, "leadId"),
      scopeEntryId: optional(formData, "scopeEntryId"),
      description: optional(formData, "description"),
      quantity: optional(formData, "quantity") ? Number(text(formData, "quantity")) : undefined,
    }),
  );
}

export async function removeRequirementAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async () => removeRequirement(await requireContext(), { requirementId: text(formData, "requirementId") }));
}

export async function markWonAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return run(
    formData,
    async () => markWon(await requireContext(), { leadId: text(formData, "leadId"), wonValue: optional(formData, "wonValue") }),
    "Marked won. The company is now a customer of this branch.",
  );
}

export async function markLostAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async () => markLost(await requireContext(), { leadId: text(formData, "leadId"), reason: text(formData, "reason") }));
}

export async function reopenLeadAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async () => reopenLead(await requireContext(), { leadId: text(formData, "leadId") }));
}

export async function createQuotationAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const values = formDataToObject(formData);
  const leadId = text(formData, "leadId");
  try {
    const descriptions = formData.getAll("lineDescription").map(String);
    const lines = descriptions.map((description, index) => ({
      description,
      quantity: Number(formData.getAll("lineQuantity")[index] ?? 0),
      unitPrice: String(formData.getAll("lineUnitPrice")[index] ?? ""),
      scopeEntryId: String(formData.getAll("lineScopeEntryId")[index] ?? "") || undefined,
    }));
    await createQuotation(await requireContext(), {
      leadId,
      validUntil: optional(formData, "validUntil"),
      notes: optional(formData, "notes"),
      lines: lines.filter((line) => line.description.trim() || line.unitPrice.trim()),
    });
  } catch (error) {
    return actionError(error, values);
  }
  redirect(`/leads/${leadId}?quoted=1`);
}

export async function setQuotationStatusAction(_previous: ActionState, formData: FormData): Promise<ActionState> {
  return run(formData, async () =>
    setQuotationStatus(await requireContext(), { quotationId: text(formData, "quotationId"), status: text(formData, "status") }),
  );
}
