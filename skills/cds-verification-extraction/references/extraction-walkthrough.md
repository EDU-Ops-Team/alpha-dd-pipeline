# Extraction Walkthrough — Processing a CDS Return

This document walks through the full extraction process for a CDS-completed verification report, step by step with annotated examples. Read this alongside `SKILL.md` (which defines the rules) and `vendor-terminology-map.md` (which defines the normalization).

---

## What You're Working With

When CDS returns a completed verification report, it looks like the outbound AI SIR vendor packet with extra columns filled in. Every B/C-confidence row that was sent out now has up to three CDS-added columns:

```
| Data Point         | Value                          | Source          | Conf | CDS Verified Finding          | CDS Source                    | CDS Conf |
|--------------------|--------------------------------|-----------------|------|-------------------------------|-------------------------------|----------|
| Zoning Class       | AI found: C-2 General Comm.    |                 | B    | C-2 General Commercial        | Planning dept website 4/7     | A        |
<!-- claim-id: SIR-003 -->
```

The `<!-- claim-id: SIR-003 -->` HTML comment on the next line is the key that links this row back to the outbound report.

---

## Step 1: Identify the CDS Columns

### What to Look For

The outbound vendor packet has this column structure in all Section 1 tables:

```
| Data Point | Value | Source | Confidence |
```

After CDS fills in the return, three more columns appear to the right:

```
| Data Point | Value | Source | Confidence | CDS Verified Finding | CDS Source | CDS Confidence |
```

The exact column names may vary slightly — CDS may write "CDS Finding" instead of "CDS Verified Finding," or "Conf" as a shortened header. Accept any reasonable variant. What matters is the position: three rightmost columns added by CDS.

### Column Recognition Rules

1. **The CDS Confidence column** is the rightmost. It contains values like "A", "B", "High", "Confirmed", or is blank.
2. **The CDS Source column** is the second-from-right. It contains the citation (statute, staff call, portal, etc.) or is blank.
3. **The CDS Verified Finding column** is the third-from-right. It contains CDS's finding in plain language or is blank.

### When Columns Are Missing

If the document has only the original four columns with no CDS additions, the vendor returned the document without filling in the verification columns. All B/C rows will be classified as `unverified`. Log this in `vendor_notes`.

If only some tables have CDS columns (partial return), extract what's present and mark absent rows as `unverified`.

---

## Step 2: Find the Claim-ID HTML Comments

### What They Look Like

Every B/C row in the outbound packet is followed by a comment on the next line:

```html
<!-- claim-id: SIR-042 -->
```

The format is always: `<!-- claim-id: SIR-` followed by a three-or-more digit number, then ` -->`.

### Where to Find Them

In a markdown file, the comment appears on its own line immediately after the table row:

```
| Fire Area vs 12,000 SF | AI found: 18,400 SF — please verify | | B | 18,400 SF per assessor records | County assessor portal | A |
<!-- claim-id: SIR-021 -->
```

In a .docx conversion to markdown, the comment may have been stripped by the conversion. If no comments are found after conversion:
1. Try a different docx-to-markdown converter that preserves HTML comments
2. If still absent, fall back to field-name matching against `sir_ai` (see Step 2 fallback below)

### Fallback: Match by Field Name

When no claim-id comments are found, match rows to `sir_ai` fields using:
1. The row's **Data Point** cell value (e.g., "Fire Area vs 12,000 SF")
2. The row's **AI value** cell value (e.g., "AI found: 18,400 SF — please verify")
3. Cross-reference both against the `sir_ai.confidence_labels` keys and values

All rows matched this way are flagged `matched_by_field_name` in the extraction log. They are valid but carry lower confidence in the match itself. Include them in `verified_items` with a note.

### Building the Claim-ID Inventory

Before parsing any rows, load the full claim-id list from `vendor_packets_sent` in Sindri. This is your authoritative list of every B/C item that was sent to CDS. Any claim-id on this list that does not appear in the returned document is classified `unverified`.

---

## Step 3: Classify Each Row

After reading the CDS columns for a row, apply the classification matrix:

