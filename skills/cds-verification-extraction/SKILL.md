# CDS Verification Extraction (WU-06)

## Purpose

Extract structured data from a CDS-completed verification report and write `sir_vendor` to Sindri. This agent reads the AI SIR that was dispatched to CDS (via WU-04) with three additional columns filled in by the vendor: **CDS Verified Finding**, **CDS Source**, and **CDS Confidence**. It extracts both the original AI findings and CDS's verified findings into the shared SIR schema, classifies each verified claim, and produces the `sir_vendor` Sindri record that feeds delta computation (WU-09) and DD Report Assembly (WU-13).

This agent reads a completed document. It does not re-run the AI SIR, contact authorities, or search the web. It extracts what CDS wrote.

---

## Pipeline Position

```
WU-02 (AI SIR)
   ↓
WU-04 (Vendor Dispatch — outbound AI SIR with B/C verification columns)
   ↓
CDS (site visit + desk verification)
   ↓
WU-06 (THIS SKILL — CDS return extraction)
   ↓
WU-09 (Delta Computation)
WU-13 (DD Report Assembly)
```

---

## Inputs

| Input | Source | Required |
|---|---|---|
| CDS-returned verification report | Drive file URL or email attachment (markdown or .docx) | Yes |
| `site_meta` | Sindri WU-01 | Yes — for address matching and `site_id` |
| `sir_ai` | Sindri WU-02 | Yes — baseline for delta classification and field carry-forward |
| `vendor_packets_sent` | Sindri WU-04 | Yes — for claim-id inventory and outbound doc URL |

**Address validation:** Confirm the document's header address matches `site_meta.address`. If there is a mismatch, log a warning and proceed — do not abort. Flag the mismatch in `vendor_notes`.

**Outbound claim-id inventory:** Load the list of all claim-ids from `vendor_packets_sent` before extraction begins. Every B/C claim-id in that outbound list must be accounted for in the final output (verified, corrected, or unverified). Any claim-id present in the outbound list but absent from the CDS return is classified `unverified`.

---

## Document Format

The CDS return is the AI SIR vendor packet with three CDS-added columns appended to every B/C-confidence table row:

| Original columns | CDS-added columns |
|---|---|
| Data Point / Threshold / Check / Item | **CDS Verified Finding** |
| Value / AI Found / Result | **CDS Source** |
| Confidence (B or C) | **CDS Confidence** |
| Source (blank in outbound) | *(already present in outbound — CDS fills this in)* |

Every B/C row in the outbound packet carries an HTML comment immediately after the row:

```html
<!-- claim-id: SIR-042 -->
```

This comment is the exact match key between the outbound report and the CDS return. It survives round-trip as long as the document is not reformatted.

CDS may also add findings outside the table structure — in free-text notes, as additional table rows without an AI antecedent, or in a separate "Additional Findings" section. These are captured in `new_findings`.

---

## Extraction Process

### Step 1: Locate and Read the Document

1. Accept the document as a file path, Drive URL, or email attachment URL.
2. If the file is a `.docx`, convert to plaintext markdown before processing. Preserve table structure.
3. If the file is already markdown, read as-is.
4. Confirm the document contains the expected section structure (SECTION 1 verified findings tables, at least one B/C row with a `claim-id` comment).
5. If no `claim-id` comments are found, attempt row-by-row matching using field names and AI values from `sir_ai` as fallback keys. Flag all matches as `matched_by_field_name` in the extraction log — these are lower confidence than claim-id matches.

### Step 2: Parse Tables and Identify B/C Rows

Scan every markdown table in the document. For each table row:

1. Check if the row has a `Confidence` column value of `B` or `C`, OR if it contains the phrase "AI found:" in its value cell (both are indicators of a B/C claim).
2. Locate the HTML comment on the line immediately following the row: `<!-- claim-id: SIR-XXX -->`.
3. Read the three CDS columns from that row:
   - `CDS Verified Finding` — what CDS determined (may be blank)
   - `CDS Source` — where CDS verified it (may be blank)
   - `CDS Confidence` — CDS's confidence level for their finding (may be blank)
4. Read the original AI value from the value cell (strip "AI found: " prefix if present).
5. Read the original confidence from the Confidence column.

