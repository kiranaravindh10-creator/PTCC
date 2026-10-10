# PTCC — System Architecture

This document records the technology decisions, how the code is organised, and how security,
integrations and AI fit in. It is written for the engineers who build and operate PTCC.

---

## 1. Technology stack (decided)

| Layer | Choice | Why |
|---|---|---|
| Application framework | **Next.js 16 (App Router) + React 19 + TypeScript (strict)** | One codebase for UI and server logic. Server Components keep data access on the server; Server Actions give typed, CSRF-protected mutations without hand-written API plumbing. Mature, well documented, easy to hire for. |
| Rendering model | **Cache Components** (Next.js 16 default) | Static app shell renders instantly; per-user data streams in behind `<Suspense>`. Data is dynamic by default — nothing is cached unless we opt in, which is the right default for an operations app. |
| Styling | **Tailwind CSS v4** with CSS-variable design tokens | Tokens live in one place (`src/app/globals.css`); no runtime CSS-in-JS. |
| UI components | **Own component library** in `src/components/ui` | We follow the shadcn/ui *approach* (components are our source code, not a dependency) but not its default look, which is the generic "AI SaaS" aesthetic we want to avoid. Radix primitives will be added per component only when complex accessibility behaviour is needed (combobox, dialog). Phase 1 needs none. |
| Icons | **lucide-react** | Consistent 1.5–2 px stroke icons, tree-shaken. |
| Database | **PostgreSQL 18** | Relational integrity, transactions, `CHECK` constraints, JSONB, full-text search, `pgvector` for RAG later. |
| ORM / migrations | **Drizzle ORM + drizzle-kit** | SQL-shaped, fully typed, no heavy runtime, migrations are plain SQL files we review and commit. |
| Local & test database | **PGlite** (real PostgreSQL compiled to WASM, in-process) | Zero install for developers (no Docker/Postgres needed), same SQL dialect and constraints as production. Tests run against a fresh in-memory database per suite. |
| Validation | **Zod 4** | Every server boundary (forms, actions, AI output) parses input into typed data. |
| Authentication | **First-party session auth** (details §4) | See evaluation below. |
| File storage | Storage adapter → **S3-compatible** bucket (Supabase Storage / AWS S3 / Cloudflare R2) | Phase 3+. Swappable; local filesystem in development. |
| AI | Provider-agnostic `ai` module; **Claude (Anthropic API)** recommended for extraction and Ask PTCC | Phase 3/7. Strong structured extraction and tool use; vision for business cards and signboards. Speech-to-text via a dedicated STT provider evaluated for Indian English, Kannada and Hindi. |
| Maps | **Google Maps URLs** now (no API key) → **Maps JavaScript, Places, Geocoding, Routes APIs** in Phase 4 | Navigation works from day one; route planning/autocomplete when a key is configured. |
| Messaging | **WhatsApp Business Platform (Cloud API)** behind a notification channel adapter | Phase 7. Until then: in-app notifications + click-to-chat links (`wa.me`). |
| Testing | **Vitest** (unit + integration on PGlite); Playwright for end-to-end later | Fast, TypeScript-native. |
| Hosting (recommended) | **Vercel** (Mumbai region, `bom1`) + **managed PostgreSQL in Mumbai** (Supabase `ap-south-1`, Neon, or AWS RDS) | Low latency for Bengaluru users; no servers to patch. A single Linux VM running `next start` + Postgres is an equally supported alternative (see §9). |

### Alternatives considered

- **Supabase (Auth + Storage + Postgres) as the whole backend.** A strong option and still our
  recommended *database host*. We do **not** use Supabase Auth for now because: accounts are
  admin-provisioned (no self-sign-up flows to save); permissions must be evaluated in the same
  database transaction as the data they protect; and it would add JWT/RLS coupling for little gain in
  an app where all data access is already server-side. Our session tables are standard Postgres, so
  moving later is straightforward.
- **Auth libraries (Auth.js, Better Auth).** Reasonable, but our needs are narrow (phone/email +
  password, server sessions, admin-created accounts). ~300 lines of well-tested first-party code
  following OWASP guidance is easier to audit than a framework we only use 5% of.
