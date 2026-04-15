# Extraction Walkthrough

**Pipeline:** Alpha DD Pipeline  
**Used By:** WU-07 Vendor BI Extraction  
**Scope:** Step-by-step guide showing how to process a Worksmith returned checklist from raw document to structured `inspection_vendor` JSON. Includes annotated examples for each major document component.

---

## Before You Begin

Collect the following inputs:
- Returned Worksmith checklist (markdown, PDF, or DOCX — convert to plain text if needed)
- `site_meta` from Sindri (for address validation)
- `sir_ai` from Sindri (for claim-id cross-reference)

Load `references/checklist-section-map.md` and `references/condition-scale.md` before processing.

---

## Part 1 — Parsing the Header Block

### What You're Looking For

The header block appears immediately after any cover instructions. It is typically formatted as a definition list or labeled fields:

```
**Property Address:** 1234 Oak Street, Springfield, IL 62701
**Inspection Date:** January 14, 2025
**Inspector Name / Firm:** Jane Smith / Smith Inspections LLC
**Inspector Contact:** jane@smithinspections.com | (217) 555-0104
**Target Occupancy:** Educational — Elementary School (IBC Group E)
**Planned Student/Staff Count:** 420 students, 35 staff
**Building Sq. Footage:** 24,800 SF
**Current Occupancy Type:** Vacant retail (formerly a grocery store)
```

### Extraction Steps

1. Locate the block by scanning for the label "Property Address"
2. Extract each labeled field value (everything after the colon)
3. Normalize `Inspection Date` to ISO 8601: "January 14, 2025" → `"2025-01-14"`
4. Validate address against `site_meta.address` — fuzzy match is acceptable ("1234 Oak St" matches "1234 Oak Street")
5. If the address differs significantly, flag in `vendor_notes`:  
   `"Address in checklist ('1236 Oak Street') differs from site_meta.address ('1234 Oak Street'). Verify with project team."`
6. `Inspector Contact` is not stored in the JSON output — keep in `vendor_notes` if needed

### Resulting JSON Fragment
```json
{
  "address": "1234 Oak Street, Springfield, IL 62701",
  "inspector_name": "Jane Smith / Smith Inspections LLC",
  "inspection_date": "2025-01-14"
}
```

---

## Part 2 — Processing Deal-Killer Questions

### What You're Looking For

The deal-killer section appears immediately after the header. It contains exactly 5 questions with three checkbox options each:

```
**Deal-Killer Questions**

1. Is the drop-off zone safe for children?  ☑ Yes  ☐ No  ☐ Needs Further Evaluation
2. Does the building have 2 or more usable exits?  ☑ Yes  ☐ No  ☐ Needs Further Evaluation
3. Are exit doors compliant (width, hardware, swing direction)?  ☐ Yes  ☐ No  ☑ Needs Further Evaluation
4. Is the building structurally sound?  ☑ Yes  ☐ No  ☐ Needs Further Evaluation
5. Is there no visible hazardous material (asbestos, lead, mold)?  ☐ Yes  ☑ No  ☐ Needs Further Evaluation
```

### Extraction Steps

1. Locate the block by scanning for "Deal-Killer" in the section header
2. For each of the 5 questions, find the checked box (`☑`)
3. Map: `☑ Yes` → `"yes"`, `☑ No` → `"no"`, `☑ Needs Further Evaluation` → `"needs_evaluation"`
4. If no box is checked (all `☐`), record `"needs_evaluation"` and flag in `vendor_notes`
5. After extracting all 5, compute `any_no`:
   - Is any value `"no"`? → `any_no: true`

### Resulting JSON Fragment
```json
{
  "deal_killer_flags": {
    "safe_dropoff": "yes",
    "adequate_exits": "yes",
    "exit_doors_compliant": "needs_evaluation",
    "structurally_sound": "yes",
    "no_hazmat_visible": "no",
    "any_no": true
  }
}
```

### Deal-Killer Trigger

Because `any_no = true` (question 5 answered "no"), prepend the following to `vendor_notes`:

```
⚠ DEAL-KILLER TRIGGERED: no_hazmat_visible = NO. One or more binary safety questions answered NO. Immediate review required before proceeding. Inspector noted visible hazardous material at this site.
```

---

## Part 3 — Handling a Section Table with Mixed Rows

### What You're Looking For

Each of the 11 sections begins with a header (see `checklist-section-map.md`) followed by a markdown table:

