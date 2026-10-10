# PTCC

The internal operating platform for **Precise Testing and Calibration Centre Pvt. Ltd.**

> Simple for employees. Powerful for management. Intelligent in the background.

One application in which every employee sees their work for the day — and management sees the
whole company — built on shared records instead of disconnected ERP modules. Start with
[docs/PRODUCT_ARCHITECTURE.md](docs/PRODUCT_ARCHITECTURE.md).

**Status:** Phases 1 and 2 are verified. Phase 2 covers:
- the multi-branch platform with branch isolation and a CEO view across branches;
- PTCC's NABL scope as a searchable catalogue;
- central customers;
- the marketing pipeline;
- the Tally boundary.

**Phase 3 (AI-assisted lead capture)** is built with **simulated** providers and awaits review:
- photo, voice (English, Kannada, Hindi) and typed capture;
- one review form;
- the lead is created only on confirmation.

No real OCR or speech service is connected; see below.

See [docs/DEVELOPMENT_ROADMAP.md](docs/DEVELOPMENT_ROADMAP.md).

## Quick start

Requirements: Node.js 22.12+ (developed on Node 24). No database installation is needed for
development — PTCC uses an embedded PostgreSQL (PGlite) stored in `.data/`.

```bash
npm install
npm run db:setup     # tables, roles and permissions, PTCC's NABL scope and branches
npm run db:seed      # sample people, customers and work (development only)
npm run dev          # http://localhost:3000
```

The sign-in page shows the sample accounts in development — click one to sign in as that person.
All sample accounts use the password `precise2026`.

| Person | Role | Branch | Phone |
|---|---|---|---|
| Mohan Krishnan | CEO | All branches | 90000 00001 |
| Deepa Nair | Admin | All branches | 90000 00002 |
| Priya Sharma | HR / Coordinator | Bengaluru | 90000 00003 |
| Rahul Menon | Marketing | Bengaluru | 90000 00004 |
| Sneha Kulkarni | Marketing manager | Bengaluru | 90000 00005 |
| Arun Kumar, Manjunath Gowda | Collection | Bengaluru | 90000 00006 / 07 |
| Lakshmi Narayan | Operations / Lab | Bengaluru | 90000 00008 |
| Fathima Begum | Accounts | Bengaluru | 90000 00009 |
| Karthik Subramanian · Divya Raman · Senthil Murugan | HR · Marketing · Collection | Chennai | 90000 00010 / 11 / 12 |
| Ganesh Babu · Meena Rajan | HR · Marketing | Hosur | 90000 00013 / 14 |
| Srinivas Reddy · Lavanya Rao | HR · Marketing | Hyderabad | 90000 00015 / 16 |

These people are fictional sample data. The branches are real:
- Bengaluru, Chennai and Hosur come from the NABL certificates (`data/scope/`).
- Hyderabad comes from the branch details PTCC supplied (`data/branches/`). Its accreditation is not verified yet.

### Lead capture: simulated today

`/leads/capture` reads a photo, a recording or a few typed words into a draft the employee confirms. No real recognition service is connected. `CAPTURE_PROVIDER` (see `.env.example`) selects:
- `simulated` (default in development and tests): built-in samples, clearly labelled. Photo and voice results come from a sample you pick, never from your actual photo or voice.
- `off` (always in production for now): the screen says capture isn't available yet.

Tests use the simulated providers and need no API keys or paid services. Photos and recordings are not stored. A confirmed transcript stays with its lead — provisionally, until PTCC approves a retention policy. Details, and what's needed for real providers: [docs/SYSTEM_ARCHITECTURE.md](docs/SYSTEM_ARCHITECTURE.md) §7.

> The local database is single-process: **stop `npm run dev` before running any `db:*` script**
> (a lock file turns the mistake into a clear error).

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run check` | Lint, type-check and all tests — run before every commit |
| `npm test` | Unit + integration tests (each suite gets a fresh in-memory PostgreSQL) |
| `npm run build` / `npm start` | Production build / server |
| `npm run db:generate` | Create a SQL migration from schema changes in `src/server/db/schema/` |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:sync-access` | Sync roles and permissions from code (safe on every deploy) |
| `npm run db:setup` | `db:migrate` + `db:sync-access` + `scope:import` + `branches:import` |
| `npm run scope:import` | Import PTCC's NABL scope from `data/scope/` (idempotent; see docs/SERVICE_CATALOGUE.md) |
| `npm run branches:import` | Register branches from PTCC's branch directory in `data/branches/` (fills gaps, never overwrites Admin edits) |
| `npm run db:seed` | Sample data — development only, refuses in production |
| `npm run db:reset` | Delete and rebuild the local development database with sample data |
| `npm run admin:create -- --name "…" --phone …` | Create the first administrator on a fresh installation |

## Production

1. Provision PostgreSQL (recommended: a managed instance in Mumbai) and set `DATABASE_URL`.
2. `npm run build`, then on each deployment `npm run db:setup` before switching traffic.
3. Create the first administrator: `npm run admin:create -- --name "Full Name" --phone 9876543210`.
   They sign in with the printed temporary password and choose their own.

PGlite is refused when `NODE_ENV=production`. Details: [docs/SYSTEM_ARCHITECTURE.md](docs/SYSTEM_ARCHITECTURE.md) §9.

## Documentation

| Document | Read it for |
|---|---|
| [PRODUCT_ARCHITECTURE](docs/PRODUCT_ARCHITECTURE.md) | What PTCC is, core concepts, navigation, modules, open questions |
| [UX_PRINCIPLES](docs/UX_PRINCIPLES.md) | How screens should behave and read; Indian formats; checklist |
| [DESIGN_SYSTEM](docs/DESIGN_SYSTEM.md) | Colours, type, components, layout, accessibility |
| [USER_ROLES](docs/USER_ROLES.md) | Roles, permissions, data scopes |
| [DATABASE_ARCHITECTURE](docs/DATABASE_ARCHITECTURE.md) | Full data model, branches, statuses, integrity rules |
| [SERVICE_CATALOGUE](docs/SERVICE_CATALOGUE.md) | How PTCC's NABL scope is represented, imported and used |
| [SYSTEM_ARCHITECTURE](docs/SYSTEM_ARCHITECTURE.md) | Stack decisions, multi-branch, security, Tally boundary, AI |
| [DEVELOPMENT_ROADMAP](docs/DEVELOPMENT_ROADMAP.md) | Phases, scope and exit criteria |

## Brand assets

`public/brand/ptcc-logo.jpg` is the logo as supplied. `ptcc-logo.png` (transparent background) and
the app icons are derived from it. Replace them with official vector artwork when available.
