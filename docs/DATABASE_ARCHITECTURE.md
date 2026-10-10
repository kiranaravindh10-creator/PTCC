# PTCC — Database Architecture

PostgreSQL is the single source of truth for PTCC's **operational** records. The schema is defined in TypeScript with Drizzle ORM (`src/server/db/schema/`), and every change ships as a reviewed SQL migration in `drizzle/`.

**Accounting is the exception.** Tally stays PTCC's accounting system of record (§13). The platform does not keep invoices, payments or ledgers of its own.

This document designs the **whole** data model so the relationships are right from the start. Tables are only **created** in the phase that needs them; each section is marked with its phase. **Phase 1 and Phase 2 tables exist now.**

---

## 1. Conventions

| Topic | Rule |
|---|---|
| Primary keys | `uuid` with `gen_random_uuid()`. Never expose sequential IDs as the only identifier. |
| Human references | Records people mention on the phone also get a short number: work `#1042`, lead `L-1001`, quotation `Q-1001`. |
| Naming | `snake_case`, plural table names, `<entity>_id` for foreign keys. |
| Timestamps | `timestamptz`. Every business table has `created_at`, and `updated_at` where rows change. |
| Authorship | Business tables have `created_by` and `updated_by` → `users.id`. |
| Status fields | `text` + a `CHECK` constraint listing the allowed values. This is easier to evolve than Postgres enums. Values and transitions are defined once in code and mirrored by the constraint. |
| **Branches** | Every branch-specific record carries `branch_id` (§4). Records that belong to the whole company do not; a customer is related to branches through `company_branches`. |
| Deletion | Business records are never hard-deleted. They are *cancelled*, *archived* (`archived_at`), *deactivated* or *superseded*. Hard deletes are only for ephemeral data (sessions, expired attempts). |
| Foreign keys | Always declared. Default `ON DELETE RESTRICT`; `CASCADE` only for pure child rows (session → user, quotation line → quotation). |
| Money | `bigint` in **paise** (₹1 = 100). Never floating point. Platform amounts are before tax; tax belongs to Tally. |
| Dates for scheduling | `due_date date` + optional `due_time time`, in the company time zone (Asia/Kolkata). |
| Phone numbers | Stored as E.164 (`+919876543210`), normalised on input. |
| Emails | Stored lower-cased. |
| JSON | `jsonb` only for genuinely unstructured data: audit diffs, event metadata, AI drafts, raw scope cells. |
| Reference data | Controlled data (the NABL scope) is imported from versioned files, never edited in place (§6). |

## 2. Domain map

```
 branches ◄──────────────── users (home branch) ── user_roles ─► roles ─► role_permissions ─► permissions
    │  ▲                       │                                   access_defaults_applied
    │  └── accreditations ◄── scope_documents
    │          └── scope_entries ── scope_groups ── scope_disciplines          (controlled reference data)
    │                  ▲
    │                  │ (requirements and quotation lines may point to a scope row)
    │                  │
 company_branches ─► companies ─┬─ contacts
 (relationship per branch)      ├─ leads (branch_id) ─┬─ lead_requirements
                                │                     ├─ quotations (branch_id) ── quotation_lines
                                │                     └─ tasks (follow-ups)
                                ├─ activities (branch_id)   calls, notes, history
                                ├─ tasks (branch_id) ── task_events      pickups, deliveries, general
                                ├─ parcels ── jobs ── job_events          (Phases 4–5)
                                └─ accounting_references ─► Tally         (Phase 6, through the integration layer)

 notifications · audit_logs · lead_captures (Phase 3) · attachments · knowledge_* (Phase 7)
```

## 3. Identity and access — Phase 1 ✅, branches Phase 2 ✅

### `users`
Everyone who signs in. One row per person.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text not null | Full name; the first name is used in greetings |
| phone | text not null **unique** | E.164; the primary sign-in identifier |
| email | text unique null | Lower-cased; optional sign-in identifier |
| password_hash | text not null | Self-describing `scrypt$…` format (see SYSTEM_ARCHITECTURE) |
| designation | text null | e.g. "Field Executive – Collections" |
| **branch_id** → branches | uuid null | Home branch. Required (by the service) for anyone holding a branch-level role; null only for CEO / Admin. Indexed. |
| status | text not null | `active` \| `inactive` |
| must_change_password | boolean not null | true for new accounts and after an admin reset |
| last_login_at | timestamptz null | |
| created_at, updated_at, created_by, updated_by | | `created_by` is null only for the bootstrap admin |

