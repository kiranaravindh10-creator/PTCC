# PTCC — Product Architecture

> **Simple for employees. Powerful for management. Intelligent in the background.**

PTCC is the internal operating platform for **Precise Testing and Calibration Centre Pvt. Ltd.**
It is one application in which every employee sees *their* work for the day, and management sees
the whole company — without anyone filling in reports for management's sake.

It is deliberately **not** a generic ERP/CRM/HRM suite. Those words may describe parts of the
backend; employees never see them.

---

## 1. The loop that holds PTCC together

PTCC's business is a single loop. Every department touches the same customers and the same
instruments, at different moments:

```
 Find a customer ──► Win the work ──► Collect instruments ──► Calibrate / test ──► Report
   (Marketing)        (Marketing)        (Collection)           (Operations)      (Operations)
        ▲                                                                              │
        │                                                                              ▼
   Get paid ◄──────────────── Invoice ◄──────────────── Deliver instruments + report ◄─┘
  (Accounts)                 (Accounts)                       (Collection)
```

Traditional ERP splits this loop into disconnected modules ("CRM", "Logistics", "LIMS", "Billing"),
each with its own screens, its own copy of the customer, and its own idea of status. Employees then
re-enter information at every hand-off and management stitches the picture together in spreadsheets.

PTCC keeps the loop intact by building every feature on a small set of **shared records**.

## 2. Core concepts

| Concept | What it is | Examples |
|---|---|---|
| **Branch** | One of PTCC's four branches. One platform: branch staff see their branch; the CEO sees and compares all. | Bengaluru (NABL CC-2467), Chennai (CC-2822), Hosur (CC-3649), Hyderabad (accreditation not verified yet) |
| **Service scope** | What each branch is accredited to calibrate, imported from PTCC's NABL scope documents. Controlled reference data, never invented. See [SERVICE_CATALOGUE.md](SERVICE_CATALOGUE.md). | Pressure gauges 0–700 bar at Bengaluru |
| **Customer** | A company PTCC works with or wants to work with: **one central record** shared by every department and branch, with a relationship per branch (prospect / customer). The anchor for everything else. | ABC Engineering, Peenya: Bengaluru customer, Chennai prospect |
| **Contact** | A person at a customer. | Rajesh, Purchase Manager |
| **Work** (task) | Anything a specific person must do, by a specific time. One concept for the whole company. | Call Rajesh · Follow up on quote · Pickup at Peenya · Deliver to Whitefield |
| **Lead** | A sales opportunity with a customer, moving through stages until won or lost. A won lead is a *deal*. | "Pressure gauge calibration enquiry" |
| **Quotation** | A priced offer attached to a lead. | QT/2026-27/0042 |
| **Parcel** | A physical package of instruments travelling between customer and PTCC. | PCL-2026-00318, 6 gauges |
| **Job** | The laboratory work on received instruments, through to a report. | Calibration of 6 pressure gauges |
| **Invoice / Payment** | Kept in **Tally**, PTCC's accounting system of record. The platform will show references or summaries through a Tally integration layer once defined; it never becomes the accounting truth. | (in Tally) |
| **History** | Every change, note and message, attached to the record it is about. | "Arun marked pickup collected · 11:42 AM" |
| **Notification** | How work and alerts reach a person (in-app now; WhatsApp later). | "New pickup assigned: ABC Engineering" |

Two rules follow from this:

1. **Work is one thing.** A follow-up call, a pickup and a lab inspection are all *work*: they have
   a *what, who, where, when, priority, status* and a *next action*. Every employee sees all of their
   work in one list — **My Work** — regardless of which department created it. Kind-specific rules
   (a pickup can be *Collected*, a call cannot) live in one workflow definition, not in separate
   modules.
2. **Management numbers are a by-product of doing the work.** "Calls made" is counted from calls
   that marketers log by tapping *Call* and choosing an outcome. "Pickups in transit" is counted from
   pickups that collection staff mark *Started*. Nobody types numbers into a report.

### How records connect

```
Customer ─┬─ Contacts
          ├─ Leads ─┬─ Quotations
          │         └─ Work (follow-ups, calls)
          ├─ Work (pickups, deliveries, visits, general)
          ├─ Parcels ── Jobs ── Reports
          ├─ Invoices ── Payments
          └─ History (timeline across all of the above)
```

Opening a customer shows *everything* about them on one page — contacts, open leads, pickups,
parcels in the lab, unpaid invoices, and the full history. This is the "one customer, one truth"
view that replaces asking colleagues on WhatsApp.

## 3. Navigation model

Employees see at most six main destinations:

| Destination | What it answers | Who sees it |
|---|---|---|
| **Home** | "What should I do now?" (employees) / "How is PTCC doing today?" (management) | Everyone |
| **My Work** | "Everything I have to do, in order." | Everyone |
| **Leads** | "Which opportunities am I working, and what's next?" | Marketing, managers, coordinators, CEO; others see the leads they added |
| **Customers** (+ Services) | "Who is this company and what is happening with them?" and "Is this calibration in our accredited scope, at which branch?" | Roles that deal with customers |
| **Collections** | "Pickups and deliveries — where is everything?" | Collection, HR/Coordinator, Operations, CEO |
| **Communication** | "Announcements, team messages, alerts." | Everyone |
| **Ask PTCC** | "Find or do something by asking in plain language." | Everyone (answers respect permissions) |

