# DD Report Assembly

## Purpose

Assemble a Due Diligence Report Google Doc from structured Sindri work unit data. The agent reads structured data only — no raw PDFs, no Wrike lookups, no re-running skills. All source data arrives via Sindri work unit outputs from upstream pipeline stages.

## When This Skill Runs

This is Sindri Work Unit 13 (WU-13). It fires when the readiness threshold is met. All of the following must be present in Sindri — the report does not run on partial data:

**Required (hard gate — report will not generate without these):**
- `sir_ai` — AI SIR extraction must be complete
- `sir_vendor` — Vendor SIR extraction must be complete
- `inspection_vendor` — Vendor Building Inspection extraction must be complete
- `isp_extract` — ISP extraction must be complete
- `school_approval` — School approval analysis must be complete
- `cost_estimates` — RayCon cost estimates must be complete
- `opening_plan` — Opening plan must be complete
- `site_meta` — Site record must exist

**Expected (report will generate but will flag gaps):**
- `sir_delta` — AI vs vendor SIR diff (expected if both sir_ai and sir_vendor exist)
- `inspection_delta` — AI vs vendor inspection diff
- `permit_history` — Shovels permit history

If any required work unit is missing, the agent logs which data is absent and does not proceed. It writes a `readiness_failure` record to Sindri listing the missing work units so the orchestrator can track what's blocking.

## Input Contract

The agent receives a single JSON payload assembled from Sindri work unit outputs:

```json
{
  "site_meta": {},           // from WU-01 — REQUIRED
  "sir_ai": {},              // from WU-02 — REQUIRED
  "sir_vendor": {},          // from WU-06 — REQUIRED
  "school_approval": {},     // from WU-03 — REQUIRED
  "inspection_vendor": {},   // from WU-07 — REQUIRED
  "isp_extract": {},         // from WU-08 — REQUIRED
  "cost_estimates": {},      // from WU-10 — REQUIRED
  "opening_plan": {},        // from WU-12 — REQUIRED
  "sir_delta": {},           // from WU-09 — expected, may be null
  "inspection_delta": {},    // from WU-09 — expected, may be null
  "permit_history": {},      // from WU-11 — expected, may be null
  "source_doc_urls": {}      // Drive URLs for each source document
}
```

See `references/sindri-input-schemas.md` for the full schema of each work unit's output.

---

## Processing Steps

### Step 1: Resolve Data Sources (Vendor > AI Precedence)

For every field that has both an AI and vendor version, apply vendor > AI precedence:

| Data Domain | Vendor Source (preferred) | AI Fallback | Resolution Field |
|---|---|---|---|
| SIR findings | `sir_vendor` | `sir_ai` | `sir_best` |
| Inspection findings | `inspection_vendor` | (inferred from sir_ai Phase 7) | `inspection_best` |

Resolution logic:
```
For each field in the shared schema:
  1. If sir_vendor.{field} is not null → use sir_vendor.{field}
  2. Else if sir_ai.{field} is not null → use sir_ai.{field}
  3. Else → mark as "[Not found - {field_label} not available from any source]"
```

Track which source was used for each field in a `data_provenance` dict for the trace report.

### Step 2: Populate Meta Tokens (7 tokens)

Map from `site_meta` (WU-01):

| Token | Source Field | Fallback |
|---|---|---|
| `meta.site_name` | `site_meta.site_id` + address → "Alpha {City}" | `[Not found - site name]` |
| `meta.city_state_zip` | `site_meta.city`, `site_meta.state` | `[Not found - address]` |
| `meta.school_type` | `site_meta.school_type` | `K-8 Microschool` |
| `meta.marketing_name` | derived from site_meta or RHODES | `meta.site_name` value |
| `meta.report_date` | Current date | Auto: `MM/DD/YYYY` |
| `meta.prepared_by` | `site_meta.p1_name` | `[Not found - P1 not set]` |
| `meta.drive_folder_url` | `site_meta.drive_folder_url` | `[Not found - Drive folder]` |

### Step 3: Populate "Can We Open?" Card (4 tokens)

The card answers the question: **"Can we open this school in time for the current school year?"**

The current school year opening deadline is **August 12, 2026**. This date is the hard cutoff for the `exec.c_answer` timeline test.

These four pick-menu dimensions determine the executive answer. Each must resolve to exactly one allowed value.

#### exec.c_zoning

Source: `sir_best.zoning_status`