### `roles`, `permissions`, `role_permissions`, `user_roles`, `access_defaults_applied`

- `roles(id, key unique, name, description, is_system, …)`: the eight PTCC roles are system roles.
- `permissions(key PK, description, group_name)`: synced from the code catalogue.
- `role_permissions(role_id, permission_key, PK)`: which role holds which permission. Admin-adjustable.
- `user_roles(user_id, role_id, assigned_by, assigned_at, PK)`.
- `access_defaults_applied(role_key, permission_key, applied_at, PK)`: records each default grant the first time `db:sync-access` applies it. A default an Admin later removes is therefore never re-added, while newly introduced defaults still reach existing roles.

### `sessions`, `login_attempts`

Unchanged from Phase 1:

- `sessions.id` is the SHA-256 of the session token, which exists only in the user's cookie;
- sessions have a sliding 30-day expiry;
- `login_attempts` drive lockout and rate limiting.

## 4. Branches — Phase 2 ✅

PTCC runs four branches on **one platform**. Data is isolated per branch, and the CEO sees across all of them.

### `branches`

| Column | Notes |
|---|---|
| id, name | `name` is unique (case-insensitive): "Bengaluru" |
| address_line, city, state, pincode, phone, email, notes | |
| maps_url, description | Google Maps link and a short description, as supplied by PTCC (migration 0003) |
| status | `active` \| `inactive`. An inactive branch is not offered for new records; a branch with active people cannot be deactivated. |
| verification | `verified` \| `needs_verification`. Whether PTCC has confirmed the branch's **details** (name, address, contacts). Branches created from an accreditation certificate are verified; Hyderabad's details were supplied by PTCC, so it is verified too. This says nothing about accreditation, which comes only from `accreditations` (§6): Hyderabad has none yet, so it has no accredited scope. |
| audit columns | |

### Where branch records come from

| Branch | Source |
|---|---|
| Bengaluru, Chennai, Hosur | Created by the scope import from the NABL certificates (`data/scope/`) |
| Hyderabad | PTCC's branch directory, `data/branches/ptcc-branches.json`, imported by `npm run branches:import` (part of `db:setup`) |

The branch directory holds contact details only, never accreditation. The import:

- creates a missing branch;
- fills empty fields of an existing one;
- never overwrites what an Admin has edited;
- records each change in the activity log.

### Which records carry a branch

| Record | `branch_id` | Rule |
|---|---|---|
| users | null allowed | Home branch; null only for company-level roles |
| tasks (work, pickups, deliveries, follow-ups) | **not null** | Defaults to the assignee's branch, else the creator's. Reassigning across branches moves the work (CEO only, audited). |
| leads | **null allowed** | null = "Needs branch": the branch is unknown and is decided by the CEO, never guessed |
| activities | null allowed | From the lead, else the actor's branch |
| quotations | **not null** | The lead's branch at the time |
| company_branches | part of the PK | A company's relationship with each branch |
| accreditations | null allowed | null + `branch_link_status = needs_verification` until PTCC confirms |
| Deals | via leads | A deal is a won lead, so it carries the lead's branch |
| Collections (Phase 4) | via tasks; parcels get `branch_id` | |
| Jobs (Phase 5) | `branch_id` not null | The lab that does the work |
| Invoices (Tally, Phase 6) | `accounting_references.branch_id` | Mirrors the branch the Tally document belongs to, once the integration is defined |

Isolation is enforced in the queries (§15), not by separate databases or schemas. Branches share customers, people can move between branches, and the CEO compares branches with ordinary queries.

### Data created before branches existed

Migration `0001_multi_branch_marketing.sql` upgrades a Phase 1 database without losing data:

- If the database already has work or companies, it creates a branch named **"Unassigned (created before branches)"** (`needs_verification`).
- It attaches existing work, branch-level people and company relationships to that branch.
- An Admin then moves them to their real branches.