Management functions appear as a short **Manage** group only for the roles that need them
(e.g. *Team* for HR, *Lab* for Operations, *Finance* for Accounts, *People & access* for Admin).
There is never a 20-item sidebar. On mobile the bottom bar holds four role-appropriate destinations
plus *More*.

Full per-role visibility is in [USER_ROLES.md](USER_ROLES.md).

## 4. Home is a briefing, not a dashboard

Home is composed per person from the roles they hold. Every element must help the person **act** or
**decide** — if it does neither, it does not belong on Home.

**Employee Home** (marketing, collection, operations, accounts):

1. Greeting and date — "Good morning, Arun · Thursday, 8 October".
2. *Today* — two to four counts of the person's own work, by kind ("3 pickups · 2 deliveries · 1 overdue").
3. *Next up* — the single most urgent item, with its actions one tap away (Call · WhatsApp · Start route · View).
4. *Later today* — the rest of today's work, compact.

**Coordinator Home** (HR/Coordinator) adds *Needs assignment* (work nobody owns yet) and
*Team today* (open work per person), because assigning and balancing work is their job.

**CEO Home** shows *PTCC today*: a handful of company-wide numbers and the flows that matter —

```
Filter        All branches · Bengaluru · Chennai · Hosur · …
Marketing     Calls (connected) · New leads · Quotations · Won (value) — more numbers and per person on request
Collections   Pending → Assigned → In progress → Collected → Delivered   (+ delayed)
Lab           Received → Calibration / testing → Certificate → Dispatch → Completed   (Phase 5)
```

Marketing Home (as PTCC described it): *"Today's work: 4 follow-ups · 8 calls · 3 new leads"*, then *"Next follow-up: ABC Engineering · Pressure gauge calibration · Bengaluru branch"* with **Call · WhatsApp · Add note · Schedule**.

…plus alerts that need a decision (overdue work, unassigned pickups, unpaid invoices beyond terms).
Flows only appear once the module producing their numbers is live — no placeholder charts.

## 5. Modules and phases

Modules are an engineering concept used to organise code and delivery. Employees experience one app.

| Module | Responsibility | Key records | Phase |
|---|---|---|---|
| Foundation | Sign-in, roles, permissions, shell, Home, My Work, notifications, audit | users, roles, tasks, notifications, audit_logs | 1 |
| Multi-branch, Customers & Marketing | Branches and branch scopes; accredited service scope; central customers; leads pipeline, calls, follow-ups, quotations, deals; CEO branch view | branches, company_branches, scope_*, leads, activities, quotations | 2 |
| AI lead capture | Create leads from voice (English/Kannada/Hindi), a photo or text — always confirmed by a person | lead_captures, attachments | 3 |
| Collections | Pickups, deliveries, parcels, assignment, proof, Google Maps routes | tasks (pickup/delivery), parcels | 4 |
| Lab (Operations) | Receiving parcels, jobs through to report and dispatch | jobs, job_events | 5 |
| People & Finance | Team availability/leave/workload; finance **through the Tally integration layer** (Tally stays the accounting system) | employee_profiles, accounting_references | 6 |
| WhatsApp & Ask PTCC | WhatsApp notifications, Ask PTCC assistant, document knowledge (RAG) | notification_deliveries, knowledge_* | 7 |
| Insights | Management analytics, reporting, optimisation | (read models over the above) | 8 |

Detailed scope and exit criteria: [DEVELOPMENT_ROADMAP.md](DEVELOPMENT_ROADMAP.md).

## 6. Cross-cutting capabilities

These are built once and used by every module:

- **Permissions everywhere.** Every read and write goes through server-side functions that check the
  person's permissions and scope (e.g. "own leads" vs "all leads"). The UI hides what you cannot do,
  but the server is what enforces it. Ask PTCC calls the same functions, so it can never do more
  than the person asking.
- **History.** Each work item, lead, parcel and job has a timeline of events and notes. Conversations
  about a pickup live *on the pickup*.
- **Notifications.** One internal notification service. Channels (in-app, WhatsApp, later SMS/email)
  are delivery mechanisms behind it, so features never talk to WhatsApp directly.
- **Audit.** Security-relevant and business-relevant changes are recorded with who, what, when and
  before/after values.
- **AI with confirmation.** AI proposes; a person confirms. AI never silently creates or changes
  important business records (customers, leads, assignments, money).
- **Search.** One search across customers, contacts, leads, parcels and jobs (Phase 2 onward).

## 7. Key end-to-end workflows

**Lead (Phase 2; AI-assisted capture in Phase 3)**