**Table parsing rules:**
- Tables may appear across multiple sections (Building Characteristics, IBC Code Analysis, Environmental & Geographic, Jurisdiction & Permit). Process all of them.
- If a table row has no Confidence column, skip it — it is a header row or an A-confidence row that did not require verification.
- If a table has no matching `claim-id` comment but has the "AI found:" pattern, attempt to match by field name against `sir_ai`. Log as `matched_by_field_name`.

### Step 3: Classify Each B/C Row

For every B/C row, apply this classification logic:

| CDS Verified Finding | CDS Source | CDS Confidence | Classification |
|---|---|---|---|
| Filled in, same as AI value | Filled in | Filled in | `confirmed` |
| Filled in, same as AI value | Blank | Filled in | `confirmed_unsourced` |
| Filled in, different from AI value | Filled in | Filled in | `corrected` |
| Filled in, different from AI value | Blank | Any | `corrected_unsourced` — flag for human review |
| Blank | Blank | Blank | `unverified` |
| Blank | Filled in | Any | `unverified_with_source_note` — CDS looked but left finding blank; preserve the source note |

**Value comparison rules for "same vs different":**
- Use semantic comparison, not string equality. "By right" and "Permitted by right" are the same. "SUP" and "Special Use Permit" are different unless the terminology map in `references/vendor-terminology-map.md` resolves them to the same canonical value.
- Apply the terminology map before comparing. If both values map to the same canonical value, classify as `confirmed`.
- Numeric values: treat as the same if they differ by less than 5% (e.g., timeline estimates) or are identical integers (e.g., year built, story count).

### Step 4: Extract New Findings

Scan the document for content outside the standard table structure:

1. **Additional table rows without a claim-id comment:** If CDS inserted new rows into existing tables (no `<!-- claim-id: ... -->` above them), extract as new findings. Set `section` to the table section name.
2. **Section 3 / "Additional Findings" / "Corrections and Open Items":** These sections in the vendor return template are specifically for findings outside the AI pre-report scope. Extract each row.
3. **Free-text notes:** Any substantive text that describes a finding not captured in table form. Extract and assign to `new_findings` with `field` set to the best-fit schema field name or "narrative_note" if no schema field applies.

For each new finding, record:
- `field` — best-fit schema field name, or "narrative_note"
- `finding` — CDS's exact language
- `source` — CDS's stated source (if any)
- `section` — which document section this appeared in

### Step 5: Build the sir_vendor Schema Fields

Using the best-available value for every schema field:

**Value precedence rule:**
1. If CDS verified the field (status is `confirmed` or `corrected`): use the CDS value as the canonical value
2. If CDS did not verify the field (status is `unverified`): carry forward the AI value unchanged
3. If neither AI nor CDS addressed the field: leave as `null`

**Confidence precedence rule:**
- When using a CDS value: use CDS's stated confidence level
- When carrying forward an AI value: preserve the AI's original confidence level — do NOT upgrade it
- A carries A, B carries B, C carries C. CDS can confirm (keep level) or provide new evidence (their level). Neither direction permits upgrading a carried-forward AI confidence.

**Field mapping — which document sections contribute to which schema fields:**

| sir_vendor Field | Primary Source Section |
|---|---|
| `zoning_status` | Section 1 → Jurisdiction & Permit → Zoning Classification |
| `permit_type` | Section 1 → Jurisdiction & Permit → Permit Type |
| `timeline_best_weeks` | Section 1 → Jurisdiction & Permit → Permit Best Case |
| `timeline_worst_weeks` | Section 1 → Jurisdiction & Permit → Permit Worst Case |
| `authority_chain` | Section 1 → Authority Chain table (if present), or new_findings |
| `code_framework.building_code` | Section 1 → Jurisdiction & Permit → Building Code Edition |
| `code_framework.fire_code` | Section 1 → Jurisdiction & Permit → Fire Code Edition |
| `code_framework.health_code` | Section 1 → Jurisdiction & Permit → State Admin Codes (health row) |
| `feasibility.occupancy_compatibility` | Section 1 → Building Characteristics → IBC Occupancy Classification |
| `feasibility.sprinkler_trigger` | Section 1 → IBC Code Analysis → Fire Area vs 12,000 SF |
| `feasibility.bathroom_requirement` | Section 1 → IBC Code Analysis → Bathrooms Required |
| `feasibility.construction_scope` | Section 2 task card completions + Section 3 corrections |