On a fresh database, no placeholder is created.

## 5. Customers — Phase 2 ✅

**A company is one central record.** Marketing, Collections, Operations, Accounts and the CEO all use the same row.

It is **not** owned by a branch. Its relationships with branches are rows in `company_branches`, so ABC Engineering can be a Bengaluru customer and a Chennai prospect while remaining one company with one set of contacts.

### `companies`

| Column | Notes |
|---|---|
| id, name not null | |
| normalized_name | Lower-cased, without punctuation, "M/s" or legal suffixes (Pvt Ltd, & Co…). Indexed. New companies are checked against it, so duplicates are refused and the existing company is suggested instead. |
| industry, phone, email, website | |
| address_line, area, city, state, pincode | `area` = the locality PTCC staff use ("Peenya") |
| latitude, longitude | `numeric(9,6)`; filled in Phase 4 |
| notes, archived_at | |
| audit columns | |

Phase 1's `lifecycle` and `owner_id` columns moved to `company_branches`, because both are per branch. They were copied there by migration 0001 and dropped by 0002.

### `company_branches`

`(company_id, branch_id) PK`, plus:

- `relationship`: `prospect` | `customer` | `inactive`;
- `owner_id` → users (optional marketer for that branch);
- `became_customer_at`;
- audit columns.

Index: `(branch_id, relationship)`.

- A row is created automatically when a branch first works with a company (a lead, a task, adding a customer).
- Marking a lead **won** sets that branch's relationship to `customer`.
- Branch staff see only their branch's row; the CEO sees all.

### `contacts`

`(id, company_id, name, phone, email, designation, is_primary, audit columns)`, indexed on `company_id` and `phone`. Contacts belong to the company, not to a branch: the purchase manager is the same person whichever branch calls.

## 6. Service catalogue (accredited scope) — Phase 2 ✅

The full design, import pipeline and status rules are in **[SERVICE_CATALOGUE.md](SERVICE_CATALOGUE.md)**. In short:

- `scope_documents(id, kind scope|certificates, file_name, sha256 unique, generator, imported_at, imported_by)`.
- `accreditations`:
  - `id`, `certificate_number` (unique), `branch_id` (nullable), `branch_link_status` (`confirmed` | `needs_verification`);
  - `accreditation_body`, `standard`, `field`, `legal_entity`, `facility_address`;
  - `issue_date`, `valid_from`, `valid_until`, `last_amended_on`;
  - `scope_document_id`.
- `scope_disciplines(id, name unique, label)`.
- `scope_groups(id, discipline_id, name, label, unique(discipline_id, name))`.
- `scope_entries`:
  - `id`, `accreditation_id`, `scope_document_id`, `group_id`;
  - `facility_type` (`permanent` | `site`), `serial_number`;
  - `measurand_or_instrument`, `method`, `range_text`, `cmc_text`;
  - `pdf_page`, `annexure_page`, `raw` (jsonb);
  - `search_text`, `search_compact`, `is_current`.

Rows are never edited. A newer document for the same certificate marks the older rows `is_current = false`; they are kept because requirements and quotation lines may refer to them.

## 7. Work — Phase 1 ✅, branch-aware in Phase 2 ✅

### `tasks`: every unit of work in the company

A follow-up, a call, a pickup, a delivery and a general to-do are all rows here. This is what makes **My Work** a single list and lets management count work uniformly.

| Column | Type | Notes |
|---|---|---|
| id, number | uuid PK, integer identity | `#1042` |
| kind | text | `general` \| `call` \| `follow_up` \| `pickup` \| `delivery` |
| title, details | text | |
| status | text | `pending` \| `assigned` \| `in_progress` \| `collected` \| `delivered` \| `completed` \| `cancelled` |
| priority | text | `low` \| `normal` \| `high` \| `urgent` |
| **branch_id** → branches | uuid **not null** | Phase 2; see §4 |
| company_id, contact_id | null | The *who* |
| contact_name, contact_phone | text null | Snapshot or ad-hoc contact |
| location_address, location_area, latitude, longitude | null | The *where* (snapshot) |
| due_date, due_time | null | The *when* (company time zone) |
| assignee_id, assigned_by, assigned_at | | `assignee_id` is null exactly while `pending` |
| started_at, completed_at, completed_by, cancelled_at, cancel_reason | | |
| **lead_id** → leads | null | Phase 2: follow-ups on a lead |
| parcel_id → parcels | null | Phase 4 |
| audit columns | | |

