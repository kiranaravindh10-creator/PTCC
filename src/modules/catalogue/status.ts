/**
 * Is a requested service within PTCC's accredited scope at the lead's branch?
 * The answer must never overstate accreditation (ISO/IEC 17025 / NABL): anything that
 * is not positively confirmed is reported as needing verification. Pure function.
 */

export type ScopeStatus =
  | { kind: "in_scope"; branchName: string }
  | { kind: "other_branch"; entryBranchName: string }
  | { kind: "not_confirmed" }
  | { kind: "branch_unverified" }
  | { kind: "expired"; certificateNumber: string }
  | { kind: "superseded" }
  | { kind: "branch_unknown" };

export type ScopeEntryFacts = {
  branchId: string | null;
  branchName: string | null;
  certificateNumber: string;
  validUntil: string | null;
  isCurrent: boolean;
};

/**
 * @param entry  the scope row a requirement is linked to, or null for free text
 * @param leadBranchId the branch the lead belongs to (null = not assigned yet)
 * @param today  YYYY-MM-DD in company time
 */
export function scopeStatus(entry: ScopeEntryFacts | null, leadBranchId: string | null, today: string): ScopeStatus {
  if (!entry) return { kind: "not_confirmed" };
  if (!entry.isCurrent) return { kind: "superseded" };
  if (entry.branchId === null) return { kind: "branch_unverified" };
  if (entry.validUntil !== null && entry.validUntil < today) {
    return { kind: "expired", certificateNumber: entry.certificateNumber };
  }
  if (leadBranchId === null) return { kind: "branch_unknown" };
  if (entry.branchId !== leadBranchId) return { kind: "other_branch", entryBranchName: entry.branchName ?? "another branch" };
  return { kind: "in_scope", branchName: entry.branchName ?? "this branch" };
}

export type StatusTone = "success" | "warning" | "danger" | "neutral";

export function scopeStatusText(status: ScopeStatus): { label: string; tone: StatusTone } {
  switch (status.kind) {
    case "in_scope":
      return { label: `In ${status.branchName}'s accredited scope`, tone: "success" };
    case "other_branch":
      return { label: `In ${status.entryBranchName}'s scope, not this branch's — verify with PTCC`, tone: "warning" };
    case "not_confirmed":
      return { label: "Scope not confirmed — verify with PTCC", tone: "warning" };
    case "branch_unverified":
      return { label: "Certificate's branch needs verification", tone: "warning" };
    case "expired":
      return { label: `Accreditation ${status.certificateNumber} has expired — verify with PTCC`, tone: "danger" };
    case "superseded":
      return { label: "From an earlier version of the scope — verify with PTCC", tone: "warning" };
    case "branch_unknown":
      return { label: "Branch not assigned yet — scope can't be checked", tone: "neutral" };
  }
}