```markdown
## 1. Exterior / Site Assessment

| Item | AI Pre-Fill | Confirmed ☐ | Finding | Source/Citation | Notes |
|------|-------------|-------------|---------|-----------------|-------|
| Roof condition | Flat membrane roof, ~15 years old, visible ponding at NW corner per permit records | ☐ | Significant ponding and membrane separation at NW parapet — recommend immediate remediation | Field observation + photo IMG_0041 | Worse than AI assessment |
<!-- claim-id: SIR-0042-20250108-003 -->
| Exterior walls | EIFS cladding, no permits pulled for repairs per city records | ☑ | EIFS cladding confirmed — minor cracking at window surrounds only | Field observation | |
<!-- claim-id: SIR-0042-20250108-004 -->
| Fencing / perimeter security | | ☐ | Chain-link fence, 6 ft — adequate perimeter | Photo IMG_0055 | Inspector added |
| Site drainage | Per aerial: no apparent grade issues | ☐ | | | |
<!-- claim-id: SIR-0042-20250108-005 -->
```

### Processing Each Row

**Row 1 — Roof condition**
- `ai_prefill`: `"Flat membrane roof, ~15 years old, visible ponding at NW corner per permit records"` (present)
- `confirmed`: `☐` → `false`
- `finding`: `"Significant ponding and membrane separation at NW parapet — recommend immediate remediation"` (present)
- AI pre-fill and finding differ in substance; `confirmed = false`
- → **Classification: `corrected`**
- `claim_id`: `"SIR-0042-20250108-003"` (from HTML comment on next line)

**Row 2 — Exterior walls**
- `ai_prefill`: `"EIFS cladding, no permits pulled for repairs per city records"` (present)
- `confirmed`: `☑` → `true`
- `finding`: `"EIFS cladding confirmed — minor cracking at window surrounds only"` (present, matches in substance)
- → **Classification: `confirmed`**
- `claim_id`: `"SIR-0042-20250108-004"`

**Row 3 — Fencing / perimeter security**
- `ai_prefill`: blank → `null`
- `confirmed`: `☐` → `false`
- `finding`: `"Chain-link fence, 6 ft — adequate perimeter"` (present)
- AI pre-fill is null; inspector added a finding
- → **Classification: `new_finding`**
- `claim_id`: `null` (no HTML comment — expected, since AI had no pre-fill for this row)

**Row 4 — Site drainage**
- `ai_prefill`: `"Per aerial: no apparent grade issues"` (present)
- `confirmed`: `☐` → `false`
- `finding`: blank → `null`
- Both finding and substantive check are absent; inspector left it unaddressed
- → **Classification: `unverified`**
- `claim_id`: `"SIR-0042-20250108-005"`
- Note: AI pre-fill had a claim-id but inspector left finding blank. Preserve claim-id for WU-09 delta.

### Resulting JSON for This Section

```json
{
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
      },
      {
        "item": "Exterior walls",
        "ai_prefill": "EIFS cladding, no permits pulled for repairs per city records",
        "confirmed": true,
        "finding": "EIFS cladding confirmed — minor cracking at window surrounds only",
        "source_citation": "Field observation",
        "notes": null,
        "claim_id": "SIR-0042-20250108-004",
        "classification": "confirmed"
      },
      {
        "item": "Fencing / perimeter security",
        "ai_prefill": null,
        "confirmed": false,
        "finding": "Chain-link fence, 6 ft — adequate perimeter",
        "source_citation": "Photo IMG_0055",
        "notes": "Inspector added",
        "claim_id": null,
        "classification": "new_finding"
      },
      {
        "item": "Site drainage",
        "ai_prefill": "Per aerial: no apparent grade issues",
        "confirmed": false,
        "finding": null,
        "source_citation": null,
        "notes": null,
        "claim_id": "SIR-0042-20250108-005",
        "classification": "unverified"
      }
    ]
  }
}
```

---

## Part 4 — Identifying Site-Specific Tasks vs. Standard Template Items

### The Distinction

**Standard template items** appear as table rows inside one of the 11 named sections. They have a defined column structure and (if pre-filled by AI) an associated claim-id.

**Site-specific tasks** appear in a separate numbered list section after Section 11, and represent D-confidence SIR findings that WU-04 could not map to any standard row. They do **not** have table structure.

### Recognizing Site-Specific Tasks

Look for:
- The section header matching "Site-Specific Tasks" (or a variant — see `checklist-section-map.md`)
- A numbered list rather than a table
- Tasks may be formatted as:
  ```
  **Task 1.** Verify underground storage tank (UST) closure status with county environmental office.
  Inspector finding: UST closure letter obtained and provided to school district.
  Documentation: UST Closure Letter dated 2023-09-15, county file #4421
  ```
  Or as a simpler:
  ```
  1. Verify UST closure status.
     Finding: Closure letter on file.
  ```

