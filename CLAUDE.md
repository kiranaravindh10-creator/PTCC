# PTCC — guidance for coding agents

@AGENTS.md

PTCC is the internal operating platform for Precise Testing and Calibration Centre. Read the
relevant files in `docs/` before building a feature — they hold the decisions:
PRODUCT_ARCHITECTURE, UX_PRINCIPLES, DESIGN_SYSTEM, USER_ROLES, DATABASE_ARCHITECTURE,
SYSTEM_ARCHITECTURE, SERVICE_CATALOGUE, DEVELOPMENT_ROADMAP. Build in phases; do not start a later phase's modules early.

Confirmed business rules — never work around them:
- Tally is the accounting system. No invoicing, tax or ledgers here; only `src/server/integrations/tally`.
- The lab stages are exactly Receiving → Calibration/Testing → Certificate → Dispatch.
- The service scope comes only from PTCC's NABL documents (`data/scope/`). Never invent services, prices or branch capabilities; unknown means "Scope not confirmed — verify with PTCC" or "Needs verification".
- One platform, four branches (Bengaluru, Chennai, Hosur from the certificates; Hyderabad from `data/branches/`, accreditation NOT verified). Branch-specific records carry `branch_id`; never guess a branch (null = "needs branch").
- Lead routing: coordinators / marketing managers within their branch; Admin company-wide via `lead.route` (audited, never works leads); the CEO decides unknown branches (the CEO and Admin are both notified of a lead with no branch).
- New leads (form or capture) go to the creator's own branch or "Not sure which branch" (null); only the CEO and Admin create one in another branch (`canCreateLeadInBranch`, enforced in `createLeadInTx`).
- AI capture (`src/modules/leads/capture*.ts`): AI output is an untrusted DRAFT. Only `confirmCapture` (the employee's explicit confirmation → `createLeadInTx`) creates a lead. Never invent fields; never infer a branch; follow-up dates are suggestions. Simulated providers must stay labelled and never run in production. Photos/recordings are not stored. Confirmed transcripts stay with the lead (visible only via `leadVisibility`) — provisionally: no retention policy is approved, so never invent a deletion period.

## How the code is put together

- Pages, server actions, scripts and (later) Ask PTCC never touch the database directly. They call
  module functions in `src/modules/<domain>/{queries,service}.ts` with a `Ctx` (`db`, `actor`, `meta`, `now`).
- A service: `parseInput` (Zod) → `requirePermission` → transaction → write → `task_events` /
  `notify()` / `writeAudit()` in the same transaction.
- Branch scope: `scopeOf(actor, cap)` → all | branch | own; `coversBranch()` for a record's branch.
- Reads apply visibility in SQL (see `taskVisibility`, `leadVisibility`, `companyVisibility`). Fetch-by-id uses the same rule; out of scope
  means "not found", never "forbidden".
- Status changes go through the workflow table in `src/modules/tasks/workflow.ts` — UI and server
  both read it. Never update `status` ad hoc.
- Permission keys live in `src/server/access/permissions.ts`; role defaults in `roles.ts`; then
  `npm run db:sync-access`. Update docs/USER_ROLES.md in the same change.
- Allowed values (kinds, statuses) are TypeScript constants; the schema's CHECK constraints are built
  from them. Change both via a migration (`npm run db:generate`, then read the SQL).

## Gotchas

- Next.js 16 with Cache Components: read the session only inside `<Suspense>`; never at a layout's
  top level. `currentSession()` already calls `connection()`; don't call `new Date()` in render
  before something request-bound has run.
- Use Drizzle's query builder. Don't rely on `db.execute()` result shape — PGlite returns `{ rows }`,
  postgres.js returns an array.
- Local PGlite is single-process: stop `npm run dev` before running `db:*` scripts.
- Dates: use `src/lib/time.ts` (company time zone, Asia/Kolkata). Text that is stored (notifications)
  uses absolute dates, never "Today".
- In JSX put `key` before any `{...spread}` props.
- Correlated subqueries in a select list must reference the outer row with `outerId(table)`
  (`src/server/db/sql.ts`): Drizzle drops table names in single-table selects.
- `npm run typecheck` runs `next typegen` first (route types for `PageProps`).
- Anything under `src/dev/` is development-only and must stay behind a `NODE_ENV` check.

## UI rules (short version of the docs)

Tokens only (no raw hex), one primary button per view, sentence case, status as text + dot,
progressive disclosure ("Add more details"), 44px touch targets, honest empty states. Planned
features use `PlannedModule` and say which phase; mark unfinished code with `// NOT IMPLEMENTED:`.
No fake data in the UI.

## Before finishing a change

`npm run check` (lint + types + tests) must pass, and check the screen at 360px and 1440px.
