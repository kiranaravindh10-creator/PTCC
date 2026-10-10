import { ArrowLeft, FileText, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ButtonLink } from "@/components/ui/button";
import { Fact, Facts, Notice, Panel, Section } from "@/components/ui/display";
import { DetailSkeleton } from "@/components/ui/skeletons";
import { canAny } from "@/server/access/actor";
import { requireContext } from "@/server/auth/current";
import { cn } from "@/lib/format";
import { whatsappHref } from "@/lib/links";
import { formatInr } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { companyToday, dueGroup, formatDue, formatTimestamp } from "@/lib/time";
import { listActiveBranches } from "@/modules/customers/queries";
import { canAssignLead, canNoteLead, canReopenLead, canSetLeadBranch, canWorkLead } from "@/modules/leads/access";
import { CAPTURE_METHOD_LABEL, isOpenStage, LANGUAGE_LABEL, leadRef, QUOTATION_STATUS_LABEL, quotationRef, SOURCE_LABEL, STAGE_LABEL } from "@/modules/leads/model";
import { getLeadCaptureInfo } from "@/modules/leads/capture-service";
import { getLead, getLeadQuotations, getLeadRequirements, listActivities, listMarketers } from "@/modules/leads/queries";
import { ActivityTimeline } from "@/modules/leads/ui/activity-timeline";
import { BranchTag, ScopeStatusBadge, StagePill } from "@/modules/leads/ui/badges";
import {
  AddRequirement,
  AssignLeadForm,
  CloseLead,
  LeadQuickActions,
  QuotationStatusButtons,
  RemoveRequirement,
  ReopenLead,
  SetBranchForm,
  StageControl,
} from "@/modules/leads/ui/lead-actions";

export const metadata: Metadata = { title: "Lead" };