**Normalize values using the terminology map** in `references/vendor-terminology-map.md` before writing to `sir_vendor`.

### Step 6: Build the verification_summary

Count from the classified items:

```
total_bc_items    = total rows extracted from outbound claim-id list
verified_count    = confirmed + confirmed_unsourced + corrected + corrected_unsourced
confirmed_count   = confirmed + confirmed_unsourced
corrected_count   = corrected + corrected_unsourced
unverified_count  = unverified + unverified_with_source_note
new_findings_count = count of items in new_findings array
```

**Consistency check (must pass before writing to Sindri):**
- `total_bc_items == verified_count + unverified_count` ✓
- `verified_count == confirmed_count + corrected_count` ✓
- All claim-ids from the outbound `vendor_packets_sent` inventory are accounted for in `verified_items` ✓

If any check fails, log the discrepancy and identify which claim-ids are missing. Do not abort — write the record with a flag in `vendor_notes`.

### Step 7: Generate Human-Readable Markdown Summary

Produce a markdown summary alongside the JSON. This document is saved to Drive and linked as `source_doc_url` in the `sir_vendor` record.

```markdown
# CDS Verification Summary — {address}
Extracted: {timestamp} | Source: {source_doc_url}

## Verification Overview
- B/C items in outbound report: {total_bc_items}
- Verified by CDS: {verified_count} ({confirmed_count} confirmed, {corrected_count} corrected)
- Left unverified: {unverified_count}
- New findings added by CDS: {new_findings_count}

## Key Findings
### Confirmed (same as AI)
[Table: claim_id | field | value | cds_source | confidence]

### Corrected (different from AI)
[Table: claim_id | field | ai_finding | cds_finding | cds_source | confidence]

### Unverified (CDS did not address)
[Table: claim_id | field | ai_finding | ai_confidence]

### New Findings Added by CDS
[Table: field | finding | source | section]

## Schema Fields — Best Available Values
[Table: field | value | source (CDS or AI) | confidence]

## Vendor Notes
{vendor_notes}
```

Save to: `reports/{address-kebab-case}_cds-verification_{YYYY-MM-DD}.md`

---

## Output Contract

### Sindri Data Out: `sir_vendor`

Write to Sindri under the key `sir_vendor` for the site's `site_id`.

```json
{
  "sir_vendor": {
    "extracted_at": "ISO timestamp",
    "source_doc_url": "string — Drive URL of the CDS-returned document",
    "address": "string",
    "zoning_status": "string | null",
    "permit_type": "string | null",
    "timeline_best_weeks": "integer | null",
    "timeline_worst_weeks": "integer | null",
    "authority_chain": [
      {
        "authority": "string — e.g., 'Planning', 'Building', 'Fire'",
        "name": "string — department or agency name",
        "role": "string — what they control",
        "contact": "string | null — phone/email if available"
      }
    ],
    "code_framework": {
      "building_code": "string | null",
      "fire_code": "string | null",
      "health_code": "string | null"
    },
    "feasibility": {
      "occupancy_compatibility": "string | null",
      "sprinkler_trigger": "boolean | null",
      "bathroom_requirement": "string | null",
      "construction_scope": ["string"]
    },
    "verification_summary": {
      "total_bc_items": "integer",
      "verified_count": "integer",
      "confirmed_count": "integer",
      "corrected_count": "integer",
      "unverified_count": "integer",
      "new_findings_count": "integer"
    },
    "verified_items": [
      {
        "claim_id": "string — e.g., 'SIR-042'",
        "field": "string — schema field name or descriptive label",
        "ai_finding": "string",
        "ai_confidence": "B | C",
        "cds_finding": "string | null",
        "cds_source": "string | null",
        "cds_confidence": "A | B | null",
        "status": "confirmed | confirmed_unsourced | corrected | corrected_unsourced | unverified | unverified_with_source_note"
      }
    ],
    "new_findings": [
      {
        "field": "string — best-fit schema field name or 'narrative_note'",
        "finding": "string — CDS's exact language",
        "source": "string | null",
        "section": "string — document section this appeared in"
      }
    ],
    "vendor_notes": "string | null — free-text: any flags, address mismatches, consistency check failures, or notes from the vendor sign-off section"
  }
}
```

