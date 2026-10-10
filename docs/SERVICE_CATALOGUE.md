# PTCC — Service Catalogue (Accredited Scope)

This document explains how PTCC's **NABL scope of accreditation** is represented in the platform:

- where the data comes from;
- how it is extracted, checked and versioned;
- how the rest of the platform uses it.

**The rule:** the platform only says PTCC is accredited for something when a current row of PTCC's own scope documents says so, for that branch. Anything else is shown as **"Scope not confirmed — verify with PTCC"**. The scope is **controlled reference information**. It is not marketing content, it is never typed into code or screens, and it is never edited by hand.

---

## 1. Sources

| File (as uploaded) | SHA-256 | What it contains |
|---|---|---|
| `all branch scope.pdf` | `98cd429317ba61d289363d64a002679041bff6b16cc04b1fa4f8e8bf9e2c7d59` | The scope annexures of the three certificates: 151 pages of ruled tables |
| `all branch certificates.pdf` | `909ca87a9089377db58a7cf95b470d422ddfcabd85b837c8caa7de1675815a23` | The three NABL certificates of accreditation |

The certificates (ISO/IEC 17025:2017, field: Calibration, legal entity *Precise Testing and Calibration Centre Private Limited*):

| Certificate | Branch (confirmed by PTCC) | Valid | Last amended | Scope pages | Scope rows |
|---|---|---|---|---|---|
| NABL **CC-2467** | Bengaluru | 6 Dec 2024 – 5 Dec 2028 | 25 Jan 2025 | 119 | 624 (265 on site) |
| NABL **CC-2822** | Chennai | 28 Oct 2024 – 27 Oct 2028 | 5 Nov 2024 | 17 | 97 (8 on site) |
| NABL **CC-3649** | Hosur | 24 Jul 2025 – 23 Jul 2029 | 17 Aug 2025 | 15 | 86 (37 on site) |

How each certificate is linked to a branch:

- The links are recorded in `data/scope/branches.json`. PTCC confirmed them in the Phase 2 brief, and each also matches the facility address printed on the certificate.
- **Hyderabad**, the fourth branch, is registered with the details PTCC supplied (`data/branches/ptcc-branches.json`), but **its accreditation is not verified**: no certificate number, validity or scope has been provided. It therefore has no accredited scope in the platform.
  - Services accredited at Bengaluru, Chennai or Hosur are **not** assumed to be available at Hyderabad.
  - A Hyderabad lead asking for them shows "In ⟨branch⟩'s scope, not this branch's — verify with PTCC".
  - Free-text requests show "Scope not confirmed — verify with PTCC".
  - The Services page and the Admin branch screens say "Accreditation not verified".

  This stays so until PTCC supplies the official documents (see §6).

## 2. The data model

The structured model from the brief maps onto the documents' columns as follows. Text is stored **exactly as printed**, with words wrapped across lines joined by a space. The examples are row 291 of CC-2467 (PDF page 85).

| Brief | Stored as | Example |
|---|---|---|
| Discipline | `scope_disciplines.name` (+ display `label`) | MECHANICAL → "Mechanical" |
| Group | `scope_groups.name` (+ `label`) | PRESSURE INDICATING DEVICES → "Pressure indicating devices" |
| Instrument / Material | `scope_entries.measurand_or_instrument` | "Pressure (Hydraulic) Pressure Gauges/ Switches/ Differential Pressure Transmitter/ Transducers with Indicator" |
| Calibration / Measurement · Method / Procedure | `scope_entries.method`, the document's *Calibration or Measurement Procedure / Method* column | "Using Digital Pressure Gauge and Calibrator using Hydraulic Comparator pump with pressure indicator, Handy Calibrator by Comparison method as per DKD-R6-1" |
| Measurement range | `scope_entries.range_text` | "0 to 700 bar" |
| CMC (calibration and measurement capability) | `scope_entries.cmc_text` | "0.13 %rdg" |
| Facility type | `scope_entries.facility_type`: `permanent` (at the lab) or `site` (at the customer) | permanent |
| Branch | `accreditations.branch_id`, through the entry's certificate | Bengaluru |
| Accreditation / certificate reference | `scope_entries.accreditation_id` → `accreditations.certificate_number`; plus `serial_number`, `pdf_page` and `annexure_page` | CC-2467, S.No. 291, PDF page 85 (annexure page 53) |

The tables involved:

- **`scope_documents`**: each imported source file, identified by SHA-256 (so a file is never imported twice), with who imported it and when.
- **`accreditations`**: one row per certificate, with:
  - body, standard, field, legal entity and facility address;
  - issue date, validity and last amendment;
  - `branch_id` and `branch_link_status` (`confirmed` | `needs_verification`).