- **Prisma.** Heavier runtime, generated client and less SQL-transparent than Drizzle.
- **SQLite for development.** Rejected — dialect differences hide bugs. PGlite gives real Postgres.
- **A separate API server (NestJS/Express).** Not needed: Server Actions + Route Handlers cover the
  app; a public API can be added as Route Handlers when integrations need one.

## 2. High-level architecture

```
 Browser (desktop / phone)
   │  HTML + RSC stream, Server Action POSTs (Origin-checked by Next.js)
   ▼
 ┌─────────────────────────────── Next.js application ───────────────────────────────┐
 │ proxy.ts            optimistic check: no session cookie → /login (not a security   │
 │                     boundary; real checks happen below)                            │
 │                                                                                    │
 │ app/ (routes)       Pages & layouts (Server Components) render UI.                 │
 │                     Server Actions parse FormData and call module services.        │
 │                                                                                    │
 │ modules/<domain>/   queries.ts  — scoped reads   (ctx.actor applied in SQL)        │
 │                     service.ts  — mutations      (validate → authorise →           │
 │                                                   transaction → events → audit →   │
 │                                                   notifications)                   │
 │                     workflow.ts — state machines (pure, unit-tested)               │
 │                     ui/         — module components                                │
 │                                                                                    │
 │ server/auth         passwords, sessions, current actor                             │
 │ server/access       permission catalogue, role defaults, can()/require()           │
 │ server/db           Drizzle schema, client (Postgres or PGlite), migrations        │
 │ server/integrations adapters: storage, maps, whatsapp, ai (Phase 3+)               │
 └────────────────────────────────────────────────────────────────────────────────────┘
   │
   ▼
 PostgreSQL ── object storage (Phase 3+) ── external APIs (Google, Meta, AI provider)
```

### The one rule that keeps it safe and simple
**Pages, actions, AI tools and future APIs all call the same module functions, and those functions
receive a `ctx` containing the actor.** No route touches the database directly. Therefore:

- Permission checks exist in exactly one place per operation.
- Ask PTCC (Phase 7) is just another caller of `service.ts` functions — it cannot bypass permissions
  because there is nothing to bypass to.
- Business logic is testable without HTTP, cookies or React.

```ts
// Example shape (simplified)
export async function assignTask(ctx: Ctx, input: AssignTaskInput) {
  requirePermission(ctx.actor, "task.assign");
  const data = assignTaskSchema.parse(input);
  return ctx.db.transaction(async (tx) => {
    const task = await getTaskForUpdate(tx, ctx.actor, data.taskId); // scoped; throws NotFound
    assertTransition(task, "assign");                                  // workflow.ts
    // update task → task_event → notification → audit log
  });
}
```

## 3. Project structure

```
src/
  app/
    (auth)/                  Pages without the app shell
      login/                 Sign-in page + form
      account/password/      Choose / change password (also the forced first-sign-in step)
      actions.ts             signIn / signOut server actions
    (app)/                   Signed-in area; layout.tsx = app shell
      page.tsx               Home (composed per role)
      work/                  My Work · work detail ([id]) · new work (new)
      collections/           Pickups & deliveries
      communication/         Notifications (announcements/messages later)
      account/  more/        Profile · phone overflow menu
      admin/                 people/ (list, new, [id]) · roles/ · audit/
      customers/  ask/       Planned modules — honest placeholders
    globals.css              Design tokens + base styles
    layout.tsx               Root layout, fonts, metadata
  components/
    ui/                      Design-system primitives (Button, Field, Choice, Notice, Tabs…)
    shell/                   nav.ts (who sees what) · nav-links.tsx (client) · shell.tsx
    planned-module.tsx       Placeholder for designed-but-not-built modules
  modules/                   One folder per domain
    tasks/                   model.ts · workflow.ts · queries.ts · service.ts · actions.ts · ui/
    home/                    briefing.ts (pure) · ui/
    notifications/           queries.ts · service.ts (notify) · actions.ts
    users/                   queries.ts · service.ts · actions.ts · ui/
  server/                    Server-only foundation
    auth/                    password · session · sign-in · cookie · current (getActor, requireContext)
    access/                  permissions (catalogue) · roles (defaults) · actor (can/require) · load · sync
    db/                      client (PGlite | Postgres) · migrate · schema/
    context.ts  audit.ts  errors.ts  validation.ts  action-result.ts
  dev/                       DEVELOPMENT ONLY: sample accounts and one-click sign-in helper
  lib/                       Pure utilities: time · phone · links · format
  proxy.ts                   Optimistic "no cookie → /login" redirect
drizzle/                     Generated SQL migrations (committed)
scripts/                     db-migrate · sync-access · seed-dev · db-reset · create-admin
tests/                       Integration tests (in-memory PostgreSQL) + helpers
docs/                        This documentation
```

