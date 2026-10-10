# PTCC — Design System

The visual language of PTCC: calm, precise, readable — fitting for a calibration laboratory.
It is derived from the PTCC logo (Precise blue, with the pink of the pin's centre used sparingly),
set in IBM Plex, and built on hairline borders rather than shadows and colourful cards.

Tokens are implemented in [`src/app/globals.css`](../src/app/globals.css) (Tailwind v4 `@theme`).
Components live in [`src/components/ui`](../src/components/ui). Behavioural rules are in
[UX_PRINCIPLES.md](UX_PRINCIPLES.md).

---

## 1. Character

| We are | We are not |
|---|---|
| Precise — aligned, consistent, measured | Decorative — gradients, glows, illustrations |
| Calm — mostly neutral, colour means something | Loud — every card a different colour |
| Readable — generous type, strong contrast | Dense — tiny grey text, 12-column tables |
| Direct — obvious actions, plain words | Clever — hidden gestures, jargon |

## 2. Colour

### Brand
| Token | Hex | Use |
|---|---|---|
| `brand-500` | `#1482C3` | Logo blue. Brand marks, focus ring, selected indicators. Not for small text (4.2:1). |
| `brand-600` | `#0F6FA8` | **Primary actions** and links (5.4:1 on white). |
| `brand-700` | `#0B5A8A` | Hover / pressed primary. |
| `brand-100` | `#D8EAF6` | Selected backgrounds (strong). |
| `brand-50`  | `#EEF6FB` | Selected nav item, in-progress tint. |
| `accent-500` | `#D42D5D` | Logo pink. **Sparingly**: the brand mark and the unread-notification dot. Never for errors. |

### Neutrals (slightly warm, to avoid a sterile look)
| Token | Hex | Use |
|---|---|---|
| `canvas` | `#F6F6F3` | App background |
| `surface` | `#FFFFFF` | Panels, rows, inputs |
| `subtle` | `#EFEFEB` | Hover rows, neutral pills, skeletons |
| `line` | `#E2E2DC` | Hairline borders and dividers |
| `line-strong` | `#CBCBC4` | Input borders, emphasised dividers |
| `ink` | `#1A1C1E` | Primary text |
| `ink-muted` | `#5B5F66` | Secondary text (6.4:1) |
| `ink-subtle` | `#6E727A` | Tertiary text, placeholders (4.7:1) |

### Semantic
| Meaning | Text | Background | Use |
|---|---|---|---|
| Success | `#1E7A3C` | `#E9F5EC` | Completed, delivered |
| Warning | `#8F5200` | `#FFF4E0` | Pending (unassigned), due soon |
| Danger | `#B42318` | `#FDECEA` | Overdue, urgent, errors, destructive actions |
| Info / progress | `brand-700` | `brand-50` | In progress |
| Teal | `#0E6159` | `#E4F3F1` | Collected (in transit to PTCC) |

### Status pills
Status is always **text + small dot**, never colour alone.

| Status | Label | Tone |
|---|---|---|
| `pending` | Pending | Warning |
| `assigned` | Assigned | Neutral (often hidden — it is the default) |
| `in_progress` | In progress | Info |
| `collected` | Collected | Teal |
| `delivered` | Delivered | Success |
| `completed` | Completed | Success |
| `cancelled` | Cancelled | Neutral, muted text |

Priority tags appear **only** for `high` (warning tone, "High") and `urgent` (danger tone, "Urgent").

## 3. Typography

**IBM Plex Sans** for everything; **IBM Plex Mono** only for reference numbers (`#1042`,
`PCL-2026-00318`). Plex was designed for engineering contexts, has excellent legibility at small
sizes and tabular figures — appropriate for a measurement company and distinct from the default
"Inter" look.

Root size is **16 px on phones** and **15 px on desktop (≥ 1024 px)**; all sizes are in rem, so
desktop gets slightly more density automatically.

| Token | Size / line height | Weight | Use |
|---|---|---|---|
| `text-display` | 2rem / 2.5rem | 600 | Home counts |
| `text-2xl` | 1.5rem / 2rem | 600 | Page titles |
| `text-lg` | 1.125rem / 1.625rem | 600 | Section headings, Next-up title |
| `text-base` | 1rem / 1.5rem | 400/500 | Body, row titles, inputs |
| `text-sm` | 0.875rem / 1.25rem | 400/500 | Secondary info, labels, buttons (sm) |
| `text-xs` | 0.75rem / 1rem | 500 | Pills, tags, timestamps |

Rules: sentence case; no all-caps labels; numbers use tabular figures (`tabular-nums`);
maximum reading width ~70 characters for prose.

## 4. Space, shape and depth

- **Spacing** uses the 4 px scale (Tailwind default): 4, 8, 12, 16, 20, 24, 32, 40, 48, 64.
  Related items: 8–12. Groups: 24. Sections: 32–48.
- **Radius**: `6px` buttons and inputs · `10px` panels and list containers · full for pills/avatars.
- **Depth**: 1 px hairline borders (`line`) define surfaces. Shadows only for things that float
  (menus, toasts, the mobile action bar). No stacked drop-shadow cards.
- **Icons**: lucide, 1.75 px stroke, 16 px inline with text, 20 px in navigation. Icons accompany
  labels; icon-only buttons need an accessible label.

## 5. Layout

| Breakpoint | Layout |
|---|---|
| < 1024 px (phone/tablet) | Top bar (page title, notifications) · content (16 px gutters) · **bottom navigation** (4 destinations + More, safe-area aware) |
| ≥ 1024 px (desktop) | **Left sidebar** 15.5rem: logo, ≤ 6 main destinations, *Manage* group, person + sign out · content with 32 px gutters |

- Content width: lists and forms max **48rem**; overview pages max **72rem**.
- Lists are **grouped rows inside one bordered container**, not a grid of cards.
- Tables are used only on desktop and only when people genuinely compare columns (Admin people list,
  later finance). On mobile every table collapses to rows.

## 6. Components (Phase 1)

| Component | Purpose | Notes |
|---|---|---|
| `Button` / `ButtonLink` | Actions | Variants: `primary` (one per view), `secondary` (bordered), `ghost` (quiet), `danger`. Sizes `sm` (32 px), `md` (40 px), `lg` (48 px, mobile primary). |
| `SubmitButton` | Form submit with pending state | Disables and shows "Saving…" while the action runs. |
| `Field` | Label + control + hint + error | Error text sits under the field in danger colour with an icon. |
| `Input`, `Textarea`, `Select` | Controls | 40 px (44 px on phones) height, `line-strong` border, brand focus ring. 16 px text on phones prevents iOS zoom. |
| `Choice` (segmented radio) | Small sets of options (task kind, priority) | Visible options beat dropdowns when there are ≤ 5. |
| `MoreDetails` | Progressive disclosure | Native `<details>`; "Add more details" summary. |
| `StatusPill`, `PriorityTag` | Status / priority | See §2. |
| `Avatar` | Person | Initials on a neutral tint; deterministic per person. |
| `PageHeader` | Title, optional description, actions | One per page. |
| `Section` | Heading + content group | |
| `List`, `ListRow` | Grouped rows | Row: leading icon · title · meta line · trailing time/action. Whole row is a link; trailing action buttons are separate targets. |
| `EmptyState` | Nothing to show | Says what appears here and what to do. No illustrations. |
| `Notice` | Inline message | Tones: info, success, warning, danger. |
| `Skeleton` | Loading placeholders | Match final layout to avoid jumps. |
| `Stat` | Big number + label | Home counts. Never more than four in a row. |
| `FlowStrip` | A → B → C counts | CEO flows. |

## 7. Patterns

**Work row** — the most repeated element in PTCC:

```
[icon]  Pickup at ABC Engineering                     10:30 AM
        Peenya · Rajesh · #1042           [Urgent]   [Start route]
```

Icon = work kind. Title = *what*. Meta = *where · who · reference*. Trailing = *when* and at most one
action. Status pill appears only when not the default.

**Next up panel** — one bordered panel, title in `text-lg`, facts in a two-column definition list
(What/Who/Where/When), action buttons full-width on mobile, inline on desktop.

**Forms** — single column; labels above fields; 4–5 visible fields; *Add more details* for the rest;
primary submit at the end (sticky at the bottom on phones for long forms).

## 8. Accessibility

- WCAG 2.2 AA contrast for all text and controls (tokens above are chosen to pass).
- Visible focus ring on every interactive element: 2 px `brand-500` outline with 2 px offset.
- All functionality available by keyboard; logical tab order; skip link to main content.
- Touch targets ≥ 44 × 44 px on phones.
- Status never conveyed by colour alone (text + dot).
- Forms: every control has a `<label>`; errors are linked with `aria-describedby` and announced.
- Respect `prefers-reduced-motion` (motion is minimal anyway).

## 9. Motion

Only for feedback: 150 ms ease-out on hover/press colour changes and on disclosure open/close.
No page-load animations, no number count-ups, no parallax.

## 10. Dark mode

Not in Phase 1 — field use favours a high-contrast light theme. All colours are tokens, so a dark
theme is a matter of redefining variables under a `data-theme="dark"` selector later.

## 11. Don'ts

- ❌ Gradients, glassmorphism, neon "AI" accents, sparkle icons for AI.
- ❌ Large colourful stat cards; more than four numbers in a row; charts for employees.
- ❌ Dropdowns for ≤ 5 options (use visible choices).
- ❌ Modals for forms on mobile (use full pages).
- ❌ ALL-CAPS headings, letter-spaced labels, grey text below 4.5:1.
- ❌ Using `accent-500` (pink) for errors or warnings.
