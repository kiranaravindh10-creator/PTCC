# PTCC — Development Roadmap

PTCC is built in phases. Each phase delivers something employees can use with real data, is verified
in the running app (desktop and phone widths) and by automated tests, and does not begin until the
previous phase's exit criteria are met.

Status legend: ✅ done · 🚧 in progress · ⏳ planned

---

## Phase 1 — Foundation ✅ (first working slice — completed 8 October 2026)

**Goal:** People can sign in, see a personalised Home, see and act on their work, and be notified
when work is assigned to them. Admins can onboard people and set their roles.

| Area | Scope |
|---|---|
| Project | Next.js 16 + TypeScript + Tailwind v4; Drizzle + PostgreSQL (PGlite locally); Vitest; scripts for migrate / sync-access / seed / create-admin |
| Auth | Phone-or-email + password sign-in, server sessions, lockout, sign-out, forced password change on first sign-in |
| Access | 7 roles, permission catalogue, role defaults synced to DB, server-side guards and scoped queries |
| Design system | Tokens, typography, Phase 1 components, app shell (sidebar desktop / bottom bar phone) |
| Home | Per-role composition: employee briefing, coordinator assignment + team load, CEO company overview from live data |
| My Work | Grouped list (Overdue / Today / Tomorrow / Upcoming / No date), Done view, team view for coordinators, task detail with actions, notes and history, create task with progressive disclosure, assign/reassign |
| Collections | Pickups & deliveries list (tasks of those kinds) with Start route (Google Maps link), Call, WhatsApp |
| Notifications | In-app notifications on assignment, unread count, mark read |
| Admin | People list, add person with roles, edit roles/status, reset password |
| Audit | Auth events, user administration, task creation/assignment/status changes |