Indexes:

- `(assignee_id, status)`, `(status, due_date)`, `(company_id)`, `(created_by)`;
- `(branch_id, status)` and `(lead_id)`, added in Phase 2.

Statuses and transitions are defined once in `src/modules/tasks/workflow.ts`, unchanged from Phase 1:

```
general / call / follow_up   pending ─assign→ assigned ─start→ in_progress ─complete→ completed
pickup                       … in_progress ─mark collected→ collected ─received at PTCC→ completed
delivery                     … in_progress ─mark delivered→ delivered ─close→ completed
any open status ─cancel (reason)→ cancelled
```

Completing a lead's follow-up writes `follow_up_done` to the lead's activity history. Marking a lead lost cancels its open follow-ups.

### `task_events`

`(id, seq, task_id, actor_id, type, from_status, to_status, body, meta, created_at)`. The history and conversation of a work item, ordered by `seq`.

## 8. Marketing — Phase 2 ✅

The pipeline, as confirmed by PTCC:

**New lead → Qualification → Contact → Follow-up → Requirement → Quotation → Won / Lost → Customer**

"Customer" is not a stage. Winning a lead makes the company a customer of the lead's branch (`company_branches`).

### `leads`: one row per opportunity; a won lead is a *deal*

| Column | Notes |
|---|---|
| id, number | `L-1001` |
| **branch_id** → branches | **null = needs a branch** (decided by the CEO; never guessed) |
| company_id, contact_id | The central company record |
| requirement | text: what the customer needs, in their words |
| source | `employee` \| `phone_enquiry` \| `email_enquiry` \| `walk_in` \| `referral` \| `existing_customer` \| `website` \| `other` |
| capture_method | `manual` \| `photo` \| `voice` \| `text` (the last three for AI capture, Phase 3) |
| stage, stage_changed_at | `new` \| `qualification` \| `contact` \| `follow_up` \| `requirement` \| `quotation` \| `won` \| `lost` |
| owner_id, assigned_by, assigned_at | The marketer responsible; null = waiting for the branch to assign |
| captured_by | Who found the lead (credit), whatever their role |
| won_value_paise, won_at, lost_at, lost_reason, closed_by | CHECKs: won ⇒ `won_at`; lost ⇒ `lost_at` and reason; value ≥ 0 |
| audit columns | |

- **Stages move forward automatically**, never backwards:
  - a connected call → Contact;
  - a follow-up scheduled from Contact onward → Follow-up;
  - a quotation → Quotation.

  People can also move a lead to any open stage.
- The **next follow-up** is not a column. It is the earliest open task with this `lead_id`: one source of truth, which also appears in the owner's My Work.

Indexes: `(branch_id, stage)`, `(owner_id, stage)`, `(company_id)`, `(captured_by)`.

### `lead_requirements`

`(id, lead_id CASCADE, scope_entry_id null, description, quantity, created_at, created_by)`. What the customer wants calibrated:

- a row of PTCC's scope when one was picked;
- free text otherwise, shown as *Scope not confirmed — verify with PTCC*.

### `activities`: the interaction log and lead/customer history

`(id, seq, company_id, lead_id, contact_id, branch_id, actor_id, kind, call_outcome, body, meta, occurred_at)`.

- `kind` is one of: `call`, `note`, `lead_created`, `stage_changed`, `assigned`, `branch_assigned`, `follow_up_scheduled`, `follow_up_done`, `requirement_added`, `quotation_created`, `quotation_status`, `won`, `lost`, `reopened`, `customer_linked`.
- `call_outcome` (required for calls) is one of: `connected`, `no_answer`, `busy`, `switched_off`, `wrong_number`.
- Marketing numbers (calls made and connected) are counted from here, per branch and per person.