```
Is CDS Verified Finding filled in?
├── YES
│   ├── Is the value semantically the same as the AI finding? (use terminology map)
│   │   ├── YES → Is CDS Source filled in?
│   │   │         ├── YES → confirmed
│   │   │         └── NO  → confirmed_unsourced
│   │   └── NO  → Is CDS Source filled in?
│   │             ├── YES → corrected
│   │             └── NO  → corrected_unsourced (flag for human review)
└── NO
    ├── Is CDS Source filled in?
    │   ├── YES → unverified_with_source_note (CDS noted a source but left finding blank)
    │   └── NO  → unverified
```

### Semantic Comparison Examples

These are all `confirmed` (semantically same, despite different text):

| AI Finding | CDS Finding | Why Same |
|---|---|---|
| `C-2 General Commercial` | `C-2 General Comm.` | Abbreviation of same value |
| `By right` | `Permitted by right` | Terminology map resolves both to same canonical |
| `18,400 SF` | `18,400 square feet per assessor` | Same number, different units format |
| `2021 IBC` | `IBC 2021 as adopted by state` | Same edition, added context |
| `12 weeks` | `12–14 weeks` | AI was within range — treat as confirmed; note the expanded range in `vendor_notes` |

These are all `corrected` (semantically different):

| AI Finding | CDS Finding | Why Different |
|---|---|---|
| `C-2 General Commercial` | `C-1 Neighborhood Commercial` | Different zoning district |
| `By right` | `SUP required` | Different use permission path |
| `18,400 SF` | `16,200 SF` | Significantly different numeric value (>5% difference) |
| `Building Permit` | `CUP + Building Permit` | Different (more complex) permit type |
| `2018 IBC` | `2021 IBC` | Different code edition |

### Numeric Comparison Rules

- **Tolerance for "same":** Values within 5% of each other AND not decision-critical → classify as `confirmed`
- **Decision-critical fields** (always compare exactly, no tolerance): `sprinkler_trigger` (boolean), `timeline_best_weeks` and `timeline_worst_weeks` (any change matters), `zoning_status` (any semantic change matters)
- **Year built:** Exact match required. A 1-year difference may indicate a different building or a recording correction.

---

## Step 4: Handle New Findings Outside the Standard Tables

CDS adds findings in three places outside the standard table structure. Check all three.

### 4a: Section 3 — "Corrections and Open Items"

The vendor return template includes a Section 3 with this format:

```
| Item        | AI Said    | Correct Finding     | Your Source        | Remote-findable? |
|-------------|------------|---------------------|-------------------|------------------|
| Health auth | FL DOH     | Broward County DOH  | Staff call 4/7    | YES              |
```

For each Section 3 row:
- `field` → map "Item" to the closest schema field name
- `finding` → use "Correct Finding" as the finding text
- `source` → use "Your Source"
- `section` → "Section 3 — Corrections and Open Items"

**Note:** Section 3 corrections should also be applied to the corresponding schema field in `sir_vendor`. If "Health auth" is corrected, update `authority_chain` accordingly.

### 4b: Additional Rows in Existing Tables

CDS sometimes adds rows to existing tables that have no AI antecedent (no `<!-- claim-id: ... -->`). Example:

```
| Parking Requirement  | 1 space per 300 SF per zoning code | City zoning portal | A |
(no claim-id comment)
```

These are new findings. Extract as:
- `field` → best-fit schema field (e.g., "parking_requirement")
- `finding` → CDS's value
- `source` → CDS's stated source
- `section` → table section name (e.g., "Section 1 — Jurisdiction & Permit table")

### 4c: Free-Text Notes and Vendor Sign-Off

The vendor sign-off section and any free-text blocks may contain substantive findings:

```
Vendor Sign-Off Notes:
"Note: the fire marshal in this jurisdiction requires a separate plan review
application filed directly with SFM. This is not part of the building permit
review and runs concurrently. Allow 6–8 additional weeks."
```

Extract this as a `narrative_note`:
- `field` → "narrative_note"
- `finding` → CDS's exact text
- `source` → null (or infer from context if stated)
- `section` → "Vendor Sign-Off Notes"

---

## Step 5: Example of a Fully Processed Row

### The Raw Document Row