**Exit criteria**
- [x] Each role signs in and sees the correct Home and navigation. *(All seven roles checked in the browser.)*
- [x] A coordinator creates a pickup, assigns it; the collection employee is notified, starts it, opens navigation, marks it collected; the coordinator closes it. *(Browser walk-through, plus `tests/tasks.test.ts` "the pickup hand-off".)*
- [x] A user cannot open another user's task by URL (404), cannot assign without `task.assign`, cannot perform invalid transitions (server-enforced, tested). *(`tests/tasks.test.ts` "who can see what"; also checked in the browser.)*
- [x] Works at 360 px and 1440 px. *(No horizontal overflow on any Phase 1 screen.)*
- [x] `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all pass.

**Known limits, by design, until later phases**
- Choosing a customer uses a plain list (no search or "new customer" inline) — Phase 2.
- Role permissions are viewable but not editable in the Admin screen yet.
- No proof photos, parcel records or route optimisation — Phase 4.
- Notifications are in-app only — WhatsApp in Phase 7.
- No offline support for field staff yet; consider a PWA with offline queueing alongside Phase 4.

## Phase 2 — Multi-branch, Customers & Marketing 🚧 (built 8–9 October 2026; verification pass 9 October 2026; awaiting PTCC's approval)

| Area | Scope |
|---|---|
| Branches | One platform, branch-level isolation; `branch_id` on users, work, leads, activities, quotations; per-branch customer relationships. Admin branches screen (add / edit / verified / deactivate). Branches created from the NABL certificates; a 4th as "needs verification". |
| Access | `.own` / `.branch` / `.all` scopes; new Marketing manager role; `collection.read.all` kept; sync applies each default grant once |
| People | Admin sets the branch with the roles. Password sign-in kept (no OTP); reset password and deactivate as in Phase 1. |
| Service catalogue | NABL scope parsed from PTCC's documents (807 rows, 3 certificates), imported as versioned reference data; Services page; scope search in leads; "Scope not confirmed — verify with PTCC" ([SERVICE_CATALOGUE.md](SERVICE_CATALOGUE.md)) |
| Customers | Central company record with duplicate protection; customer page with next action, Call / WhatsApp / Add follow-up, contacts, leads, work and history; relationship per branch |
| Leads | Pipeline New → Qualification → Contact → Follow-up → Requirement → Quotation → Won / Lost → Customer. Create, edit, assign / reassign, "needs branch" (CEO decides) and "needs owner" (branch decides). Calls with outcomes, notes, follow-ups as work, overdue follow-ups, history, requirements from the scope, quotations (before tax, prices typed), won → customer of the branch, lost with reason, reopen. |
| Home | Marketing: today's follow-ups, calls and new leads, plus next follow-up with Call · WhatsApp · Add note · Schedule. Coordinators and managers: leads waiting for an owner. CEO: branch filter; marketing (period, more numbers on request, per person); collections (assigned, in progress, collected, delivered, pending, delayed); lab stages (Phase 5); branch comparison. |
| Boundaries | Tally integration layer (not connected); AI capture interfaces and validation (not connected) |

**Exit criteria**
- [x] Tests:
  - lead creation, assignment and branch assignment;
  - cross-branch permissions, including ID tampering;
  - follow-ups and lead conversion;
  - customer creation and reuse across branches and departments;
  - CEO cross-branch visibility and branch employee isolation;
  - service catalogue lookup, audit logging, permission enforcement.

  *(`tests/branches.test.ts` and `tests/phase2-rules.test.ts` plus unit tests: 167 tests in 14 files.)*
- [x] Confirmed rules covered by tests:
  - Hyderabad registered with no accreditation;
  - 807 scope rows intact and branch-specific;
  - Admin routing audited, without working leads;
  - branch-only assignment by coordinators and marketing managers;
  - the `Q-1001` sequence, typed prices and quotation history.
- [x] `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` pass.
- [x] Every role checked in the browser at 360 px and 1440 px (CEO, Admin, HR/Coordinator, Marketing manager, Marketing, Collection, Operations/Lab, Accounts, plus Chennai and Hyderabad staff).

  The 9 October verification pass:
  - 124 screenshots with no console errors, no hydration warnings and no horizontal overflow;
  - every navigation link opens for every role;
  - pages outside a role answer "not found";
  - 35 end-to-end checks, covering leads, assignment, Admin routing and audit, quotations, customer conversion, branch isolation by URL and API, scope safeguards (including Hyderabad) and the CEO's company-wide view.
- [ ] Approved by PTCC. **Phase 3 does not start before this.**

**Known limits, by design**
- Quotations: the `Q-1001` sequence is kept and prices are typed, as confirmed by PTCC. There is no PDF yet, no official numbering format and no price list.
- Range search is text only (no "is 650 bar covered?").
- Hyderabad has no accredited scope until its NABL certificate and scope are provided.

## Phase 3 — AI lead capture ⏳

- *Add lead* by **Voice** (English, Kannada, Hindi), **Photo** (visiting card, enquiry letter) or **Text**. Interfaces and validation are already in `src/modules/leads/capture.ts`.
- Storage adapter + attachments; `lead_captures` keeps the original transcript in its language
- Review screen: prefilled New lead form with uncertain fields highlighted and a duplicate check → person confirms → `createLead`
- Branch filled in only on an exact match; otherwise "Needs branch"
- Accuracy tracking per language (draft vs confirmed)

**Needs:** AI provider choice and keys (speech-to-text that handles Kannada and Hindi); PTCC's approval of where audio is processed; sample recordings for evaluation.

## Phase 4 — Collections ⏳

- Pickup requests (from customer page, from a won lead, or ad hoc), scheduling, priority
- **Parcels**: codes, item counts, condition notes, photos, proof of pickup/delivery (photo/signature)
- Assignment board for coordinators (by day and person; availability aware)
- Google Maps: Places autocomplete for addresses, geocoding, multi-stop route for the day
- Lab *Incoming* list fed by collected parcels; "Received at PTCC" closes the pickup

**Needs:** Google Maps Platform API key (restricted), confirmation of proof requirements.

## Phase 5 — Lab (Operations) ⏳

- Jobs created from received parcels, with stages exactly as confirmed by PTCC: **Receiving → Calibration / Testing → Certificate → Dispatch**, then completed. The stage list is one constant, so it stays extendable.
- Lab Home and CEO lab flow (Received, Under calibration/testing, Certificate stage, Dispatch, Completed): the CEO Home already shows these stages as "Tracking arrives in Phase 5"
- Certificate upload and link to job; dispatch creates delivery work

**Needs:** any sign-offs within stages, the certificate format, and record-retention requirements (ISO/IEC 17025). No further stages are assumed until PTCC defines them.

## Phase 6 — People & Finance ⏳

- Team: availability, leave requests/approval, workload view, attendance (if wanted)
- Communication: announcements (with acknowledgement), direct/team messages
- Finance through the **Tally integration layer**. Tally stays the accounting system: no invoicing or GST in the platform. What flows (e.g. outstanding per customer for Accounts and Collections) is defined with PTCC's accounts team first.

**Needs:** PTCC's Tally product, version and hosting; whether its integration interface can be enabled; which information should flow and in which direction.

## Phase 7 — WhatsApp, Ask PTCC, knowledge ⏳

- WhatsApp Cloud API channel: assignment, reminders, delivery updates, customer notifications (templates approved by Meta)
- Notification preferences and quiet hours
- **Ask PTCC**: questions over permitted data; proposed actions with confirmation
- Knowledge base (SOPs, procedures, policies) with role-filtered retrieval (pgvector)

**Needs:** WhatsApp Business Platform onboarding (verified business, phone number, templates).

## Phase 8 — Insights ⏳

- Management analytics: trends, conversion, turnaround times, collection efficiency, revenue
- Scheduled reports (weekly summary to CEO on WhatsApp/email)
- Optimisation: route optimisation, workload balancing suggestions, follow-up nudges

---

## Working agreements

Before building a feature:
1. Understand the user workflow (who, when, where, on which device).
2. Check whether something similar exists; reuse components and services.
3. Keep logic in module services; keep pages thin.
4. Validate input; enforce permissions on the server; add an audit entry for state changes.
5. Write/extend tests for workflow rules and permission boundaries.
6. Verify in the browser at phone and desktop widths.
7. Avoid new dependencies unless they remove real complexity.
8. If something is not implemented, say so in the UI and in code (`// NOT IMPLEMENTED: …`) — never fake it.
