import { ArrowLeft, MessageCircle, Navigation, Phone, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ButtonLink, ExternalButton } from "@/components/ui/button";
import { Fact, Facts, Notice, Panel, Section } from "@/components/ui/display";
import { DetailSkeleton } from "@/components/ui/skeletons";
import { can, canAny } from "@/server/access/actor";
import { requireContext } from "@/server/auth/current";
import { cn } from "@/lib/format";
import { mapsDirectionsHref, telHref, whatsappHref } from "@/lib/links";
import { formatPhone } from "@/lib/phone";
import { companyToday, dueGroup, formatDue } from "@/lib/time";
import { getCustomer } from "@/modules/customers/queries";
import { AddContactForm, AddFollowUpButton, EditCustomerForm, RelationshipButtons } from "@/modules/customers/ui/customer-forms";
import { listActivities, listCompanyLeads } from "@/modules/leads/queries";
import { ActivityTimeline } from "@/modules/leads/ui/activity-timeline";
import { LeadList } from "@/modules/leads/ui/lead-list";
import { listCompanyTasks } from "@/modules/tasks/queries";
import { WorkList } from "@/modules/tasks/ui/work-list";

export const metadata: Metadata = { title: "Customer" };

const RELATIONSHIP_LABEL = { prospect: "Prospect", customer: "Customer", inactive: "Inactive" } as const;

export default function CustomerPage({ params, searchParams }: PageProps<"/customers/[id]">) {
  return (
    <Suspense fallback={<DetailSkeleton />}>
      <Customer params={params} searchParams={searchParams} />
    </Suspense>
  );
}

/**
 * One customer, one page: who they are, what they need, the next action, and everything
 * happening with them — limited to what the person's branch and role may see.
 */