```markdown
| Zoning Classification | AI found: C-2 General Comm. — please verify |  | B | C-2 General Commercial | Planning Dept website (zoning map, accessed 4/7/26) | A |
<!-- claim-id: SIR-003 -->
```

### Extraction Steps

**Step 1 — Read the row:**
- Data Point: "Zoning Classification"
- AI Value: "C-2 General Comm." (stripped "AI found:" prefix and "— please verify" suffix)
- AI Confidence: B
- CDS Verified Finding: "C-2 General Commercial"
- CDS Source: "Planning Dept website (zoning map, accessed 4/7/26)"
- CDS Confidence: A
- Claim-ID: SIR-003

**Step 2 — Compare values:**
- AI: "C-2 General Comm."
- CDS: "C-2 General Commercial"
- Comparison: CDS spelled out the abbreviation. Same value → `confirmed`

**Step 3 — Classify:**
- CDS finding filled: YES
- Same as AI: YES
- CDS source filled: YES
- Result: `confirmed`

**Step 4 — Map to schema:**
- Field: `zoning_status`
- AI value maps to: None (C-2 is not in the zoning_status canonical list — it's a district name, not a permission status. Need the Jurisdiction & Permit → Educational Use Permission row for canonical zoning_status)
- Note: "Zoning Classification" (district name) maps to context for `zoning_status` but the permission status comes from the "Educational Use Permission" row. This row provides confirming evidence for the zoning district.

**Step 5 — Write to verified_items:**

```json
{
  "claim_id": "SIR-003",
  "field": "zoning_classification",
  "ai_finding": "C-2 General Comm.",
  "ai_confidence": "B",
  "cds_finding": "C-2 General Commercial",
  "cds_source": "Planning Dept website (zoning map, accessed 4/7/26)",
  "cds_confidence": "A",
  "status": "confirmed"
}
```

**Step 6 — Schema field update:**
- The actual `zoning_status` field is populated from the "Educational Use Permission" row (SIR-007), not from this row. This row contributes confirming evidence but does not directly populate `zoning_status`.
- Log which claim-id populated each schema field in the extraction log.

---

### A Corrected Row Example

```markdown
| Permit Best Case (weeks) | AI found: 10 weeks — please verify |  | C | 16 weeks | Staff call with Planning, 4/8/26 | A |
<!-- claim-id: SIR-019 -->
```

**Extraction:**
- AI Finding: "10 weeks"
- CDS Finding: "16 weeks"
- Same? No — 16 is 60% larger than 10, well outside 5% tolerance
- Source filled: YES
- Classification: `corrected`
- Schema field: `timeline_best_weeks`
- Canonical value: 16 (integer, weeks)
- Confidence used: A (CDS's stated confidence, based on staff call)

```json
{
  "claim_id": "SIR-019",
  "field": "timeline_best_weeks",
  "ai_finding": "10",
  "ai_confidence": "C",
  "cds_finding": "16 weeks",
  "cds_source": "Staff call with Planning, 4/8/26",
  "cds_confidence": "A",
  "status": "corrected"
}
```

`sir_vendor.timeline_best_weeks` → 16 (CDS value takes precedence)
`sir_vendor.confidence_labels.timeline_best_weeks` → "A" (CDS's stated confidence)

---

### An Unverified Row Example

```markdown
| Building Code Edition | AI found: 2021 IBC as amended — please verify |  | B |  |  |  |
<!-- claim-id: SIR-011 -->
```

**Extraction:**
- AI Finding: "2021 IBC as amended"
- CDS Verified Finding: blank
- CDS Source: blank
- CDS Confidence: blank
- Classification: `unverified`

```json
{
  "claim_id": "SIR-011",
  "field": "code_framework.building_code",
  "ai_finding": "2021 IBC as amended",
  "ai_confidence": "B",
  "cds_finding": null,
  "cds_source": null,
  "cds_confidence": null,
  "status": "unverified"
}
```

`sir_vendor.code_framework.building_code` → "2021 IBC as amended" (AI value carried forward)
`sir_vendor.confidence_labels.code_framework.building_code` → "B" (AI confidence preserved — not upgraded)

---

## Step 6: Verification Summary Consistency Check

After all rows are classified, compute and validate the summary:

```
total_bc_items    = 24  (from vendor_packets_sent claim-id inventory)
confirmed_count   = 14  (confirmed + confirmed_unsourced)
corrected_count   =  5  (corrected + corrected_unsourced)
verified_count    = 19  (confirmed_count + corrected_count)
unverified_count  =  5  (total_bc_items - verified_count)
new_findings_count = 3  (from new_findings array)
```

**Check 1:** `total_bc_items == verified_count + unverified_count` → `24 == 19 + 5` ✓
**Check 2:** `verified_count == confirmed_count + corrected_count` → `19 == 14 + 5` ✓
**Check 3:** All 24 claim-ids from the outbound list appear in verified_items ✓

If a check fails, list the specific claim-ids that are missing or miscounted, log in `vendor_notes`, and proceed with the write.

---

## Common Extraction Problems and Solutions

### Problem: No claim-id comments in the returned document

**Cause:** .docx conversion stripped HTML comments, or CDS retyped the document.

**Solution:**
1. Re-run .docx conversion with a comment-preserving tool
2. If still missing, match rows by field name and AI value against `sir_ai`
3. Flag all matches as `matched_by_field_name` in extraction log
4. Note in `vendor_notes`: "claim-id comments absent from returned document — matched by field name"

### Problem: CDS added columns but uses different column headers

**Cause:** CDS's template varies from the standard.

**Solution:** Use column position (rightmost three columns) as the primary identifier, not column header text. If there are more than the expected 7 columns (4 original + 3 CDS), inspect the document structure manually.

### Problem: CDS provided a range where AI gave a single value (or vice versa)

**Example:** AI said "8 weeks"; CDS said "8–12 weeks."

**Solution:**
- If AI gave a single value and CDS gave a range: treat the single AI value as a point estimate. If it falls within CDS's range, classify as `confirmed`. If it falls outside, classify as `corrected`.
- If AI gave a range and CDS gave a single value: map CDS's value to the appropriate field (`timeline_best_weeks` or `timeline_worst_weeks` depending on context). Note in `vendor_notes` that CDS provided a point estimate where a range was expected.

### Problem: CDS corrected a field but the correction uses a term not in the terminology map

**Solution:**
1. Write CDS's exact text to `cds_finding`
2. Attempt a best-guess canonical mapping
3. Log in `vendor_notes`: "Unmapped CDS term in [field] — used best-guess canonical"
4. Write the best-guess canonical to the schema field, or null if no reasonable match

### Problem: CDS verified a field at a different granularity than the AI

**Example:** AI said `code_framework.fire_code = "2021 IFC"`. CDS said "NFPA 13 (2022 edition) and NFPA 72 (2022 edition) — local adoption confirmed per SFM staff call."

**Solution:** CDS's finding is more granular and provides authoritative sourcing. Classify as `confirmed` (the IFC/NFPA alignment is semantic equivalence for fire code framework). Write `sir_vendor.code_framework.fire_code` as CDS's more complete description. Preserve CDS's exact text in `cds_finding`.

### Problem: A claim-id appears in the outbound list but not in the returned document

**Cause:** CDS may have deleted a row, the document was truncated, or the table was reformatted.

**Solution:**
1. Check whether the row exists in the document with different formatting or in a different location
2. If genuinely absent, classify as `unverified` with a note: "Row absent from returned document — classified as unverified per missing claim-id rule"
3. Log in `vendor_notes`

---

## Extraction Log Format

Maintain an extraction log during processing. This is internal — not written to Sindri — but retained for debugging.

```
[SIR-003] Zoning Classification → confirmed (A) — field: zoning_classification
[SIR-007] Educational Use Permission → confirmed (A) → zoning_status = "Permitted by right"
[SIR-011] Building Code Edition → unverified — AI value carried forward at B
[SIR-019] Permit Best Case → corrected (A) — AI: 10 weeks → CDS: 16 weeks
[SIR-021] Fire Area → confirmed (A) — same value
[SIR-031] ABSENT from return → unverified (missing claim-id)
NEW FINDING: Section 3 row → field: authority_chain (state fire marshal contact) → finding: "SFM office: 555-0142"
MATCHED_BY_FIELD_NAME: SIR-044 (no comment found — matched to "Assessor Use Code" by field name)
```