Rules:
- `server/` and `modules/*/{queries,service}.ts` import `server-only`; they can never be bundled to the browser.
- `lib/` is pure (no I/O) and may be used on client and server.
- Modules may import `server/*` and `lib/*`, and another module's **public functions** — never
  another module's tables directly for writes.

## 4. Authentication

| Aspect | Design |
|---|---|
| Identifier | Mobile number (normalised to E.164) **or** email. |
| Password hashing | `scrypt` from Node's `crypto` (N = 2¹⁷, r = 8, p = 1, 64-byte key, 16-byte random salt — OWASP recommendation). Stored self-describing: `scrypt$N$r$p$salt$hash`, so parameters can be raised later and old hashes re-hashed on next login. Comparison with `timingSafeEqual`. |
| Unknown identifier | A dummy hash is still verified so response time does not reveal whether an account exists. Error message is always "Phone/email or password is incorrect". |
| Session token | 32 random bytes (base64url) in an `HttpOnly`, `Secure` (production), `SameSite=Lax`, `Path=/` cookie named `ptcc_session`. |
| Session storage | `sessions.id = SHA-256(token)`. Expiry 30 days, extended (sliding) when less than 15 days remain. |
| Validation | Every request that needs the user calls `getActor()` (request-cached): hash cookie → join session + active user → load roles & permissions. Expired/missing/inactive ⇒ no actor. |
| Rate limiting | Max 5 failed attempts per identifier and 30 per IP in 15 minutes ⇒ temporary lockout with a clear message. Attempts are recorded in `login_attempts`. |
| Sign-out | Deletes the session row and the cookie. Deactivating a user deletes all their sessions. |
| First sign-in | Admin-created accounts have `must_change_password`; every page except "change password" redirects there until done. |
| Future | Phone OTP via WhatsApp/SMS can be added as a second sign-in method without changing sessions. |

`proxy.ts` only redirects requests without a session cookie to `/login`. It never decides access —
that happens on the server, close to the data, in every page and action.

## 5. Authorisation

- **Catalogue in code** (`server/access/permissions.ts`): permission keys + descriptions.
- **Defaults in code** (`server/access/roles.ts`): role → permissions.
- **Assignments in the database** (`role_permissions`, `user_roles`), synced idempotently by
  `npm run db:sync-access` (inserts what is missing, never overwrites Admin changes).
- **Actor**: `{ id, name, roleKeys, permissions: Set<PermissionKey>, branchId, branchName }`, built
  once per request.
- **Checks**:
  - `can(actor, "task.create")` for simple capabilities;
  - `scopeOf(actor, "task.read")` → `all | branch | own | null` for branch-scoped capabilities;
  - `coversBranch(actor, capability, branchId)` for "may I act on this branch's record?";
  - `requirePermission(actor, …)` in services, which throws `ForbiddenError`.
- **Scope helpers** return SQL conditions, so lists and fetch-by-id share the same rule: `taskVisibility`, `leadVisibility`, `activityVisibility`, `companyVisibility`.
- **Not found vs forbidden**: records outside your scope are reported as not found, including other branches' records reached by changing an ID in a URL or an API call.

### Multi-branch (Phase 2)

PTCC's four branches run on **one** application and **one** database. There are no per-branch deployments, schemas or tenants.