async function Customer({
  params,
  searchParams,
}: {
  params: PageProps<"/customers/[id]">["params"];
  searchParams: PageProps<"/customers/[id]">["searchParams"];
}) {
  const ctx = await requireContext();
  const { id } = await params;
  const { created } = await searchParams;
  const customer = await getCustomer(ctx, id);
  if (!customer) notFound();

  const [leads, work, activities] = await Promise.all([
    listCompanyLeads(ctx, customer.id),
    listCompanyTasks(ctx, customer.id),
    listActivities(ctx, { companyId: customer.id }, { limit: 50 }),
  ]);
  const today = companyToday(ctx.now);
  const companyWide = can(ctx.actor, "customer.read.all");
  const myRelationship = customer.relationships.find((r) => r.branchId === ctx.actor.branchId) ?? null;
  const followUps = work.filter((task) => task.kind === "follow_up" || task.kind === "call");
  const next = followUps[0] ?? null;
  const overdue = next ? dueGroup(next.dueDate, today) === "overdue" : false;
  const primary = customer.contacts[0] ?? null;
  const phone = primary?.phone ?? customer.phone;
  const whatsapp = phone ? whatsappHref(phone) : null;
  const route = mapsDirectionsHref({ latitude: customer.latitude, longitude: customer.longitude, address: customer.addressLine });
  const currentNeed = leads[0]?.requirement ?? null;
  const canWrite = can(ctx.actor, "customer.write");

  return (
    <div className="max-w-3xl space-y-8">
      <Link href="/customers" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden />
        Customers
      </Link>

      {created && <Notice tone="success">Customer added.</Notice>}

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{customer.name}</h1>
        <div className="flex flex-wrap gap-1.5">
          {customer.relationships.length === 0 && <span className="text-sm text-ink-muted">Not linked to your branch yet</span>}
          {customer.relationships.map((relationship) => (
            <span
              key={relationship.branchId}
              className={cn(
                "inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-medium",
                relationship.relationship === "customer" ? "bg-success-50 text-success-700" : "bg-subtle text-ink-muted",
              )}
            >
              {relationship.branchName} branch · {RELATIONSHIP_LABEL[relationship.relationship]}
            </span>
          ))}
        </div>
        {currentNeed && <p className="text-lg">{currentNeed}</p>}
        {(customer.area || customer.city) && (
          <p className="text-sm text-ink-muted">{[customer.area, customer.city, customer.industry].filter(Boolean).join(" · ")}</p>
        )}
      </header>

      <Panel className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-line bg-canvas/60 px-4 py-2.5 text-sm lg:px-5">
          <span className="font-medium text-ink-muted">Next action</span>
          <span className={cn("tabular font-medium", overdue ? "text-danger-700" : "text-ink")}>
            {next ? `${overdue ? "Overdue · " : "Follow up · "}${formatDue(next.dueDate, next.dueTime, today)}` : "Nothing scheduled"}
          </span>
        </div>
        <div className="space-y-3 px-4 py-4 lg:px-5">
          {next && (
            <p className="text-sm">
              <Link href={`/work/${next.id}`} className="font-medium hover:text-brand-700">
                {next.title}
              </Link>
              {next.assigneeName && <span className="text-ink-muted"> · {next.assigneeName}</span>}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {phone && (
              <ExternalButton href={telHref(phone)} variant="primary" className="max-sm:flex-1">
                <Phone aria-hidden />
                Call
              </ExternalButton>
            )}
            {whatsapp && (
              <ExternalButton href={whatsapp} target="_blank" rel="noopener noreferrer" className="max-sm:flex-1">
                <MessageCircle aria-hidden />
                WhatsApp
              </ExternalButton>
            )}
            {can(ctx.actor, "task.create") && <AddFollowUpButton companyId={customer.id} />}
          </div>
        </div>
      </Panel>

      {canWrite && (
        <div className="space-y-2">
          {companyWide ? null : (
            <RelationshipButtons companyId={customer.id} current={myRelationship?.relationship ?? null} />
          )}
        </div>
      )}

      <Section
        title="Leads"
        action={
          canAny(ctx.actor, "lead.capture", "marketing.work") ? (
            <ButtonLink href="/leads/new" variant="ghost" size="sm">
              <Plus aria-hidden />
              Add lead
            </ButtonLink>
          ) : undefined
        }
      >
        {leads.length === 0 ? <p className="text-sm text-ink-muted">No open leads you can see.</p> : <LeadList leads={leads} today={today} showBranch={companyWide} />}
      </Section>

      <Section title="Contacts">
        {customer.contacts.length === 0 ? (
          <p className="text-sm text-ink-muted">No contacts yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-panel border border-line bg-surface">
            {customer.contacts.map((contact) => (
              <li key={contact.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium">
                    {contact.name}
                    {contact.isPrimary && <span className="ml-2 text-xs font-normal text-ink-subtle">Main contact</span>}
                  </p>
                  <p className="text-sm text-ink-muted">{[contact.designation, contact.email].filter(Boolean).join(" · ") || "—"}</p>
                </div>
                {contact.phone && (
                  <a href={telHref(contact.phone)} className="tabular text-sm font-medium text-brand-600 hover:text-brand-700">
                    {formatPhone(contact.phone)}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
        {canWrite && <AddContactForm companyId={customer.id} />}
      </Section>

      {work.length > 0 && (
        <Section title="Open work" description="Pickups, deliveries and follow-ups you can see">
          <WorkList tasks={work} today={today} showBranch={companyWide} />
        </Section>
      )}

      <Section title="History">
        <ActivityTimeline activities={activities} now={ctx.now} showLead />
      </Section>

      <Panel>
        <Facts>
          <Fact label="Address">
            {[customer.addressLine, customer.area, customer.city, customer.state, customer.pincode].filter(Boolean).join(", ") || "—"}
            {route && (
              <a href={route} target="_blank" rel="noopener noreferrer" className="mt-1 flex w-fit items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">
                <Navigation className="size-4" aria-hidden />
                Open in Google Maps
              </a>
            )}
          </Fact>
          {customer.phone && <Fact label="Company phone">{formatPhone(customer.phone)}</Fact>}
          {customer.email && <Fact label="Email">{customer.email}</Fact>}
          {customer.website && <Fact label="Website">{customer.website}</Fact>}
          {customer.notes && <Fact label="Notes">{customer.notes}</Fact>}
        </Facts>
      </Panel>
      {canWrite && <EditCustomerForm customer={customer} />}
    </div>
  );
}