### `quotations`, `quotation_lines`

- `quotations`:
  - `id`, `number` (`Q-1001`), `branch_id` (not null), `lead_id`, `company_id`, `contact_id`;
  - `status`: `draft` | `sent` | `accepted` | `rejected`;
  - `valid_until`, `notes`, `total_paise`, `sent_at`, `decided_at`, audit columns.
- `quotation_lines(id, quotation_id CASCADE, position, scope_entry_id null, description, quantity, unit_price_paise, amount_paise)`, with a CHECK that `amount = unit_price × quantity`.

Prices are typed by people: there is no price list, because none has been approved (confirmed by PTCC). Totals are **before tax**; tax and invoicing stay in Tally. The `Q-1001` sequence is kept (confirmed by PTCC); no official numbering format is assumed. Quotations are never deleted: status changes are written to the lead's activities and to the audit log.

## 9. Notifications and audit — Phase 1 ✅

- `notifications(id, recipient_id, type, title, body, href, entity_type, entity_id, actor_id, read_at, created_at)`. A notification is a pointer, not a grant: the target page re-checks permissions.
- `audit_logs` is append-only: `(id, actor_id null, action, entity_type, entity_id, summary, changes jsonb, ip, user_agent, created_at)`. Phase 2 adds these actions:
  - `branch.create|update|deactivate|reactivate`;
  - `customer.create|update|relationship`, `contact.create`;
  - `lead.create|update|assign|branch|stage|won|lost|reopen`;
  - `quotation.create|status`;
  - `scope.import`.

  `user.update` now includes branch changes.

## 10. AI capture — Phase 3 (designed; not created yet)

Voice in **English, Kannada and Hindi**, photos (visiting cards, enquiry letters) and pasted text. The interfaces and validation already exist in code (`src/modules/leads/capture.ts`).

### `lead_captures`

