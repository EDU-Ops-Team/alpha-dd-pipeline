# WU-07 · Vendor Building Inspection Extraction

**Pipeline:** Alpha DD Pipeline  
**Work Unit:** 07  
**Skill:** Vendor BI Extraction  
**Version:** 1.0.0  
**Role:** Reads a completed Worksmith pre-filled inspection checklist returned from the field and extracts fully structured data for downstream pipeline stages.

---

## Overview

This skill is the receiving end of the WU-04 dispatch loop. After a Worksmith-certified inspector completes the AI pre-filled checklist in the field and returns it (via email attachment or Drive upload), this skill:

1. Parses every structural element of the returned document
2. Classifies each row as **confirmed / corrected / new_finding / unverified**
3. Cross-references embedded claim-ids against `sir_ai` from Sindri
4. Builds the `inspection_vendor` Sindri record
5. Emits a human-readable markdown summary alongside the JSON payload

The output is the structural ground truth for the site and feeds directly into WU-08 (deficiency triage), WU-09 (delta matching), and downstream cost/schedule modeling.

---

## Input

### Primary Document
A completed Worksmith inspection checklist returned from the field.

**Format:** Markdown document containing:
- Cover instructions (read-only, not extracted)
- Header block
- 5 Deal-Killer Questions
- 11 inspection section tables
- Site-Specific Tasks section
- Occupant Load Verification section
- Cost Estimate table
- Overall Assessment block

**Table row structure (each of the 11 sections):**
```
| Item | AI Pre-Fill | Confirmed ☐ | Finding | Source/Citation | Notes |
```

Claim-id HTML comments are embedded after each pre-filled row in the format:
```html
<!-- claim-id: SIR-XXXX-YYYYMMDD-NNN -->
```

### Sindri Inputs
| Field | Source | Purpose |
|-------|--------|---------|
| `site_meta` | Sindri | Address matching and sanity-check |
| `sir_ai` | Sindri | claim-id cross-reference and delta computation |

---

## Document Structure Reference

The inspector received and filled out the following sections in this order:

| # | Section | Notes |
|---|---------|-------|
| 1 | Cover instructions | Read-only; skip |
| 2 | Header block | 8 fields to extract |
| 3 | Deal-Killer Questions | 5 binary questions; early-exit trigger |
| 4–14 | 11 Inspection Sections | Full table parse per section |
| 15 | Site-Specific Tasks | D-confidence SIR items from WU-04 |
| 16 | Occupant Load Verification | 2 formulas |
| 17 | Cost Estimate table | Structured array |
| 18 | Overall Assessment | Recommendation + signature |

### Section Order (11 inspection sections)
1. Exterior / Site Assessment → `exterior_site`
2. Parking / Drop-off → `parking_dropoff`
3. Entry / Egress → `entry_egress`
4. Fire Alarm → `fire_alarm`
5. Sprinkler → `sprinkler`
6. Emergency Systems → `emergency_systems`
7. Restrooms / Plumbing → `restrooms_plumbing`
8. ADA → `ada`
9. Structural → `structural`
10. HVAC / Mechanical → `hvac_mechanical`
11. Electrical → `electrical`

See `references/checklist-section-map.md` for header text variations and item lists.

---

## Extraction Process

### Step 1 — Validate the Document
Before any extraction:
- Confirm document includes a header block, all 11 section headers, and an Overall Assessment
- Match the property address against `site_meta.address` (fuzzy match acceptable; flag discrepancies)
- Check that the document contains claim-id HTML comments — if none found, flag for manual review

### Step 2 — Extract Header Block

Extract the following 8 fields from the header block at the top of the document:

| Schema Field | Checklist Label |
|---|---|
| `address` | Property Address |
| `inspection_date` | Inspection Date |
| `inspector_name` | Inspector Name / Firm |
| `inspector_contact` | Inspector Contact (not in output JSON, keep in notes) |
| `target_occupancy` | Target Occupancy |
| `planned_student_staff_count` | Planned Student/Staff Count |
| `building_sq_footage` | Building Sq. Footage |
| `current_occupancy_type` | Current Occupancy Type |

Normalize `inspection_date` to ISO 8601 (YYYY-MM-DD). If ambiguous (e.g., "6/7/25"), preserve original in `vendor_notes`.

### Step 3 — Extract Deal-Killer Questions

The 5 deal-killer questions appear as binary prompts with checkboxes:  
`☐ Yes   ☐ No   ☐ Needs Further Evaluation`