| SIR Value | Token Value |
|---|---|
| "Permitted by right" | `Permitted by right` |
| "Administrative Use Permit" / "Minor Use Permit" | `Use Permit Required (Admin approval)` |
| "Conditional Use Permit" / "Special Use Permit" / "Public Hearing Required" | `Use Permit Required (Public approval)` |
| "Prohibited" / "Not permitted" | `Prohibited` |
| null / unknown | `[Not found - SIR zoning not available]` |

#### exec.c_occupancy

Source: `sir_best.feasibility.occupancy_compatibility` + `sir_best.e_occupancy_score`

| Condition | Token Value |
|---|---|
| Current occupancy is Group E (or equivalent educational) | `Has E-Occupancy` |
| Change of use required AND e_occupancy_score >= 60 | `Change of use required, meets E-Occupancy` |
| Change of use required AND e_occupancy_score < 60 | `Change of use required, needs work` |
| null / unknown | `[Not found - occupancy path not assessed]` |

#### exec.c_edreg

Source: `school_approval` (WU-03)

| Condition | Token Value |
|---|---|
| `school_approval.archetype` = "MINIMAL" | `Not required` |
| `school_approval.archetype` = "NOTIFICATION" AND state where Alpha already operates | `Not required` |
| `school_approval.gating_before_open` = false | `Not required` |
| `school_approval.gating_before_open` = true AND state where Alpha already has approval | `Required and have done` |
| `school_approval.gating_before_open` = true AND no prior state presence | `Required have not done` |
| null | `[Not found - school approval not assessed]` |

#### exec.c_answer

Synthesize from the three dimensions above plus a timeline feasibility test.

**Timeline test:** Calculate the best-case open date from `opening_plan.scenarios.best.target_date`. If the best-case date falls after **August 12, 2026**, the answer is `No` regardless of the other dimensions.

Evaluation order (first match wins):

| # | Condition | Value | Reason |
|---|---|---|---|
| 1 | c_zoning = "Prohibited" | `No` | Zoning blocks the use entirely |
| 2 | c_occupancy = "needs work" AND best-case open date > Aug 12, 2026 | `No` | Occupancy conversion can't finish in time |
| 3 | Best-case open date > August 12, 2026 (from opening_plan) | `No` | Even the fastest path misses the school year |
| 4 | Any dimension = "Not found" | `Yes see notes` | Incomplete data — can't confirm |
| 5 | c_edreg = "Required have not done" | `Yes see notes` | Regulatory approval outstanding |
| 6 | c_zoning = "Public approval" | `Yes see notes` | Public hearing outcome uncertain |
| 7 | All dimensions green AND best-case open date ≤ Aug 12, 2026 | `Yes` | Clear path to open on time |

### Step 4: Populate Build Scenarios (up to 16 tokens)

Three scenarios today: Fastest Open, Max Capacity, and Recommended Path. Max Value gets a gap label until that data source is added.

#### Fastest Open

| Token | Source | Format |
|---|---|---|
| `exec.fastest_open_capacity` | `isp_extract.capacity_tiers.micro.max_students` | Integer |
| `exec.fastest_open_capex` | `cost_estimates.scenarios[name="Light renovation"].total` | Dollar: `$XXX,XXX` |
| `exec.fastest_open_open_date` | `opening_plan.scenarios.best.target_date` | `MM/YY` |

The open date comes from the Opening Plan (WU-12), which already factors in permit timelines and construction duration from its own scenario analysis. Do not calculate construction timelines independently — the Opening Plan is the single source of truth for dates.

If `opening_plan.scenarios.best` does not include a construction duration breakdown, set the date to: `[Cannot estimate — Opening Plan does not include construction duration. Missing: {list what the Opening Plan needs from upstream to compute this}]`

#### Max Capacity

| Token | Source | Format |
|---|---|---|
| `exec.max_capacity_capacity` | `isp_extract.capacity_tiers.250.max_students` (or `.1000` if school_type = "1000") | Integer |
| `exec.max_capacity_capex` | `cost_estimates.scenarios[name="Full buildout"].total` | Dollar: `$XXX,XXX` |
| `exec.max_capacity_open_date` | `opening_plan.scenarios.worst.target_date` | `MM/YY` |

Same rule: dates come from the Opening Plan. Do not fabricate construction duration estimates.

#### Recommended Path (Inferred)