| Column | Notes |
|---|---|
| id, captured_by → users, branch_id (the capturer's) | |
| method | `voice` \| `photo` \| `text` |
| language | `en` \| `kn` \| `hi` \| `unknown` (detected) |
| original_text | The transcript / OCR text **exactly as recognised, in the original language**. Kept permanently with the lead. |
| attachment_id → attachments | The audio or image (retention period to be agreed with PTCC) |
| draft jsonb | The **validated**, language-independent draft: English text, E.164 phones, ISO dates |
| problems jsonb | Fields that could not be read |
| provider, model, prompt_version, latency_ms | For measuring accuracy and cost |
| status | `pending_review` \| `confirmed` \| `discarded` \| `failed` |
| lead_id → leads | Set only when the person confirms (`createLead` with `capture_method`) |
| reviewed_at, created_at | |

- Nothing is created from a capture until a person reviews the prefilled form and saves it.
- The branch is filled in only when the capture names an active branch exactly; otherwise the lead is saved as "Needs branch".
- Comparing `draft` with the confirmed lead measures extraction accuracy per language.

### `attachments`

`(id, storage_key, file_name, mime_type, size_bytes, sha256, kind, uploaded_by, task_id | lead_id | company_id | parcel_id | job_id, created_at)`, with a CHECK that at most one parent is set.

## 11. Collections — Phase 4

Pickups and deliveries are `tasks` (kinds `pickup`, `delivery`) and already carry `branch_id`. Phase 4 adds:

- `parcels(id, code unique, branch_id, company_id, pickup_task_id, delivery_task_id, status, item_count, description, condition_notes, collected_at, received_at, received_by, delivered_at, audit columns)`;
- proof photos and signatures as `attachments`.

The CEO's collection numbers map as follows: Assigned, In progress, Collected and Delivered come from task statuses; Pending is unassigned; Delayed is open past its due date.

## 12. Lab (Operations) — Phase 5

The workflow is **exactly** what PTCC confirmed:

**Receiving → Calibration / Testing → Certificate → Dispatch**, then the job is completed.

- `jobs`:
  - `id`, `number`, `branch_id` (not null: the lab doing the work), `company_id`, `parcel_id`, `lead_id` (null), `scope_entry_id` (null);
  - `instrument_description`, `make`, `model`, `serial_number`, `quantity`;
  - `stage`: `receiving` | `calibration_testing` | `certificate` | `dispatch`;
  - `completed_at`, `assignee_id`, `due_date`, `certificate_number`, `certificate_attachment_id`, audit columns.
- `job_events`: same shape as `task_events`.

The stage list lives in one code constant mirrored by a CHECK constraint, so adding a stage later is one reviewed migration. No other stages (inspection, on-hold, approvals…) are assumed until PTCC defines them. The CEO Home already shows these stages, marked "Tracking arrives in Phase 5".

## 13. Accounting — Tally stays the system of record (Phase 6)

**Tally is PTCC's accounting system of record.** The platform will **not** hold invoices, receipts, ledgers or GST as its own truth. The Phase 1 design for `invoices` and `payments` tables is **withdrawn**.

```
PTCC Platform  ──►  Tally integration layer (src/server/integrations/tally — boundary only today)  ──►  Tally
```

What the platform may store, once PTCC defines the integration, is **references** to Tally documents:

- `accounting_references(id, branch_id, company_id, lead_id null, job_id null, tally_document_type, tally_document_number, tally_document_date, amount_paise null, synced_at, source tally|manual)`.

Tally's own APIs, its data formats, and which documents and directions apply are **not assumed** — see SYSTEM_ARCHITECTURE §8 (Tally) and the open questions.

People (Phase 6) remains as designed:

- `employee_profiles`: employee code, department, joined on, reports to;
- `leave_requests`.

## 14. Communication and knowledge — Phases 6–7

Unchanged from the Phase 1 design:

- announcements;
- team conversations (work conversations stay in `task_events`);
- `notification_deliveries` (the outbox for WhatsApp/SMS/email);
- `knowledge_sources` and `knowledge_chunks` (pgvector).

## 15. Integrity and safety rules

1. **Scope in the query.** Every read for a person goes through a module query that applies their scope (own / branch / all) in SQL `WHERE` clauses. Fetch-by-id uses the same scoped query, so an out-of-scope record is "not found". This is tested for every branch-scoped record, including ID tampering.
2. **Correlated subqueries name the outer table explicitly** (`outerId(table)` in `src/server/db/sql.ts`). Drizzle drops table names from column references in single-table selects, which would otherwise silently bind `${branches.id}` to the subquery's own `id`.
3. **Transitions in one transaction.** A change writes the record, its history (`task_events` / `activities`), notifications and the audit log in a single transaction.
4. **No orphan writes from the client.** Server actions accept IDs and user input only. Ownership, branch (unless the person may choose it), timestamps, actor and derived fields are set on the server.
5. **Controlled reference data is imported, not edited.** Scope rows change only through a reviewed file and the importer.
6. **Migrations are forward-only and reviewed.** Destructive changes happen in two steps: 0001 copies data, 0002 drops the old columns.

## 16. Migrations

| File | What it does |
|---|---|
| `0000_init.sql` | Phase 1: identity, sessions, companies, contacts, tasks, task events, notifications, audit |
| `0001_multi_branch_marketing.sql` | Phase 2: branches, `users.branch_id`, `access_defaults_applied`, `company_branches` (backfilled from Phase 1 `lifecycle`/`owner_id`), `companies.normalized_name` (backfilled), `tasks.branch_id` (backfilled to the placeholder branch) and `tasks.lead_id`, the catalogue tables, leads, lead requirements, activities, quotations |
| `0002_drop_company_lifecycle.sql` | Drops `companies.lifecycle` and `companies.owner_id`, now in `company_branches` |
| `0003_branch_details.sql` | Adds `branches.maps_url` and `branches.description` (nullable; additive only) |

The upgrade path (0000 → 0002 on a database containing Phase 1 data) was tested on a copy of the Phase 1 development database.

### Workflow for schema changes

```bash
# 1. Edit src/server/db/schema/*.ts
npm run db:generate        # writes a new SQL migration into drizzle/
# 2. Read (and, for data changes, hand-edit) the generated SQL
npm run db:migrate         # applies pending migrations (stop `npm run dev` first when using local PGlite)
npm test                   # integration tests run against a fresh in-memory database
```