| Schema Key | Question Text |
|---|---|
| `safe_dropoff` | Is the drop-off zone safe for children? |
| `adequate_exits` | Does the building have 2 or more usable exits? |
| `exit_doors_compliant` | Are exit doors compliant (width, hardware, swing direction)? |
| `structurally_sound` | Is the building structurally sound? |
| `no_hazmat_visible` | Is there no visible hazardous material (asbestos, lead, mold)? |

Normalize checked boxes to:
- `☑ Yes` → `"yes"`
- `☑ No` → `"no"`
- `☑ Needs Further Evaluation` → `"needs_evaluation"`
- Unchecked / blank → `"needs_evaluation"` (treat as unresolved, flag)

**Compute `any_no`:** Set to `true` if ANY of the 5 fields equals `"no"`.

> **EARLY EXIT FLAG:** If `any_no = true`, include a prominent warning at the top of the output and in `vendor_notes`:  
> `⚠ DEAL-KILLER TRIGGERED: One or more binary safety questions answered NO. Immediate review required before proceeding.`

### Step 4 — Extract Inspection Section Tables

Process all 11 sections in order. For each section:

#### 4a — Parse Table Rows

Each row follows the template column order:
```
Item | AI Pre-Fill | Confirmed ☐ | Finding | Source/Citation | Notes
```

Normalize:
- `AI Pre-Fill` may be blank (null) if the AI had no data for that item
- `Confirmed ☐` is a checkbox: `☑` = `true`, `☐` = `false`
- `Finding` may be blank if the inspector did not address the item
- `Source/Citation` is free text; preserve verbatim
- `Notes` is free text; preserve verbatim

#### 4b — Extract claim-id

Claim-ids appear as HTML comments on the line immediately following a pre-filled row:
```html
<!-- claim-id: SIR-XXXX-YYYYMMDD-NNN -->
```

- Extract the full claim-id string (everything inside the comment after `claim-id: `)
- If a row has an AI pre-fill but no claim-id comment, set `claim_id: null` and flag in `vendor_notes`
- Do **not** regenerate or modify claim-ids — preserve exactly as found

#### 4c — Classify Each Row

| Classification | Condition |
|---|---|
| `confirmed` | AI pre-fill exists AND inspector finding matches in substance AND `confirmed = true` |
| `corrected` | AI pre-fill exists AND inspector finding differs AND `confirmed = false` |
| `new_finding` | AI pre-fill is null/blank AND inspector added a finding |
| `unverified` | Both AI pre-fill and inspector finding are blank/null |

> Rule 10: When the inspector's finding differs from the AI pre-fill AND `confirmed = false`, this is always a **correction** — even if the difference seems minor.  
> Rule 11: Items with no AI pre-fill where the inspector added a finding are always **new_findings**.  
> Rule 12: Items where both columns are blank are **unverified** — leave all fields null but preserve the item name.

The `classification` field is stored at the item level in the output:
```json
"classification": "confirmed | corrected | new_finding | unverified"
```

### Step 5 — Extract Site-Specific Tasks

Site-Specific Tasks are D-confidence SIR items from the original report that did not map to standard template items. They appear as a numbered list following the 11 sections.

For each task, extract:
- `task_number` — sequential integer as numbered in the document
- `task` — the full task description text (verbatim)
- `finding` — the inspector's written response (null if blank)
- `documentation` — any photo reference, citation, or document noted by the inspector

### Step 6 — Extract Occupant Load Verification

Two formulas appear in this section. Extract the computed values:

| Schema Field | Formula |
|---|---|
| `net_floor_area_sf` | Total net floor area used in calculation |
| `total_occupant_load` | Net floor area ÷ occupant load factor |
| `net_learning_area_sf` | Net learning area used in student capacity calc |
| `student_capacity` | Net learning area ÷ 20 SF per student (or per applicable code) |

If the inspector left any field blank, set to `null`. Do **not** compute missing values.

### Step 7 — Extract Cost Estimate Table

The cost estimate table uses these columns:
```
Item | Description | Priority | Low Est. | High Est. | Notes
```

For each row:
- `item` — one of the 8 standard categories (see enum in schema)
- `description` — verbatim text
- `priority` — map to `CRITICAL | IMPORTANT | MINOR` (see `references/condition-scale.md` for language mapping)
- `low_estimate` — numeric value in USD; strip `$` and commas before storing as number
- `high_estimate` — numeric value in USD; strip `$` and commas
- `notes` — verbatim