- **`scope_disciplines`, `scope_groups`**: headings as printed, plus sentence-case labels for display.
- **`scope_entries`**: one row per scope table row. Besides the fields above, each row keeps:
  - `serial_number`;
  - `raw`, the six original cells including line breaks, so every value can be traced to the page;
  - `search_text` and `search_compact`, used for search;
  - `is_current`.

Where a service is offered comes from its rows, not from a flag on the branch: *a branch can do a calibration when a current row of a valid certificate linked to that branch says so.* No branch is assumed to do everything.

## 3. From PDF to database

```
  PTCC's PDFs ──► tools/scope-parser/parse_scope.py ──► data/scope/ptcc-nabl-scope.json ──► npm run scope:import ──► database
  (source)        faithful extraction, no interpretation     controlled file (ptcc-scope/v1)      validated, idempotent,
                                                             + data/scope/branches.json            versioned import
```

1. **Parse** (Python, `pdfplumber==0.11.10`). Run once per new document:

   ```bash
   python -I tools/scope-parser/parse_scope.py "<scope.pdf>" "<certificates.pdf>" data/scope/ptcc-nabl-scope.json
   ```

   The parser:
   - reads the ruled tables using pdfplumber's line strategy, and turns line breaks inside a cell into single spaces;
   - expands ligatures (ﬁ, ﬂ, …) and repairs one double-encoded quotation mark seen in the source;
   - keeps units and symbols (µ, °, ±, ½, ²).

   It does **not** rename, merge or correct anything.

   It reports *anomalies*, such as:
   - a page without a certificate number;
   - an unrecognised row;
   - a row without a serial number;
   - an annexure whose page count differs from the "Page x of N" it declares;
   - a certificate without an annexure.

   The current file has **807 rows and no anomalies**. Its page counts match the declared totals (15 / 17 / 119), and serial numbers are continuous in every section.
2. **Review** the JSON diff before committing it. It is a text file in the repository, so every change to PTCC's scope is visible in review.
3. **Import:** `npm run scope:import`. This is also part of `npm run db:setup`. The importer (`src/modules/catalogue/import.ts`):
   - validates the whole file (Zod) and **refuses a file with anomalies**;
   - splits *Discipline/Group* using the four disciplines found in the documents: Electro-technical, Mechanical, Thermal, Fluid flow. An unknown heading **stops the import**, so a person looks at it.
   - is **idempotent**: a source document whose SHA-256 is already imported is skipped. Certificate details and branch links are refreshed.
   - **versions** the data: rows from an earlier document for the same certificate are marked `is_current = false` and **kept**, because leads and quotations may refer to them.
   - links each certificate to its branch from `branches.json`. A branch named there is created if missing, and marked verified. A certificate *not* listed is imported with `branch_link_status = needs_verification` and no branch.
   - records a `scope.import` entry in the activity log.

## 4. How the platform uses the scope

- **Services page** (Customers → Services): one card per certificate (branch, validity, rows at lab and on site), search, and a table of how many rows each branch has per group. A dash means the branch is not accredited for that group.
- **Service selector** on leads (and the requirement editor):
  - search by instrument, method or range, grouped by instrument;
  - every row shows its branch, range, CMC and facility type;
  - the lead's branch is listed first;
  - rows of other branches are marked *Not in ⟨branch⟩'s scope*;
  - when nothing matches: *"Not found in PTCC's accredited scope. Scope not confirmed — verify with PTCC"*, and the requirement can be added as free text.
- **Requirement status.** Every requirement on a lead is checked against the lead's branch (`src/modules/catalogue/status.ts`). The check is a pure function and is unit-tested.

  | Status | Shown as | When |
  |---|---|---|
  | `in_scope` | In ⟨branch⟩'s accredited scope | A current row of a valid certificate linked to the lead's branch |
  | `other_branch` | In ⟨other⟩'s scope, not this branch's — verify with PTCC | The row belongs to another branch |
  | `not_confirmed` | Scope not confirmed — verify with PTCC | Free text, not linked to a scope row |
  | `branch_unverified` | Certificate's branch needs verification | The certificate is not linked to a confirmed branch |
  | `expired` | Accreditation ⟨CC-…⟩ has expired — verify with PTCC | Past the certificate's *valid until* date |
  | `superseded` | From an earlier version of the scope — verify with PTCC | The row was replaced by a newer document |
  | `branch_unknown` | Branch not assigned yet — scope can't be checked | The lead has no branch yet |

- **Quotation lines** may reference a scope row, so the line's description comes from the scope. Prices are typed by the marketer: the scope has no prices, and no price list is invented.
- **AI capture** (future): instruments mentioned in a voice note or photo are used as *search hints* only. A person picks the row; the AI never asserts scope.
- **Search** uses two keys:
  - `search_text`: lower-cased words of the discipline, group, instrument, method and range;
  - `search_compact`: letters and digits only. This tolerates words the PDF wrapped mid-word ("Veloci ty").

  Plural query words also match their singular ("gauges" finds "gauge").

