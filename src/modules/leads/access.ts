/**
 * Who may do what with a lead — one definition for the UI (what to show) and the server
 * (what to allow). Pure; visibility itself is applied in SQL (queries.ts).
 * Rules: docs/USER_ROLES.md §4.
 */

import { can, canAny, coversBranch, scopeOf, type Actor } from "@/server/access/actor";
import { isOpenStage, type LeadStage } from "./model";

export type LeadAccessFacts = {
  branchId: string | null;
  ownerId: string | null;
  capturedBy: string;
  stage: LeadStage;
};

/** Manages the leads of a branch: assigns them and may work any of them. Branch-less leads need company-wide scope. */
export function canManageBranchLeads(actor: Actor, branchId: string | null): boolean {
  return coversBranch(actor, "marketing.assign", branchId);
}

/**
 * Company-wide lead routing (Admin): set or change a lead's branch and assign or reassign its
 * owner. Deliberately separate from managing leads — a router does not work the lead.
 */
export function canRouteLeads(actor: Actor): boolean {
  return can(actor, "lead.route");
}

/** Calls, follow-ups, stages, requirements, quotations, won/lost. */
export function canWorkLead(actor: Actor, lead: LeadAccessFacts): boolean {
  if (canManageBranchLeads(actor, lead.branchId)) return true;
  if (!can(actor, "marketing.work")) return false;
  return lead.ownerId === actor.id || (lead.ownerId === null && lead.capturedBy === actor.id);
}

export function canAssignLead(actor: Actor, lead: LeadAccessFacts): boolean {
  return isOpenStage(lead.stage) && lead.branchId !== null && (canManageBranchLeads(actor, lead.branchId) || canRouteLeads(actor));
}

/** Choosing or changing which branch a lead belongs to is a company-wide decision (CEO; Admin routing). */
export function canSetLeadBranch(actor: Actor, lead: Pick<LeadAccessFacts, "stage">): boolean {
  return isOpenStage(lead.stage) && (scopeOf(actor, "marketing.assign") === "all" || canRouteLeads(actor));
}

/** Anyone who can see a lead and works with leads may add a note (e.g. the person who found it). */
export function canNoteLead(actor: Actor): boolean {
  return canAny(actor, "lead.capture", "marketing.work", "marketing.assign.branch", "marketing.assign.all");
}

export function canReopenLead(actor: Actor, lead: LeadAccessFacts): boolean {
  return lead.stage === "lost" && canManageBranchLeads(actor, lead.branchId);
}