**Preserve all rows as-is.** Do not adjust, average, or modify cost figures (Rule 6).

### Step 8 — Compute Deficiency Summary

After extracting the full cost estimate table, compute:
```
critical_count     = count of rows where priority = CRITICAL
important_count    = count of rows where priority = IMPORTANT
minor_count        = count of rows where priority = MINOR
total_remediation_low  = sum of all low_estimate values
total_remediation_high = sum of all high_estimate values
```

Null estimates contribute 0 to sums. Flag in `vendor_notes` if any estimate was null.

### Step 9 — Extract Specialist Referrals

Scan the entire document for specialist referral language. Common patterns:
- "Recommend structural engineer review"
- "Refer to fire protection engineer"
- "Environmental assessment recommended"
- "MEP engineer required"

For each referral found, extract:
- `type` — one of: `structural engineer | MEP engineer | fire protection engineer | environmental | other`
- `reason` — verbatim inspector language triggering the referral

Referrals may appear in any section's Notes column, in Site-Specific Tasks, or in the Overall Assessment narrative.

### Step 10 — Extract Overall Assessment

The final section contains:
- A checked recommendation box
- Inspector signature and date (already captured in header; cross-check)
- Optional narrative comments

**Recommendation mapping** (Rule 8):

| Inspector Language | Schema Value |
|---|---|
| "PROCEED" | `PROCEED` |
| "PROCEED WITH CAUTION" | `PROCEED WITH CAUTION` |
| "REQUIRES JUSTIFICATION" | `REQUIRES JUSTIFICATION` |
| "PASS" | `PASS` |
| "Approved" | `PROCEED` |
| "Conditionally approved" | `PROCEED WITH CAUTION` |
| "Major concerns" | `REQUIRES JUSTIFICATION` |
| "Failed" / "Not recommended" | `PASS` |

If the inspector's language does not match any known pattern, record the raw text in `vendor_notes` and flag for human review. Do not assign a value.

---

## Sindri Data Out: `inspection_vendor`

```json
{
  "inspection_vendor": {
    "extracted_at": "2025-01-15T14:32:00Z",
    "source_doc_url": "https://drive.google.com/...",
    "address": "1234 Oak Street, Springfield, IL 62701",
    "inspector_name": "Jane Smith / Smith Inspections LLC",
    "inspection_date": "2025-01-14",
    "overall_recommendation": "PROCEED WITH CAUTION",
    "deal_killer_flags": {
      "safe_dropoff": "yes",
      "adequate_exits": "yes",
      "exit_doors_compliant": "needs_evaluation",
      "structurally_sound": "yes",
      "no_hazmat_visible": "no",
      "any_no": true
    },
    "sections": {
      "exterior_site": {
        "items": [
          {
            "item": "Roof condition",
            "ai_prefill": "Flat membrane roof, ~15 years old, visible ponding at NW corner per permit records",
            "confirmed": false,
            "finding": "Significant ponding and membrane separation at NW parapet — recommend immediate remediation",
            "source_citation": "Field observation + photo IMG_0041",
            "notes": "Worse than AI assessment",
            "claim_id": "SIR-0042-20250108-003",
            "classification": "corrected"
          }
        ]
      },
      "parking_dropoff": { "items": [] },
      "entry_egress": { "items": [] },
      "fire_alarm": { "items": [] },
      "sprinkler": { "items": [] },
      "emergency_systems": { "items": [] },
      "restrooms_plumbing": { "items": [] },
      "ada": { "items": [] },
      "structural": { "items": [] },
      "hvac_mechanical": { "items": [] },
      "electrical": { "items": [] }
    },
    "occupant_load": {
      "net_floor_area_sf": 14200,
      "total_occupant_load": 142,
      "net_learning_area_sf": 8400,
      "student_capacity": 420
    },
    "cost_estimates": [
      {
        "item": "ADA",
        "description": "Ramp installation at main entry + accessible restroom upgrades",
        "priority": "CRITICAL",
        "low_estimate": 45000,
        "high_estimate": 68000,
        "notes": "Must complete before occupancy"
      }
    ],
    "deficiency_summary": {
      "critical_count": 1,
      "important_count": 3,
      "minor_count": 2,
      "total_remediation_low": 87500,
      "total_remediation_high": 134000
    },
    "specialist_referrals": [
      {
        "type": "structural engineer",
        "reason": "Visible crack propagation at load-bearing wall — inspector recommends structural PE review before occupancy"
      }
    ],
    "site_specific_tasks": [
      {
        "task_number": 1,
        "task": "Verify underground storage tank status with county environmental office",
        "finding": "UST closure letter obtained — provided to school district",
        "documentation": "UST Closure Letter dated 2023-09-15, county file #4421"
      }
    ],
    "vendor_notes": "⚠ DEAL-KILLER TRIGGERED: no_hazmat_visible = NO. Asbestos-containing floor tile identified in Room 104. Environmental assessment required before occupancy. Inspector date on signature block (2025-01-14) matches header."
  }
}
```