- Branch-specific records carry `branch_id` (DATABASE_ARCHITECTURE §4).
- Every person has a home branch. Branch-level permissions (`.branch`) apply to records of that branch; company-level permissions (`.all`) apply to all branches. The CEO holds the `.all` variants and Admin manages people and branches.
- Customers are **central**: one `companies` row, plus a relationship row per branch (`company_branches`). A Chennai marketer adding a lead for a company Bengaluru already serves reuses the company: name suggestions search all companies, identity only.
- The CEO's Home and lead lists take a branch filter (All branches / one branch). Branch comparison is a single query over `branches`.
- Moving work or a lead between branches is an explicit, audited action (`task.assign.all`, `marketing.assign.all`).
- Isolation is tested per record type, including ID tampering, in `tests/branches.test.ts`.

### JSON endpoints

Route Handlers serve interactive screens:

- `GET /api/catalogue/search?q=` returns scope search results.
- `GET /api/companies/suggest?q=` returns company name suggestions (id, name, area, city, and whether the company is already linked to my branch).
- `POST /api/capture` starts a lead capture (multipart: photo, recording or text). It returns a draft and never creates a lead (§7).
- `GET /api/capture/duplicates` returns possible duplicates for the capture review.

All of them:

- resolve the session with `getContextOrNull()`;
- answer `401` without one (`proxy.ts` also refuses cookie-less `/api/*` calls, except `/api/capture` — see below);
- apply the same permission checks as pages;
- send `Cache-Control: no-store`.

`POST` handlers also require a same-origin `Origin` header (`src/server/http.ts`), since Route Handlers don't get the Server Action origin check.

`POST /api/capture` limits its body **while reading it** (`readBodyWithin`): 8 MB for the file plus 512 KB for the other form fields, whether or not `Content-Length` is sent. It stops reading at the limit and answers `413`; refusals that leave the upload unread close the connection instead of draining it. The proxy skips this route, because Next.js buffers and fully reads the body of every request the proxy sees before the route runs — which would defeat the limit. The route checks the session itself before reading anything.

## 6. Data flow for a mutation (Server Action)

1. Form posts to a Server Action (Next.js verifies `Origin` against `Host`).
2. Action calls `requireActor()` → builds `ctx = { db, actor, request: { ip, userAgent } }`.
3. Action converts `FormData` to a plain object and calls the module service.
4. Service: Zod-validates input → checks permission → opens a transaction → loads the target via a
   scoped query → validates the workflow transition → writes → writes `task_events`,
   `notifications`, `audit_logs`.
5. Action returns a typed result (`{ ok: true } | { ok: false, error, fieldErrors }`) to
   `useActionState`, and calls `refresh()` / `redirect()` so the page re-renders with fresh data in the
   same round trip.

Errors: services throw typed errors (`ValidationError`, `ForbiddenError`, `NotFoundError`,
`ConflictError`); actions map them to user-facing messages. Unexpected errors are logged server-side
and shown as a generic message.

### Rendering pattern (Cache Components)

- Layouts never read the session at the top level. The static frame (sidebar, top bar) renders
  instantly; the parts that depend on the person (navigation, unread count) stream in behind
  `<Suspense>`.
- Every page renders its content component inside `<Suspense>` with a skeleton that matches the
  final layout.
- `currentSession()` calls `connection()` before touching the clock or the database, so session
  checks always run for a real request — never during prerendering, never from a cache.
- Phase 1 caches no personal data (`use cache` is not used): at PTCC's scale, fresh data beats
  micro-optimisation. Server Actions call `refresh()` so the page re-renders in the same round trip.

## 7. AI architecture (Phases 3 and 7)

### Lead capture (Phase 3): photo, voice (English, Kannada, Hindi), typed text

**Status: built with simulated providers. No real OCR, speech-to-text or AI extraction service is connected.**

```
 /leads/capture (mobile-first)            POST /api/capture (multipart; signed in; same origin)
 ─ Photo: take / upload / replace ──────►  startCapture: permission · rate limit · file type, size and
 ─ Speak: language + record (or sample) ─►    content checked · photo/recording fingerprinted, then DROPPED
 ─ Type: a few sentences ───────────────►    providers (CAPTURE_PROVIDER) → original text + validated draft
                                             saved as a DRAFT lead_captures row — never a lead
                      ◄─────────────────── draft + problems + "simulated" label
 Review form (one for all three):
  · every field tagged: from capture · check this · not in capture · edited by you
  · possible duplicates (GET /api/capture/duplicates) — only what this person may see
  · branch = the employee's own; a branch the capture names is only a hint
  · follow-up words ("next Tuesday") → an explicit date the employee must accept
  ─ Confirm and create lead ─► confirmCaptureAction → confirmCapture: one transaction —
                                createLeadInTx (the manual form's checks) + capture marked confirmed
  ─ Cancel ──────────────────► discardCaptureAction → draft discarded, its text cleared
```