### Edge Case — Inspector Adds Task-Like Notes Inside Standard Sections

Occasionally, an inspector will write free-form findings inside a standard section that look like tasks. These belong to the section where they appear, not to `site_specific_tasks`. Extract them as `new_finding` items under the appropriate section.

If the inspector adds an entirely new table row under an unrecognized header, follow the Unrecognized Sections rule in `checklist-section-map.md`.

### Resulting JSON Fragment

```json
{
  "site_specific_tasks": [
    {
      "task_number": 1,
      "task": "Verify underground storage tank (UST) closure status with county environmental office.",
      "finding": "UST closure letter obtained and provided to school district.",
      "documentation": "UST Closure Letter dated 2023-09-15, county file #4421"
    },
    {
      "task_number": 2,
      "task": "Confirm current Certificate of Occupancy on file — city records showed lapse.",
      "finding": null,
      "documentation": null
    }
  ]
}
```

---

## Part 5 — Computing the Deficiency Summary from Cost Estimates

### Source Table

After extracting all cost estimate rows, you have a structured array:

```json
{
  "cost_estimates": [
    {
      "item": "ADA",
      "description": "Ramp installation at main entry + accessible restroom upgrades",
      "priority": "CRITICAL",
      "low_estimate": 45000,
      "high_estimate": 68000,
      "notes": "Must complete before occupancy"
    },
    {
      "item": "Electrical",
      "description": "Panel replacement — Federal Pacific Stab-Lok, 200A service upgrade",
      "priority": "CRITICAL",
      "low_estimate": 18000,
      "high_estimate": 26000,
      "notes": null
    },
    {
      "item": "Plumbing",
      "description": "Replace galvanized supply lines — 3 restrooms",
      "priority": "IMPORTANT",
      "low_estimate": 12000,
      "high_estimate": 19000,
      "notes": "Can be phased post-CofO"
    },
    {
      "item": "HVAC",
      "description": "Replace failed RTU on east wing",
      "priority": "IMPORTANT",
      "low_estimate": 22000,
      "high_estimate": 31000,
      "notes": null
    },
    {
      "item": "Structural",
      "description": "Repoint exterior CMU — minor cracking",
      "priority": "IMPORTANT",
      "low_estimate": 8500,
      "high_estimate": 13000,
      "notes": null
    },
    {
      "item": "Other",
      "description": "Touch-up painting, replace broken ceiling tiles",
      "priority": "MINOR",
      "low_estimate": 2000,
      "high_estimate": 4500,
      "notes": null
    },
    {
      "item": "Egress",
      "description": "Replace non-compliant door hardware at 2 secondary exits",
      "priority": "CRITICAL",
      "low_estimate": null,
      "high_estimate": null,
      "notes": "Inspector could not estimate — recommends contractor bid"
    }
  ]
}
```

### Computation Steps

**Step 1 — Count by priority:**
- `CRITICAL`: rows 1, 2, 7 → `critical_count: 3`
- `IMPORTANT`: rows 3, 4, 5 → `important_count: 3`
- `MINOR`: row 6 → `minor_count: 1`

**Step 2 — Sum low estimates:**
- 45000 + 18000 + 12000 + 22000 + 8500 + 2000 + 0 (null) = **107,500**

**Step 3 — Sum high estimates:**
- 68000 + 26000 + 19000 + 31000 + 13000 + 4500 + 0 (null) = **161,500**

**Step 4 — Flag null estimates in `vendor_notes`:**
```
"Egress door hardware (row 7 of cost estimates) has null low_estimate and null high_estimate — inspector could not estimate. Deficiency summary totals are understated by this item."
```

### Resulting JSON Fragment

```json
{
  "deficiency_summary": {
    "critical_count": 3,
    "important_count": 3,
    "minor_count": 1,
    "total_remediation_low": 107500,
    "total_remediation_high": 161500
  }
}
```

---

## Part 6 — Example of a Fully Processed Section (Fire Alarm)

### Input (from returned checklist)