---

## Hard Rules

| # | Rule |
|---|------|
| 1 | **Never infer construction type** — only extract if explicitly stated by the inspector |
| 2 | **Never upgrade condition assessments** — use the inspector's language exactly; map to scale only for the `priority` field in cost estimates |
| 3 | **Leave fields null** if the inspector did not address them — do not substitute AI pre-fill values |
| 4 | **Flag deal-killer "No" answers prominently** — in the top-level output, in `any_no`, and in `vendor_notes` |
| 5 | **Preserve claim-ids exactly** as found — do not regenerate, normalize, or reformat |
| 6 | **Cost estimates extracted as-is** — do not adjust, average, or modify figures |
| 7 | **Capture specialist referrals** wherever they appear in the document |
| 8 | **Overall recommendation** must be one of 4 standard values; map non-standard language per table above |
| 9 | **`confirmed` is boolean** — `☑` = true, `☐` = false; do not infer from text |
| 10 | **Correction classification**: inspector finding differs from AI pre-fill AND `confirmed = false` |
| 11 | **new_finding classification**: no AI pre-fill AND inspector added a finding |
| 12 | **unverified classification**: both AI pre-fill and inspector finding are blank |

---

## RHODES Write

**Yes** — `inspection_vendor` is the structural ground truth for the site. Write to RHODES immediately after successful extraction and human summary generation.

Fields written to RHODES:
- Full `inspection_vendor` JSON object
- Timestamp (`extracted_at`)
- Source document URL or filename
- Deal-killer flag status
- Overall recommendation

---

## Human-Readable Summary Output

In addition to the JSON payload, generate a markdown summary document with:

```
# Vendor Inspection Summary — [Address]

**Inspector:** [Name]  **Date:** [ISO date]  **Recommendation:** [VALUE]

## Deal-Killer Status
[Table: all 5 questions with values; RED if any_no = true]

## Section Findings
[For each of 11 sections: count of confirmed / corrected / new_findings / unverified]

## Key Deficiencies
[List of CRITICAL items with cost ranges]

## Cost Summary
| Priority | Count | Low Total | High Total |
|----------|-------|-----------|------------|
| CRITICAL | … | … | … |
| IMPORTANT | … | … | … |
| MINOR | … | … | … |
| **TOTAL** | … | **$X** | **$X** |

## Specialist Referrals
[List or "None"]

## Occupant Load
[4 fields if available, or "Not calculated by inspector"]
```

---

## Quality Bar

Before marking WU-07 complete, verify all of the following:

- [ ] Every table row in all 11 sections has been extracted (no rows skipped)
- [ ] Every deal-killer question has a value (`yes` / `no` / `needs_evaluation`)
- [ ] `any_no` is correctly computed
- [ ] If `any_no = true`, warning appears in `vendor_notes` and at output top-level
- [ ] Every site-specific task has been processed
- [ ] Cost estimate sums match `deficiency_summary` totals
- [ ] All claim-ids are preserved verbatim (cross-checked against `sir_ai`)
- [ ] `overall_recommendation` is one of exactly 4 standard values
- [ ] Human-readable markdown summary generated alongside JSON
- [ ] `extracted_at` timestamp is set to current ISO datetime at time of extraction
- [ ] Source document URL or filename recorded in `source_doc_url`

---

## Downstream Consumers

| Work Unit | Uses |
|-----------|------|
| WU-08 | Deficiency triage — reads `cost_estimates` and `deficiency_summary` |
| WU-09 | Delta matching — reads all `claim_id` values against `sir_ai` |
| WU-10 | Schedule modeling — reads `overall_recommendation` and specialist referrals |
| WU-11 | Board memo — reads human-readable summary |