**Providers** (`src/server/integrations/ai`), chosen by `CAPTURE_PROVIDER`:

| Mode | When | Photo | Voice | Typed text |
|---|---|---|---|---|
| `simulated` | Default in development and tests. **Refused in production.** | The result of a built-in sample the employee picks (business card, company board, or a simulated failure). The photo is checked and fingerprinted, not read. | A built-in sample transcript in the chosen language (English, Kannada, Hindi), or "nothing recognised". A recording, if made, is checked and fingerprinted, not transcribed. | The three sample texts (one per language) return prepared fields. Any other text gets only phone numbers, emails, websites and clear date words, found by fixed patterns. |
| `off` | Always in production for now | Not available | Not available | Not available |

The screen labels simulated results as simulated everywhere: the chooser, the sample pickers, the review form and the lead page. Sample companies and people are fictional, with `.example` addresses and 90000 900xx numbers.

**Rules the code enforces** (`src/modules/leads/capture.ts`, `capture-service.ts`; tests: `src/modules/leads/capture.test.ts`, `tests/capture.test.ts`):

- **AI never creates or changes records.** A capture is a draft. Only "Confirm and create lead" creates a lead.
  - It runs `createLeadInTx`: the same validation, permission, branch and owner checks as the manual form. A payload naming another branch, another branch's owner, or a made-up branch is refused exactly as on the form.
  - Confirming twice (double tap, retry, second tab) returns the same lead. The capture row is locked and `lead_captures.lead_id` is unique.
  - A failure anywhere rolls everything back, so there is never a half-saved lead.
  - Existing customers' records are not changed. Choosing an existing company reuses it as-is.
  - AI can't mark leads won, issue quotations or set prices: capture only ever creates a new, open lead.
- **Nothing is invented.**
  - Untrusted provider output is validated field by field; bad fields are dropped and reported.
  - A business card has no requirement, and a company board has no person, phone or email, so those stay empty.
  - The requirement is still mandatory, as on the form; the employee types it.
- **Dates:** "tomorrow", "next Tuesday" and similar become an explicit date in Asia/Kolkata time. They are shown as a suggestion and scheduled only if the employee accepts it. "Next Tuesday" is flagged as ambiguous.
- **Branch:**
  - A new lead — form or capture — goes to the employee's own branch (the default) or "Not sure which branch", which follows the existing Needs-branch process: the CEO and Admin are notified (`companyWideLeadRouters`), and either routes it. Only the CEO (`marketing.assign.all`) and Admin (`lead.route`) may create a lead straight in another branch. `canCreateLeadInBranch` (`src/modules/leads/access.ts`) is checked in `createLeadInTx`, so a changed payload can't get round it; the form and the review screen offer only the branches allowed.
  - It is never inferred from a phone number, an address or AI output: a Hosur address captured by a Bengaluru employee stays a Bengaluru lead.
  - A branch the speaker names exactly is shown as a hint only. The CEO and Admin can apply it; anyone else is told to choose "Not sure which branch" if the lead belongs there.
  - Tests: `tests/lead-branch-ownership.test.ts`.
- **Duplicates:**
  - Companies are matched by name, phone and email.
  - A company outside the employee's visibility shows name and place only, so it can be reused without revealing its business.
  - Open leads appear only if the employee may see them.
  - Nothing is merged automatically. The server still refuses an exact duplicate company name.