Recommended Path is inferred by comparing Fastest Open and Max Capacity. The logic:

```
1. Can both Fastest Open and Max Capacity complete before August 12, 2026?
   a. YES → Both are on time. Compute capacity_per_dollar for each:
      - capacity_per_dollar = capacity / capex
      - The scenario with the higher capacity_per_dollar wins → that becomes Recommended Path
   b. NO (only Fastest Open is on time) → Fastest Open = Recommended Path
   c. NO (neither is on time) → Fastest Open = Recommended Path (least delay)

2. When Max Value data is added in the future:
   a. If all three (Fastest, Max Capacity, Max Value) can complete on time:
      - Compute capacity_per_dollar for all three
      - Highest capacity_per_dollar wins → Recommended Path
   b. If only some can complete on time:
      - Filter to on-time scenarios only
      - Highest capacity_per_dollar among on-time scenarios wins
```

| Token | Source | Format |
|---|---|---|
| `exec.recommended_path_capacity` | Copied from the winning scenario | Integer |
| `exec.recommended_path_capex` | Copied from the winning scenario | Dollar: `$XXX,XXX` |
| `exec.recommended_path_open_date` | Copied from the winning scenario | `MM/YY` |

Include a note in the trace report explaining which scenario was selected and why (capacity_per_dollar ratio or timeline constraint).

#### Max Value

| Scenario | Gap Label |
|---|---|
| Max Value | `[Not found — Max Value scenario data not yet available in the pipeline]` |

#### Missing Data Handling for Scenarios

Do not use default or assumed construction timelines. When a date cannot be computed because the Opening Plan lacks sufficient data:

| What's Missing | Gap Label |
|---|---|
| Opening Plan has no construction duration | `[Cannot estimate — construction duration not available from Opening Plan. Need: RayCon scope-to-duration mapping or GC estimate]` |
| Opening Plan best-case scenario missing entirely | `[Cannot estimate — Opening Plan did not produce a best-case scenario. Need: complete SIR + inspection data for scenario modeling]` |
| Cost estimates missing for a scenario | `[Cannot estimate — RayCon did not return cost data for this scenario. Need: ISP room data + inspection findings]` |
| ISP capacity tier missing | `[Cannot estimate — ISP extraction did not produce capacity for this tier. Need: complete room inventory with SF measurements]` |

### Step 5: Populate Cost Breakdown (48 tokens)

Map from `cost_estimates.scenarios` (WU-10 — RayCon output).

#### 12 Cost Line Items

| Row Key | Display Label |
|---|---|
| `demolition` | Demolition |
| `framing_doors` | Framing / Doors |
| `mep_fire_life_safety` | MEP / Fire / Life Safety |
| `plumbing_bathrooms` | Plumbing / Bathrooms |
| `finish_work` | Finish Work |
| `furniture` | Furniture |
| `tech_security_signage` | Tech / Security / Signage |
| `other_hard_costs` | Other Hard Costs |
| `soft_costs` | Soft Costs |
| `gc_fee` | GC Fee |
| `contingency` | Contingency |
| `grand_total` | Grand Total |

#### Token Pattern

`exec.cost_{row_key}_{scenario}`

For Fastest Open and Max Capacity: map from the corresponding RayCon scenario `line_items` array.

RayCon line item mapping:

| RayCon Line Item Field | Row Key |
|---|---|
| `demolition` | `demolition` |
| `framing` or `framing_doors` | `framing_doors` |
| `mep` or `mep_fire_life_safety` | `mep_fire_life_safety` |
| `plumbing` or `plumbing_bathrooms` | `plumbing_bathrooms` |
| `finishes` or `finish_work` | `finish_work` |
| `furniture` or `ff_e` | `furniture` |
| `technology` or `tech_security_signage` | `tech_security_signage` |
| `other` or `other_hard_costs` | `other_hard_costs` |
| `soft_costs` | `soft_costs` |
| `gc_fee` or `general_contractor` | `gc_fee` |
| `contingency` | `contingency` |
| `total` or `grand_total` | `grand_total` |

Format all dollar amounts with commas: `$XXX,XXX`

For Recommended Path: populate with the same scenario data as the winning scenario selected in Step 4 (Fastest Open or Max Capacity values are copied into the Recommended Path column).

For Max Value: set all cells to empty string `""`.

### Step 6: Populate Notes Tokens (2 tokens)

#### exec.acquisition_conditions

Synthesize from all available sources. Two categories:

**Type A — TI Allowance Ask** (our buildout responsibility, large enough to negotiate):

Sources to check:
1. `inspection_best` — sprinkler gaps, restroom demolition, HVAC replacement, electrical panel, ADA deficiencies
2. `cost_estimates` — high-cost line items above $40K

Format: `"- Request TI allowance of approximately $[X] for [scope] ([source]: [evidence])"`

**Type B — Landlord Must Address** (landlord's existing obligation):

Sources to check:
1. `inspection_best` — structural deficiencies, roof/water damage, fire-rated separation gaps, panic hardware, environmental contamination
2. `sir_best` — zoning pre-conditions
3. `permit_history` — open violations, deferred maintenance flags

Format: `"- Landlord must [action] before signing — [evidence] (Source: [source])"`

#### exec.risk_notes

Only confirmed findings from source data that directly threaten timeline or viability.

Sources to check (in order):
1. `inspection_best` — MEP failures, fire alarm age, structural issues
2. `sir_best` — sequential permit blockers, zoning variance uncertainty, traffic study requirements
3. `permit_history` — deferred maintenance, open permits, demolition history
4. `sir_delta` / `inspection_delta` — high-severity conflicts between AI and vendor (flag as "AI/vendor disagreement on [field]")
5. `opening_plan` — gating factors with bad-outcome risk

Classification test: "Did we find evidence in the structured data, AND does it directly threaten timeline or viability?"

Format: `"- [Risk description] ([source]: [evidence])"`

### Step 7: Populate Source Document Links (6 tokens)

| Token | Source | Display Label | Gap Label |
|---|---|---|---|
| `sources.sir_link` | `source_doc_urls.sir` | "View SIR" | `[Not found - SIR]` |
| `sources.inspection_link` | `source_doc_urls.inspection` | "View Inspection" | `[Not found - Building Inspection]` |
| `sources.isp_link` | `source_doc_urls.isp` | "View ISP" | `[Not found - ISP]` |
| `sources.e_occupancy_link` | `source_doc_urls.sir` (same as SIR — Phase 7 is embedded) | "View E-Occupancy" | `[Not found - E-Occupancy Assessment]` |
| `sources.school_approval_link` | `source_doc_urls.school_approval` | "View School Approval" | `[Not found - School Approval Assessment]` |
| `sources.trace_link` | Auto-populated after build (trace JSON uploaded to Drive) | "View Report Trace" | (empty) |

If a URL starts with `http`, render as a clickable hyperlink with the display label. Otherwise, show the gap label as plain text.

### Step 8: Build Token Evidence Dict

For every token populated in Steps 2–7, record the source excerpt:

```json
{
  "exec.c_zoning": "sir_vendor.zoning_status = 'Permitted by right' (vendor source, extracted from CDS SIR)",
  "exec.fastest_open_capacity": "isp_extract.capacity_tiers.micro.max_students = 36",
  "exec.fastest_open_capex": "cost_estimates.scenarios[0].total = $185,000 (RayCon)",
  ...
}
```

This evidence dict is included in the trace report for reviewability.

### Step 9: Assemble and Validate

1. Collect all tokens into a flat `report_data` dict using canonical token names
2. Validate:
   - `exec.c_answer` must be exactly `Yes`, `Yes see notes`, or `No`
   - All dollar amounts must have commas
   - All dates must be `MM/YY` format
   - No raw `{{token}}` patterns in any value
3. Track unfilled tokens — use sourced gap labels, never bare `[Pending]`

### Step 10: Build the Google Doc

Call the programmatic Google Doc builder with:
- `replacements`: the flat token → value dict
- `site_title`: from `meta.site_name`

The builder creates a Google Doc from scratch using Google Docs API v1 `batchUpdate`. It constructs:
1. Title + Header table (7 rows x 2 cols)
2. Executive Summary with "Can We Open?" card
3. Build Scenarios table (4 rows x 3 cols: Fastest Open, Max Capacity)
4. Detailed Cost Breakdown table (13 rows x 3 cols: 12 line items + header)
5. Notes for Acquisition Negotiations (free text)
6. Risks to Note (free text)
7. Source Documents table (7 rows x 2 cols)

See `references/doc-builder-spec.md` for the full builder specification.

### Step 11: Upload Trace Report

After the doc is built:
1. Create a JSON trace file with:
   - All token values and their sources
   - Data provenance (vendor vs AI for each field)
   - Unmatched keys and unfilled tokens
   - Token evidence excerpts
2. Upload trace JSON to the site's Drive folder
3. Insert the trace link into the Source Documents table (last row)

### Step 12: Write Output to Sindri

```json
{
  "dd_report": {
    "generated_at": "ISO timestamp",
    "doc_id": "Google Doc ID",
    "doc_url": "Google Doc URL",
    "version": 1,
    "score": null,
    "recommendation": "value of exec.c_answer",
    "data_sources_used": {
      "sir_source": "vendor | ai | both",
      "inspection_source": "vendor | ai",
      "cost_source": "raycon | null",
      "permit_source": "shovels | null"
    },
    "tokens_populated": 45,
    "tokens_missing": ["exec.recommended_path_capacity", "..."],
    "data_provenance": {
      "zoning_status": "sir_vendor",
      "occupancy_compatibility": "sir_ai",
      "...": "..."
    }
  }
}
```

---

## Hard Rules

1. **Never read raw PDFs.** All data comes from structured Sindri work unit outputs. If a work unit hasn't run, the data is null — use a gap label.
2. **Vendor > AI for every field where both exist.** No exceptions.
3. **Never re-run upstream skills.** Do not invoke ease-of-conversion, school-approval, or sir-to-permitting-plan. Read their structured output only.
4. **exec.c_answer must be exactly one of: `Yes`, `Yes see notes`, `No`.** Any other value is invalid. Drop it rather than pass through.
5. **All dollar amounts with commas.** `$185,000` not `$185000`.
6. **All dates in MM/YY format.** `01/27` not `January 2027`.
7. **Sourced gap labels only.** Never use bare `[Pending]` or `[TBD]`. Always: `[Not found - {what was checked}]`.
8. **Every acquisition condition and risk note must cite its source.** Format: `(source: evidence)`. No unsourced bullets.
9. **Flag delta conflicts.** When `sir_delta` or `inspection_delta` shows a high-severity conflict, include it in `exec.risk_notes` as: `"AI and vendor disagree on [field]: AI says [X], vendor says [Y]"`.
10. **Track provenance for every token.** The trace report must show which work unit and which field populated each token.
11. **Recommended Path is inferred, Max Value gets a gap label.** Recommended Path uses the capacity-per-dollar logic from Step 4. Max Value is gap-labeled until that data source exists in the pipeline.
12. **The report is ready to send only when zero `{{token}}` patterns remain.** Gap labels (`[Not found - ...]`) are acceptable. Unfilled `{{tokens}}` are not.
13. **Never fabricate construction timelines.** Dates come from the Opening Plan (WU-12). If the Opening Plan doesn't have a date, use a gap label that says what's missing — never insert a default estimate.
14. **All support documents must have human-readable output.** Every upstream work unit that produces a support document (SIR, Building Inspection, ISP, School Approval, Opening Plan) must write both structured JSON to Sindri AND a human-readable document (markdown or PDF) to Google Drive. The DD Report links to the human-readable versions in the Source Documents table.

---

## Quality Bar

The report is complete when:
- All 7 meta tokens are populated (or gap-labeled)
- All 4 "Can We Open?" dimensions have valid values (or gap labels)
- Fastest Open and Max Capacity scenarios have capacity, capex, and open date (or gap labels)
- Cost breakdown has all 12 line items for active scenarios (or gap labels)
- Acquisition conditions and risk notes are populated from available data
- Source document links point to real Drive URLs (or gap labels)
- Zero `{{token}}` patterns remain in the document
- Trace report is uploaded with full provenance

---

## Completeness Check

After building, scan the document for:

| Pattern Found | Classification | Action |
|---|---|---|
| `{{token}}` still in text | Hard block | Agent never attempted to fill — do not distribute |
| `[Not found - ...]` label | Acceptable | Data was attempted but unavailable — OK to distribute |
| Invalid `exec.c_answer` value | Hard block | Drop value, re-synthesize, or gap-label |

A report is `ready_to_send` only if hard blocks = 0.

---

## Not In Scope

- Running ease-of-conversion, school-approval, or sir-to-permitting-plan skills
- Reading raw PDF documents from Drive
- Calling the Wrike API (RHODES replaces Wrike for site data)
- Calling external APIs directly (RayCon, Shovels — those are upstream work units)
- Populating Max Value scenario (data source not yet in the pipeline)