Full JSON Schema is in `references/shared-sir-schema.json`.

---

## Hard Rules

1. **Use the SAME base schema as sir_ai.** Field names in `sir_vendor` must match `sir_ai` exactly. This is required for WU-09 delta computation to operate field-by-field.
2. **When CDS verified a field, use the CDS value as the canonical value.** Do not keep the AI value when a CDS value exists.
3. **When CDS left a field blank, carry forward the AI value but do NOT upgrade its confidence.** A B stays B. A C stays C. No promotion happens without a CDS-sourced verification.
4. **Do not infer or fill fields neither the AI nor CDS addressed.** Leave null. Do not pull values from external sources.
5. **Preserve CDS's exact language** in `cds_finding` and `cds_source`. Normalize using the terminology map only for schema field values — not for the raw CDS text in `cds_finding`/`cds_source`.
6. **If CDS added findings outside the table structure, capture them in the `new_findings` array.** Do not silently discard them.
7. **Map CDS terminology to standard values using `references/vendor-terminology-map.md`** before writing to schema fields. Always record the raw CDS term in `cds_finding`.
8. **Never upgrade confidence.** A stays A, B stays B, C stays C. CDS can confirm (keep level) or provide new evidence at their own stated level. Carry-forward never upgrades.
9. **Claim-ids must match exactly between the outbound report and the extraction.** Do not create new claim-ids. Do not modify claim-ids.
10. **Flag any claim-id in the outbound report with no corresponding CDS response as `unverified`.** Do not skip or omit these from the `verified_items` array.
11. **Never write sir_vendor to Sindri if address validation fails with a hard mismatch** (completely different address, not just formatting differences). Flag and require human review.
12. **Run the verification_summary consistency check before writing to Sindri.** If it fails, log the issue in `vendor_notes` but still write the record — do not silently suppress.

---

## Downstream Usage

| Downstream WU | What It Uses |
|---|---|
| WU-09 (Delta Computation) | `sir_vendor` all schema fields (compared field-by-field against `sir_ai`) |
| WU-09 (Delta Computation) | `verified_items` (for disagreement analysis and correction tracking) |
| WU-13 (DD Report Assembly) | `sir_vendor` schema fields (preferred over `sir_ai` per vendor > AI precedence rule) |
| WU-13 (DD Report Assembly) | `verification_summary` (shown in Source Documents section) |
| WU-13 (DD Report Assembly) | `new_findings` (merged into report where schema-mapped, noted in vendor notes otherwise) |

---

## Quality Bar

The extraction is complete only when:

- Every claim-id from the outbound `vendor_packets_sent` record appears in `verified_items` (as verified, corrected, or unverified — none may be dropped)
- All sir_vendor schema fields are populated with the best available value (CDS-verified if present, AI carry-forward otherwise, null only if neither sourced the field)
- The three verification_summary consistency checks pass (or failures are documented in `vendor_notes`)
- No fabricated data — every value in `sir_vendor` traces to either the CDS return or `sir_ai`
- The human-readable markdown summary has been generated and its Drive URL is recorded in `source_doc_url`
- Terminology normalization has been applied to all schema field values
- CDS's exact language is preserved in `cds_finding` and `cds_source` for every item in `verified_items`

---

## RHODES Write

Yes — `sir_vendor` is the ground-truth vendor-verified SIR record. Write to Sindri under `sir_vendor` keyed by `site_id` after all consistency checks complete.

---

## Not In Scope

- Re-running the AI SIR research
- Contacting authorities or searching public records to fill gaps
- Making judgments about whether CDS's findings are correct
- Upgrading AI confidence levels based on inference (only CDS-sourced evidence may affect confidence)
- Generating the delta report — that is WU-09
- Running the DD Report — that is WU-13