```markdown
## 4. Fire Alarm

| Item | AI Pre-Fill | Confirmed ☐ | Finding | Source/Citation | Notes |
|------|-------------|-------------|---------|-----------------|-------|
| System type | Addressable system — Edwards EST3 panel per 2018 permit | ☑ | Addressable — Edwards EST3 confirmed operational | Field observation, panel label | |
<!-- claim-id: SIR-0042-20250108-021 -->
| Last inspection date | No inspection record found in permit database | ☐ | Annual inspection tag dated March 2024 — current | Inspection tag on panel | AI record was outdated |
<!-- claim-id: SIR-0042-20250108-022 -->
| Smoke detector coverage | | ☐ | All classrooms and corridors covered — visual spot check | Field observation, photo IMG_0112 | |
| Pull stations | Per 2018 permit: 6 pull stations installed | ☑ | 6 pull stations confirmed — all accessible | Field observation | |
<!-- claim-id: SIR-0042-20250108-023 -->
| Connection to monitoring station | Unknown — no permit reference | ☐ | | | Could not verify without access to alarm company records |
<!-- claim-id: SIR-0042-20250108-024 -->
```

### Processed Items

| Item | AI Pre-Fill | Confirmed | Finding | Classification | Claim-ID |
|---|---|---|---|---|---|
| System type | Present | true | Present, matches | `confirmed` | SIR-0042-20250108-021 |
| Last inspection date | Present | false | Present, differs | `corrected` | SIR-0042-20250108-022 |
| Smoke detector coverage | null | false | Present | `new_finding` | null |
| Pull stations | Present | true | Present, matches | `confirmed` | SIR-0042-20250108-023 |
| Connection to monitoring station | Present | false | null | `unverified` | SIR-0042-20250108-024 |

### Resulting JSON

```json
{
  "fire_alarm": {
    "items": [
      {
        "item": "System type",
        "ai_prefill": "Addressable system — Edwards EST3 panel per 2018 permit",
        "confirmed": true,
        "finding": "Addressable — Edwards EST3 confirmed operational",
        "source_citation": "Field observation, panel label",
        "notes": null,
        "claim_id": "SIR-0042-20250108-021",
        "classification": "confirmed"
      },
      {
        "item": "Last inspection date",
        "ai_prefill": "No inspection record found in permit database",
        "confirmed": false,
        "finding": "Annual inspection tag dated March 2024 — current",
        "source_citation": "Inspection tag on panel",
        "notes": "AI record was outdated",
        "claim_id": "SIR-0042-20250108-022",
        "classification": "corrected"
      },
      {
        "item": "Smoke detector coverage",
        "ai_prefill": null,
        "confirmed": false,
        "finding": "All classrooms and corridors covered — visual spot check",
        "source_citation": "Field observation, photo IMG_0112",
        "notes": null,
        "claim_id": null,
        "classification": "new_finding"
      },
      {
        "item": "Pull stations",
        "ai_prefill": "Per 2018 permit: 6 pull stations installed",
        "confirmed": true,
        "finding": "6 pull stations confirmed — all accessible",
        "source_citation": "Field observation",
        "notes": null,
        "claim_id": "SIR-0042-20250108-023",
        "classification": "confirmed"
      },
      {
        "item": "Connection to monitoring station",
        "ai_prefill": "Unknown — no permit reference",
        "confirmed": false,
        "finding": null,
        "source_citation": null,
        "notes": "Could not verify without access to alarm company records",
        "claim_id": "SIR-0042-20250108-024",
        "classification": "unverified"
      }
    ]
  }
}
```

---

## Summary: Classification Decision Tree

```
For each table row:
│
├─ Does ai_prefill have content?
│  ├─ YES:
│  │  ├─ Is confirmed = true AND finding substantively matches ai_prefill?
│  │  │  └─ → confirmed
│  │  ├─ Is confirmed = false AND finding substantively differs from ai_prefill?
│  │  │  └─ → corrected
│  │  └─ Is finding null/blank?
│  │     └─ → unverified
│  └─ NO (ai_prefill is null):
│     ├─ Does the inspector have a finding?
│     │  └─ → new_finding
│     └─ Both blank
│        └─ → unverified
```

---

## Common Pitfalls

| Pitfall | Correct Behavior |
|---|---|
| Inspector writes "See AI" in the Finding column | Treat as `confirmed` if the Confirmed box is checked; otherwise `unverified` |
| Inspector leaves the Confirmed box blank but writes a matching finding | Still `corrected` — the confirmed checkbox is the controlling boolean |
| Claim-id appears on a row with no AI pre-fill | Unusual — flag in `vendor_notes`, preserve the claim-id, classify per finding logic |
| Two claim-id comments appear consecutively with no row between | Record both in `vendor_notes` as orphaned; do not assign to a row |
| Inspector handwrites a cost in the Finding column (not in the Cost Table) | Extract the row normally; do not add a cost_estimate row from a section table |
| Inspector skips an entire section | Include the section in JSON with `"items": []`; flag in `vendor_notes` |
| Inspector uses a priority word inside a section Note (not in cost table) | Preserve verbatim in `notes`; do not create a cost_estimate row |