export default function LeadPage({ params, searchParams }: PageProps<"/leads/[id]">) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <LeadDetail params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function LeadDetail({
  params,
  searchParams,
}: {
  params: PageProps<"/leads/[id]">["params"];
  searchParams: PageProps<"/leads/[id]">["searchParams"];
}) {
  const ctx = await requireContext();
  const { id } = await params;
  const query = await searchParams;
  // Scoped fetch: a lead outside your branch/scope is indistinguishable from one that doesn't exist.
  const lead = await getLead(ctx, id);
  if (!lead) notFound();

  const canWork = canWorkLead(ctx.actor, lead);
  const canAssign = canAssignLead(ctx.actor, lead);
  const canMove = canSetLeadBranch(ctx.actor, lead);
  // Routers (Admin) and people who only add leads may not have access to the customer page.
  const readsCustomers = canAny(ctx.actor, "customer.read", "customer.read.all");
  const open = isOpenStage(lead.stage);
  const [requirements, quotations, activities, marketers, branches, captured] = await Promise.all([
    getLeadRequirements(ctx, lead),
    getLeadQuotations(ctx, lead.id),
    listActivities(ctx, { leadId: lead.id }),
    canAssign && lead.branchId ? listMarketers(ctx, lead.branchId) : Promise.resolve(null),
    canMove ? listActiveBranches(ctx) : Promise.resolve(null),
    lead.captureMethod === "manual" ? Promise.resolve(null) : getLeadCaptureInfo(ctx, lead.id),
  ]);

  const today = companyToday(ctx.now);
  const next = lead.nextFollowUp;
  const overdue = open && next ? dueGroup(next.dueDate, today) === "overdue" : false;
  const phone = lead.contactPhone ?? lead.companyPhone;
  const whatsapp = phone ? whatsappHref(phone) : null;
  const latestQuote = quotations.find((q) => q.status === "accepted") ?? quotations.find((q) => q.status === "sent");
  const action = typeof query.action === "string" ? query.action : null;

  return (
    <div className="max-w-3xl space-y-8">
      <Link href="/leads" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Leads
      </Link>

      {query.created && (
        <Notice tone="success" title="Lead added">
          {lead.ownerName && lead.ownerId !== ctx.actor.id
            ? `${lead.ownerName} has been notified.`
            : lead.ownerId === ctx.actor.id
              ? "It's yours — the next follow-up will show in My Work."
              : lead.branchId
                ? `${lead.branchName}'s coordinators have been asked to assign an owner.`
                : "Admin and the CEO's office have been asked to decide which branch takes it."}
        </Notice>
      )}
      {query.quoted && <Notice tone="success">Quotation created as a draft. Mark it sent once it has gone to the customer.</Notice>}

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          <span className="font-mono text-xs">{leadRef(lead.number)}</span>
          <StagePill stage={lead.stage} />
          <BranchTag name={lead.branchName ? `${lead.branchName} branch` : null} />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {readsCustomers ? (
              <Link href={`/customers/${lead.companyId}`} className="hover:text-brand-700">
                {lead.companyName}
              </Link>
            ) : (
              lead.companyName
            )}
          </h1>
          <p className="mt-1 text-lg text-ink">{lead.requirement}</p>
          <p className="mt-1 text-sm text-ink-muted">
            {lead.ownerName ? `Owner: ${lead.ownerName}` : <span className="font-medium text-warning-700">No owner yet</span>}
            {lead.capturedByName && lead.capturedBy !== lead.ownerId && ` · Added by ${lead.capturedByName}`}
          </p>
        </div>
      </header>

      {open && (
        <Panel className="overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-line bg-canvas/60 px-4 py-2.5 text-sm lg:px-5">
            <span className="font-medium text-ink-muted">Next action</span>
            <span className={cn("tabular font-medium", overdue ? "text-danger-700" : "text-ink")}>
              {next ? `${overdue ? "Overdue · " : "Follow up · "}${formatDue(next.dueDate, next.dueTime, today)}` : "No follow-up scheduled"}
            </span>
          </div>
          <div className="px-4 py-4 lg:px-5">
            {(lead.contactName || phone) && (
              <p className="mb-3 text-sm text-ink-muted">
                {[lead.contactName, lead.contactDesignation].filter(Boolean).join(", ")}
                {phone && <span className="tabular"> · {formatPhone(phone)}</span>}
              </p>
            )}
            <LeadQuickActions
              leadId={lead.id}
              phone={phone}
              whatsapp={whatsapp}
              canWork={canWork}
              canNote={canNoteLead(ctx.actor)}
              canSchedule={open && lead.branchId !== null && lead.ownerId !== null}
              initialPanel={action === "note" ? "note" : action === "schedule" ? "schedule" : null}
            />
          </div>
        </Panel>
      )}

      {open && canWork && (
        <Section title="Stage">
          <StageControl leadId={lead.id} stage={lead.stage} />
        </Section>
      )}

      {!open && (
        <Notice tone={lead.stage === "won" ? "success" : "info"} title={`${STAGE_LABEL[lead.stage]}${lead.stage === "won" && lead.wonValuePaise ? ` · ${formatInr(lead.wonValuePaise)}` : ""}`}>
          {lead.stage === "won"
            ? `${lead.companyName} is a customer of ${lead.branchName ?? "the branch"}${lead.wonAt ? ` since ${formatTimestamp(lead.wonAt, ctx.now)}` : ""}.`
            : `Reason: ${lead.lostReason ?? "not given"}`}
          {canReopenLead(ctx.actor, lead) && (
            <div className="mt-3">
              <ReopenLead leadId={lead.id} />
            </div>
          )}
        </Notice>
      )}

      <Section title="What they need" description="Checked against PTCC's accredited scope for this lead's branch">
        {requirements.length === 0 ? (
          <p className="text-sm text-ink-muted">No services added yet. The requirement above is free text.</p>
        ) : (
          <ul className="divide-y divide-line rounded-panel border border-line bg-surface">
            {requirements.map((requirement) => (
              <li key={requirement.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <p className="font-medium">
                    {requirement.description}
                    {requirement.quantity ? <span className="font-normal text-ink-muted"> × {requirement.quantity}</span> : null}
                  </p>
                  {requirement.scope && (
                    <p className="text-xs text-ink-muted">
                      {requirement.scope.groupLabel} · {requirement.scope.facilityType === "site" ? "At customer site" : "At lab"} ·{" "}
                      {requirement.scope.rangeText} · CMC ±{requirement.scope.cmcText} · NABL {requirement.scope.certificateNumber}
                    </p>
                  )}
                  <ScopeStatusBadge status={requirement.status} />
                </div>
                {canWork && open && <RemoveRequirement requirementId={requirement.id} />}
              </li>
            ))}
          </ul>
        )}
        {canWork && open && (
          <div className="pt-1">
            <AddRequirement leadId={lead.id} branchId={lead.branchId} branchName={lead.branchName} />
          </div>
        )}
      </Section>

      <Section
        title="Quotations"
        action={
          canWork && open && lead.branchId ? (
            <ButtonLink href={`/leads/${lead.id}/quotation`} variant="secondary" size="sm">
              <Plus aria-hidden />
              New quotation
            </ButtonLink>
          ) : undefined
        }
      >
        {quotations.length === 0 ? (
          <p className="text-sm text-ink-muted">No quotations yet.</p>
        ) : (
          <ul className="space-y-3">
            {quotations.map((quotation) => (
              <li key={quotation.id} className="rounded-panel border border-line bg-surface">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-4 py-2.5">
                  <p className="font-medium">
                    <FileText className="mr-1.5 inline size-4 align-[-3px] text-ink-muted" aria-hidden />
                    {quotationRef(quotation.number)} · {QUOTATION_STATUS_LABEL[quotation.status]}
                  </p>
                  <p className="tabular font-semibold">{formatInr(quotation.totalPaise)}</p>
                </div>
                <ul className="px-4 py-2 text-sm">
                  {quotation.lines.map((line) => (
                    <li key={line.id} className="flex justify-between gap-3 py-1">
                      <span className="min-w-0 text-ink-muted">
                        {line.description} × {line.quantity}
                      </span>
                      <span className="tabular shrink-0">{formatInr(line.amountPaise)}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5">
                  <p className="text-xs text-ink-subtle">
                    By {quotation.createdByName}, {formatTimestamp(quotation.createdAt, ctx.now)} · Before tax
                  </p>
                  {canWork && (
                    <QuotationStatusButtons
                      quotationId={quotation.id}
                      next={
                        quotation.status === "draft"
                          ? [{ status: "sent", label: "Mark sent", primary: true }]
                          : quotation.status === "sent"
                            ? [
                                { status: "accepted", label: "Accepted" },
                                { status: "rejected", label: "Rejected" },
                              ]
                            : []
                      }
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Panel>
        <Facts>
          <Fact label="Contact">
            {lead.contactName ?? "—"}
            {lead.contactPhone && <span className="tabular text-ink-muted"> · {formatPhone(lead.contactPhone)}</span>}
            {lead.contactEmail && <span className="block text-sm text-ink-muted">{lead.contactEmail}</span>}
          </Fact>
          <Fact label="Company">
            {readsCustomers ? (
              <Link href={`/customers/${lead.companyId}`} className="text-brand-600 hover:text-brand-700">
                {lead.companyName}
              </Link>
            ) : (
              lead.companyName
            )}
            {(lead.companyAddress || lead.companyArea) && (
              <span className="block text-sm text-ink-muted">{[lead.companyAddress, lead.companyArea].filter(Boolean).join(", ")}</span>
            )}
          </Fact>
          <Fact label="Found through">{SOURCE_LABEL[lead.source]}</Fact>
          <Fact label="Owner">
            {lead.ownerName ?? <span className="text-warning-700">Not assigned yet</span>}
            {canAssign && marketers && (
              <div className="mt-2 max-w-md">
                {marketers.length > 0 ? (
                  <AssignLeadForm leadId={lead.id} marketers={marketers} ownerId={lead.ownerId} />
                ) : (
                  <p className="text-sm text-ink-muted">No one at {lead.branchName} can own leads yet. An admin can give someone the Marketing role.</p>
                )}
              </div>
            )}
          </Fact>
          <Fact label="Branch">
            {lead.branchName ?? <span className="font-medium text-warning-700">Needs a branch</span>}
            {canMove && branches && (
              <div className="mt-2 max-w-md">
                <SetBranchForm leadId={lead.id} branches={branches} branchId={lead.branchId} />
              </div>
            )}
          </Fact>
          {captured && (
            <Fact label="Captured">
              <span>
                {CAPTURE_METHOD_LABEL[captured.method]}
                {captured.language !== "unknown" ? ` · ${LANGUAGE_LABEL[captured.language]}` : ""} · {captured.capturedByName},{" "}
                {formatTimestamp(captured.createdAt, ctx.now)}
              </span>
              {captured.simulated && (
                <span className="mt-1 block text-sm font-medium text-warning-700">
                  Simulated capture{captured.sampleLabel ? ` (${captured.sampleLabel})` : ""} — development data
                </span>
              )}
              {captured.originalText && (
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer font-medium text-brand-600 hover:text-brand-700">
                    {captured.method === "voice" ? "Original transcript" : captured.method === "photo" ? "Text read from the photo" : "Original text"}
                  </summary>
                  <p className="mt-1 whitespace-pre-line text-ink-muted" lang={captured.language === "unknown" ? undefined : captured.language}>
                    {captured.originalText}
                  </p>
                  {captured.editedText && (
                    <>
                      <p className="mt-2 font-medium">Corrected by {captured.capturedByName}</p>
                      <p className="whitespace-pre-line text-ink-muted">{captured.editedText}</p>
                    </>
                  )}
                </details>
              )}
            </Fact>
          )}
        </Facts>
      </Panel>

      <Section title="History">
        <ActivityTimeline activities={activities} now={ctx.now} />
      </Section>

      {open && canWork && (
        <div className="border-t border-line pt-6">
          <CloseLead leadId={lead.id} branchName={lead.branchName} suggestedValue={latestQuote ? formatInr(latestQuote.totalPaise) : null} />
        </div>
      )}
    </div>
  );
}
