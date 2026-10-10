# PTCC — UX Principles

These principles decide arguments. When a design choice is unclear, the option that better serves
these principles wins. Visual specifics (colours, type, components) are in
[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md).

---

## The ten principles

### 1. One app, one language
Employees use PTCC words, never system words. They do not see "CRM", "module", "entity", "pipeline
configuration" or "workflow instance".

| Say this | Not this |
|---|---|
| My Work | Tasks module, Task management |
| Customers | Accounts, CRM, Companies module |
| Collections (pickups and deliveries) | Logistics, Field service |
| Lab | LIMS, Operations module |
| Payments due | Receivables, AR |
| Add lead | Create lead record |
| Assign to Arun | Set assignee |

> "Collection" means **pickup/delivery of instruments** at PTCC (it is the team's name). In finance
> screens we say **payments** and **payments due**, never "collections", to avoid confusion.

### 2. Every piece of work answers six questions
Wherever work appears — Home, My Work, a notification — it shows, in this order of importance:

**What** · **Who** (customer/contact) · **Where** · **When** · **Priority** (only if high/urgent) ·
**Next action**

Status is shown only when it is not the default. An employee's list of "Assigned" items does not
need an "Assigned" badge on every row.

### 3. Minimum first, more on request (progressive disclosure)
Show the four or five fields that matter; put the rest behind **Add more details**.

Creating a lead asks for *Company, Contact, Phone, Requirement*. Address, industry, source, email and
notes are one tap away — never forced. Detail pages lead with the summary and actions; history and
secondary facts come after.

### 4. One obvious primary action
Each screen and each work item has at most **one** filled (primary) button. Everything else is
secondary or a link. If you cannot decide which action is primary, the screen is doing too much.

### 5. Don't ask twice
- Never ask for information the system already has. Choosing a customer pre-fills the address,
  contact and phone.
- Smart defaults: new work defaults to *today*, *normal* priority, and *assigned to me* (unless the
  person's job is assigning work).
- Autocomplete existing customers and contacts before allowing a new one, to prevent duplicates.
- One action records everything it implies: tapping **Call** and choosing *Connected* logs the call,
  updates the lead and counts towards the day's metrics.

### 6. AI proposes, people confirm
AI may fill in a form; it does not submit it. Extracted information is shown for review with
low-confidence fields highlighted, and the person confirms. AI never silently creates or changes
customers, leads, assignments or money. Ask PTCC shows what it is about to do and asks before doing it.

### 7. Field-first on mobile
Collection staff use PTCC on a phone, outdoors, often one-handed, on patchy networks:
- Primary actions sit in the bottom half of the screen within thumb reach.
- Touch targets are at least 44 × 44 px; key actions are full-width.
- Text is at least 16 px; contrast meets WCAG AA in sunlight-friendly light mode.
- **Call**, **WhatsApp** and **Start route** open the phone's own apps — no copying numbers or addresses.
- Forms survive interruption (a dropped connection must not lose a typed note).

### 8. Desktop for decisions
CEO, HR/Coordinator, Marketing and Accounts work mostly at a desk. Desktop layouts favour
scanning and comparing: readable lists with clear grouping rather than dense spreadsheets, keyboard
friendly forms, and enough context on one screen to make a decision without opening five tabs.

### 9. Honest interface
- No fake numbers, demo charts or buttons that do nothing. If a feature is not built, the screen
  says so plainly ("Customers arrives in Phase 2").
- Empty states say what the list is for and what to do next ("No work for today. New work assigned
  to you appears here.").
- Errors say what happened and what to do, in plain language ("That phone number is already used by
  Arun Kumar.") — never codes or stack traces.

### 10. Calm, fast, consistent
- Colour carries meaning (status, priority, action) — it is not decoration. No gradients, no glowing
  "AI" effects, no large colourful tiles.
- Motion only confirms something happened (a 150 ms fade or slide), never decorates.
- The same thing looks and behaves the same everywhere: one status pill, one work row, one
  person/avatar treatment.
- Pages load fast and show their structure immediately; skeletons match the final layout.

---

## Indian formats and conventions

| Thing | Format | Example |
|---|---|---|
| Currency | ₹ with Indian digit grouping | ₹1,25,000 |
| Large amounts (summaries) | Lakh / crore | ₹12.4 L · ₹1.2 Cr |
| Time | 12-hour with AM/PM | 10:30 AM |
| Relative dates | Today / Tomorrow / Yesterday, then short date | Tomorrow · Wed, 14 Oct |
| Full date | Weekday, day month | Thursday, 8 October |
| Phone (display) | 5 + 5 grouping, country code hidden for Indian mobiles | 98765 43210 |
| Phone (stored) | E.164 | +919876543210 |
| Financial year | April–March | FY 2026-27 |
| Time zone | All "today" logic uses India Standard Time (Asia/Kolkata) | — |

Greetings use the person's first name and IST time of day: *Good morning* (before 12:00),
*Good afternoon* (12:00–16:59), *Good evening* (17:00 onward).

## Writing style

- Sentence case everywhere ("Add more details", not "Add More Details"). No ALL-CAPS labels.
- Buttons are verbs that say what happens: **Mark collected**, **Assign**, **Start route**,
  not "Submit", "OK" or "Proceed".
- Short. Remove words until the meaning changes.
- Address the person as "you"; refer to colleagues by first name.
- Confirmations describe the result: "Pickup assigned to Arun. He's been notified."

## Screen patterns

| Pattern | Use for | Rules |
|---|---|---|
| **Briefing** (Home) | Starting the day | Greeting → counts → next up → rest. No charts for employees. |
| **List** | My Work, Customers, Collections | Grouped by what matters (Overdue / Today / Upcoming). Row = what + who/where + when + one action. Filters as a small segmented control, not a filter panel. |
| **Detail** | A work item, customer, lead | Title + status → primary actions → key facts → history. Secondary facts collapsed. |
| **Form** | Create / edit | 3–5 visible fields, "Add more details" for the rest, one primary submit, inline validation messages under the field. Full page on mobile; never a cramped modal. |
| **Confirm** | AI extraction, destructive actions | Show exactly what will be saved or changed, then one clear confirm button. |

## Checklist for every new screen

Before a screen is considered done:

- [ ] Who is this screen for, and what is the one thing they come here to do?
- [ ] Is that action the single primary button?
- [ ] Does each work item show what / who / where / when / next action?
- [ ] Are there fields or numbers that nobody acts on? Remove them.
- [ ] Is there an honest empty state and a plain-language error state?
- [ ] Does it work at 360 px wide with one thumb? Does it scan well at 1440 px?
- [ ] Does it only show data the person is permitted to see (checked on the server)?
- [ ] Does it reuse existing components and words from this document?