- **Languages:** the language is chosen (voice) or detected from the script (typed text). The original transcript or text is kept unchanged with the lead. A corrected transcript is stored separately. The lead's fields are canonical (English text, E.164 phone numbers, ISO dates).
- **Privacy and storage:**
  - **No durable file storage is configured, so photos and recordings are not stored.** Only their type, size and SHA-256 are kept.
  - Recognised text (and the employee's correction) is kept with a confirmed lead and shown on the lead page only to people who can see the lead (`getLeadCaptureInfo` applies `leadVisibility`). It is not copied into the lead's history, tasks, notifications or the audit log, and the draft fields are cleared on confirmation.
  - **Retention is provisional.** Confirmed transcripts are kept for as long as the lead exists because PTCC has not approved a retention policy yet. A policy (period, and who may delete) must be approved before capture is used in production; none is assumed here.
  - Text is cleared when a draft is cancelled. Drafts nobody confirms are cleared after 7 days — a development safeguard, not an approved policy.
  - Captures are private to the person who made it.
  - Nothing is sent to any external service. Raw text, images and audio are not logged.
- **Abuse controls:**
  - 30 captures per person per hour (failed ones count);
  - photos and recordings up to 8 MB, checked by type and file signature; the request body is capped while it is read (§5);
  - text up to 2,000 characters;
  - recordings up to 2 minutes;
  - same-origin check and session required on the API (401 without a session).

**To connect real providers later** (needs PTCC's approval first):
1. Choose providers for:
   - OCR of cards and boards;
   - speech-to-text that handles Indian English, **Kannada** and **Hindi**, including mixed speech. If a provider can't do one of these, the screen must say so for that language.
   - field extraction.
2. Implement them as a new mode returning the same `CaptureProviders` interface. Keys go in environment variables; nothing reaches the browser.
3. Agree what is sent to the provider, where it is processed, and how long the provider keeps it. Document the data flow.
4. Decide whether originals should be kept. If yes, configure durable storage (an S3-compatible bucket with signed URLs) and a retention period. Until then they are not stored.
5. Evaluate accuracy on real PTCC captures per language. Record which fields people edit; this is already captured in `lead_captures.edited_fields`.

The screens, review form, confirmation and tests don't change.

**Ask PTCC** uses LLM tool calling where each tool is a thin wrapper around an existing
query/service function executed with the asking user's `ctx`:

- Read tools (`findCustomer`, `listMyWork`, `leadsThisWeek`) run immediately, scoped to the user.
- Write tools (`createLead`, `assignTask`) never execute directly: the assistant returns a *proposed
  action* that the UI renders as a confirmation card; only the user's click calls the service.
- Retrieval (RAG) searches `knowledge_chunks` filtered by `allowed_role_keys` before ranking, so the
  model never sees documents the user may not read.
- Every interaction is logged in `ai_interactions`. API keys live only on the server.

## 8. Integrations

Each external system sits behind an adapter interface in `server/integrations/` with a
**disabled** implementation used when credentials are absent. Features call the adapter; the
adapter decides whether anything is sent. No feature breaks because a credential is missing.

| Integration | Interface | Without credentials | With credentials |
|---|---|---|---|
| Google Maps | `maps.directionsUrl()`, later `geocode()`, `planRoute()` | Maps URLs deep links (work today) | Places autocomplete, geocoding, multi-stop optimisation |
| WhatsApp | `NotificationChannel.send()` | In-app only; click-to-chat links | Template messages via Cloud API; delivery status webhooks → `notification_deliveries` |
| Storage | `storage.put/get/signedUrl()` | Local disk under `.data/uploads` (dev only) | S3-compatible bucket with signed URLs |
| AI capture | `providersFor(mode)` → `SpeechToText`, `ImageToText`, `LeadExtractor` | `simulated` (development and tests, clearly labelled) or `off` (production: "not available yet") | Provider API (chosen with PTCC; see §7) |
| Tally | `tally.status()` | **Not connected** (the only state today) | To be designed with PTCC — see below |

### Tally — the accounting boundary

**Tally is PTCC's accounting system of record and stays so.** The platform does not issue invoices, compute GST, or keep balances.

```
        PTCC Platform           customers, leads, quotations (before tax), work, collections, lab jobs
              │                 calls only this module
              ▼
  Tally integration layer       src/server/integrations/tally — boundary only (NOT IMPLEMENTED)
              │
              ▼
            Tally               invoices, receipts, ledgers, GST, outstanding
```

- Nothing outside `src/server/integrations/tally` may talk to Tally or assume how Tally is set up.
- Today the module only reports `{ connected: false }`, and no screen shows Tally data.
- **Known (PTCC, Phase 2 verification):**
  - the Tally version is unknown;
  - Tally runs on an office computer or the office's local network;
  - the future data exchange is not decided.
- **Consequence to plan for:** a platform hosted in the cloud cannot call a computer on the office network directly. Whatever is chosen later needs a way across, such as:
  - a small connector running in the office that pushes or pulls data;
  - scheduled file exports;
  - a VPN.

  None of these is built or assumed.
- **Open questions for a future integration decision:**
  - which Tally product and version (TallyPrime or Tally.ERP 9), and on which computer;
  - whether its integration interface (XML over HTTP, or ODBC) can be enabled;
  - who maintains the office side, and whether that computer is on during working hours;
  - which information should flow (e.g. outstanding per customer, invoice references), in which direction, and how often;
  - how Tally documents should be referenced from the platform (`accounting_references`, DATABASE_ARCHITECTURE §13).
- When defined, the integration will be read-mostly (e.g. outstanding per customer for collections and Accounts), run outside the request path, and store only references and synced copies that are clearly labelled as coming from Tally.

External sends (WhatsApp, email) go through an **outbox**: the business transaction inserts a
`notification_deliveries` row; a worker (Vercel Cron or a small queue such as pg-boss) sends it and
records the outcome. A failed WhatsApp message never rolls back a pickup assignment.

## 9. Environments and deployment

| Environment | Database | Notes |
|---|---|---|
| Development | PGlite at `.data/pglite` (default) or any `DATABASE_URL` | `npm run dev`. Stop the dev server before running `db:*` scripts against PGlite (single-process database; a lock file guards this). |
| Test | In-memory PGlite, migrated fresh | `npm test` |
| Production | Managed PostgreSQL via `DATABASE_URL` | PGlite is refused when `NODE_ENV=production`. |

Configuration is via environment variables (see `.env.example`). Secrets never enter the repository.

**Recommended production setup:** Vercel project (region `bom1`), managed Postgres in Mumbai,
`DATABASE_URL` pointing at the pooled connection string, `npm run db:migrate` in the deploy pipeline
before traffic shifts, daily automated backups with point-in-time recovery, and
`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` set if running more than one instance outside Vercel.

**Self-hosted alternative:** one Ubuntu VM (2 vCPU / 4 GB is ample for PTCC's size) running
`next start` behind Caddy/Nginx with TLS, plus Postgres with nightly `pg_dump` off-site.

## 10. Security controls (Phase 1 baseline)

- Session cookies: `HttpOnly`, `Secure`, `SameSite=Lax`; tokens hashed at rest.
- Server Actions: framework Origin check + our authentication and permission checks in every action.
- Input validation with Zod on every write; output shaped to what the UI needs (no raw rows with
  password hashes ever leave the server — `users.password_hash` is only selected by the auth module).
- Scoped queries (§5); IDs in URLs are UUIDs *and* scope-checked.
- Login rate limiting and lockout; uniform error messages.
- Audit log for authentication and all administrative and business-state changes.
- Security headers (`X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`) set in `next.config.ts`.
- Dependencies kept minimal; `npm audit` reviewed before releases.

## 11. Testing strategy

| Level | Tool | What |
|---|---|---|
| Unit | Vitest | Pure logic: workflow transitions, permission resolution, phone/time formatting, password hashing. |
| Integration | Vitest + in-memory PGlite | Services and scoped queries against the real schema: "marketing user cannot see another user's task", "assigning notifies the assignee", "invalid transition is rejected". |
| End-to-end | Playwright (from Phase 2) | Sign-in → Home → complete a task, on desktop and mobile viewports. |
| Manual | Running app | Each stage is verified in the browser at 360 px and 1440 px before moving on. |

## 12. Performance budget

- Home and My Work: server response < 300 ms at PTCC data volumes; first contentful paint < 1.5 s on a mid-range Android over 4G.
- No client-side data fetching libraries in Phase 1 — Server Components fetch, Server Actions mutate.
- Client JavaScript limited to interactive leaves (forms, nav state).