## 5. What each branch is accredited for

Rows per group, from the current documents. "On site" means the row's facility type is the customer's site.

| Discipline | Group | Bengaluru (CC-2467) | Chennai (CC-2822) | Hosur (CC-3649) |
|---|---|---|---|---|
| Electro-technical | Alternating current (< 1 GHz) (measure) | 68 (34 on site) | — | — |
| Electro-technical | Alternating current (< 1 GHz) (source) | 168 (84 on site) | — | — |
| Electro-technical | Direct current (measure) | 50 (25 on site) | — | — |
| Electro-technical | Direct current (source) | 52 (26 on site) | — | — |
| Electro-technical | Electrical equipment (source) | 12 (6 on site) | — | — |
| Electro-technical | Temperature simulation (measure) | 21 (10 on site) | — | — |
| Electro-technical | Temperature simulation (source) | 22 (11 on site) | — | — |
| Electro-technical | Time & frequency (measure) | 12 (6 on site) | — | — |
| Electro-technical | Time & frequency (source) | 8 (4 on site) | — | — |
| Fluid flow | Flow measuring devices | — | — | 4 (1 on site) |
| Mechanical | Acceleration and speed | 9 (3 on site) | 6 (2 on site) | — |
| Mechanical | Acoustics | — | 2 | — |
| Mechanical | Density and viscosity | 1 | — | 1 |
| Mechanical | Dimension (basic measuring instrument, gauge etc.) | 78 (3 on site) | 68 (1 on site) | 32 (1 on site) |
| Mechanical | Dimension (precision instruments) | 8 (7 on site) | 11 (2 on site) | — |
| Mechanical | Durometer | — | — | 2 |
| Mechanical | Force proving instruments | — | 1 | — |
| Mechanical | Hardness testing machines | — | — | 14 (14 on site) |
| Mechanical | Mobile force measuring system | — | 1 | — |
| Mechanical | Pressure indicating devices | 10 (5 on site) | 6 (3 on site) | 4 (3 on site) |
| Mechanical | Torque generating devices | 4 | — | — |
| Mechanical | Torque measuring devices | — | 2 | — |
| Mechanical | UTM, tension creep and torsion testing machine | 8 (8 on site) | — | — |
| Mechanical | Volume | 20 | — | — |
| Mechanical | Weighing scale and balance | 7 (7 on site) | — | — |
| Mechanical | Weights | 23 | — | — |
| Thermal | Specific heat & humidity | 5 (3 on site) | — | 4 (2 on site) |
| Thermal | Temperature | 38 (23 on site) | — | 25 (16 on site) |
| **Total** | 28 groups | 624 (265 on site) | 97 (8 on site) | 86 (37 on site) |

Differences worth knowing when routing leads:

- Electro-technical calibration is accredited **only at Bengaluru**.
- Hardness testing machines, durometers and flow measuring devices are accredited **only at Hosur**.
- Acoustics, force-proving instruments and torque *measuring* devices are accredited **only at Chennai**.
- Temperature is accredited at Bengaluru and Hosur, **not** Chennai.

These differences follow from the documents. The platform does not decide routing from them; it only shows the facts while people decide.

This table can be regenerated from `data/scope/ptcc-nabl-scope.json`; the Services page shows the same numbers live from the database.

## 6. When the scope changes

| Event | What to do |
|---|---|
| NABL amends a certificate's scope | 1. Parse the new PDF (§3). 2. Review the JSON diff. 3. Commit it. 4. Run `npm run scope:import`. The new rows become current; the old rows stay, marked superseded. |
| A new certificate (e.g. for Hyderabad) | 1. Parse it. 2. Once PTCC confirms which branch it belongs to, add the certificate → branch line to `data/scope/branches.json`. 3. Import. Until the line is added, it is imported as *needs verification* and is not any branch's scope. |
| A certificate expires | Nothing needs to be deleted. Requirements linked to its rows show *expired — verify with PTCC* until a renewed certificate is imported. |
| A row looks wrong | Do not edit the database or the JSON by hand. Check the PDF page (`pdf_page`). If the PDF itself is wrong, PTCC raises it with NABL; the platform reflects the documents. |

Admins can review what is loaded under **People & access → Scope**: certificates, branch link status, validity, row counts, and source documents with their SHA-256.

## 7. Known limits

- Ranges and CMCs are text, as printed. Searching "0 to 700 bar" works as text; there is no numeric range matching ("is 650 bar covered?"). If PTCC needs that, the range text can be parsed into structured min/max values later, checked row by row against the PDF.
- The documents contain a few spelling variants (e.g. "Annemometer"). They are kept as printed. Search tolerance covers wrapped words, not misspellings.
- Prices, turnaround times and which instruments a branch *prefers* to take are not in the documents, so they are not in the catalogue.