1. Any employee adds a lead, with the form or with **Capture lead**: a photo of a card or board, speaking (English, Kannada, Hindi) or a few typed words. The capture is read into a draft, and the employee checks every field, keeps the branch as their own — or chooses "Not sure which branch" if the lead belongs elsewhere — and confirms. Only that confirmation creates the lead. Today the reading is **simulated** (clearly labelled); real recognition needs PTCC's choice of providers.
2. The lead goes to its **branch**: the employee's own. If it is "Not sure which branch", it is marked *Needs branch*; the CEO and Admin are notified and either of them routes it. It is never guessed. Only the CEO and Admin add a lead straight to another branch.
3. The branch's **marketing team**: a coordinator or marketing manager assigns an **employee**, unless the marketer added it themselves.
4. The employee works it: call (with outcome), follow-ups in *My Work*, requirements checked against the branch's accredited scope, quotation.
5. **Won** makes the company a customer of that branch. **Lost** records the reason.

**Pickup (Phase 1 basic, Phase 4 complete)**
Customer requests pickup → coordinator creates pickup work → assigns collection employee →
employee notified → *Start route* opens Google Maps navigation → *Mark collected* with parcel
count/photo → parcel appears in Lab's *Incoming* → Lab marks *Received* → pickup completed.

**Lab job (Phase 5)**
Exactly as PTCC confirmed: **Receiving → Calibration / Testing → Certificate → Dispatch**, then completed. Dispatch creates delivery work. No further stages are assumed.

**Billing**
Invoices, receipts and GST happen in **Tally**. The platform will read what PTCC decides should flow through the Tally integration layer; it does not invoice.

## 8. What we deliberately do not build (yet)

- A configurable "module builder", custom-field engine or workflow designer. Workflows are code, kept
  simple, and changed deliberately.
- A full HRMS (payroll, statutory compliance) or **any accounting system**. Tally is PTCC's accounting system; the platform integrates with it rather than replacing it.
- An invented laboratory process, price list, or accreditation claim. The lab stages, the service scope and the branch capabilities come from PTCC; anything not confirmed is shown as *Needs verification*.

## 9. Decisions confirmed by PTCC

From the Phase 2 brief:

- **Accounting:** Tally stays the system of record. The platform gets only an integration boundary.
- **Lab workflow:** Receiving → Calibration/Testing → Certificate → Dispatch.
- **Service catalogue:** PTCC's NABL scope documents are the source of truth (CC-2467 Bengaluru, CC-2822 Chennai, CC-3649 Hosur).
- **Branches:** four branches on one platform, with branch isolation and a company-wide CEO view.
- **Lead routing:** lead → branch → marketing team → assigned employee. An unknown branch is marked "Needs assignment".
- **Login:** password sign-in, accounts managed by Admin, no OTP.
- **Languages:** voice capture in English, Kannada and Hindi, stored language-independently with the original kept.

From the Phase 2 verification brief:

- **Hyderabad** is the fourth branch: 204, New Nagole Main Road, Kishanbag, Maruthi Nagar, Kothapet, Hyderabad, Telangana 500102 · 94883 78156 · precisehyd@precisetcc.com. Its NABL certificate, validity and scope are **not yet confirmed**, so nothing is shown as accredited at Hyderabad — including services accredited at other branches.
- **Lead assignment:**
  - Branch coordinators and marketing managers assign and reassign within their own branch.
  - Admins route and reassign leads company-wide, with every action audited.
  - The CEO decides the branch of leads whose branch is unknown.
- **Quotations:** keep the internal `Q-1001` sequence. Prices are typed by people, because there is no approved price list.
- **Tally:** the version is unknown and it runs on an office computer or the local network. What data should be exchanged is not decided yet.

From the Phase 3 review:

- **New leads stay in the employee's branch.** An employee adds a lead (form or capture) for their own branch, or marks it "Not sure which branch" for the CEO or Admin to route. Only the CEO and Admin add a lead straight to another branch. Routing afterwards is unchanged.
- **Leads with no branch notify both the CEO and Admin**, so either can route them.
- **Capture transcripts** are kept with the confirmed lead and shown only to people who can see the lead. Photos and recordings are not stored. Keeping transcripts indefinitely is **provisional**: PTCC has not approved a retention policy yet (open question 7).

## 10. Open questions for PTCC

1. **Hyderabad accreditation:** the NABL certificate number, validity dates and scope annexure, if Hyderabad is accredited.
2. **Quotations:** an official numbering format and PDF layout, if PTCC wants them, and a price list once approved.
3. **Tally:**
   - the product and version (e.g. TallyPrime or Tally.ERP 9);
   - whether its integration interface (XML/HTTP or ODBC) can be enabled on the office computer;
   - how a cloud-hosted platform may reach a computer on the office network (a small local connector, scheduled file exports, or a VPN);
   - which information should flow, in which direction, and how often.
4. **Lab:** sign-offs within stages, the certificate format, and record retention.
5. **AI capture:** the provider, and where audio of customer conversations may be processed.
6. **WhatsApp:** an existing WhatsApp Business number to move to the Business Platform (Cloud API)?
7. **Capture transcripts:** how long they are kept and who may delete them. Needed before capture is used in production.
