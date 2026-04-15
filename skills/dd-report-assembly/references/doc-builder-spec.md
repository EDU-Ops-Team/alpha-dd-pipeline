# Google Doc Builder Specification

The DD Report Google Doc is built from scratch using the Google Docs API v1 `batchUpdate` method. No template copying — the entire document structure is constructed programmatically.

---

## API

- Google Docs API v1 (`documents.batchUpdate`, `documents.get`)
- Google Drive API v3 (create blank doc, upload trace file)
- No wrapper libraries — raw API requests

## Entry Point

```
build_dd_report_doc(docs_service, drive_service, doc_id, replacements, site_title) -> trace_dict
```

- `doc_id`: ID of a blank Google Doc (created by caller)
- `replacements`: flat `dict[str, str]` — canonical token name → value
- `site_title`: site name for the report title
- Returns: hyperlink trace dict (`applied` count, `found_tokens`, `not_found_tokens`)

---

## Multi-Phase Build Process

The Google Docs API requires table cell indices to be read back from the live document after insertion — you cannot predict exact character offsets. This forces a multi-pass approach with document re-reads between phases.

### Phase 1: Title + Header Table

1. Insert report title: "Site Due Diligence Report" (24pt, bold, dark blue, centered)
2. Insert empty line
3. Insert header table (7 rows x 2 cols)
4. Flush via `batchUpdate`

### Phase 2: Populate Header Table

1. Re-read document to get element indices
2. Find header table (first table, index 0)
3. Populate cells in reverse row order:

| Row | Col 0 (Label) | Col 1 (Value Token) |
|---|---|---|
| 0 | Site Name / Address | `meta.site_name` |
| 1 | Current Marketing Name | `meta.marketing_name` |
| 2 | City, State, Zip | `meta.city_state_zip` |
| 3 | School Type | `meta.school_type` |
| 4 | Report Date | `meta.report_date` |
| 5 | Prepared By | `meta.prepared_by` |
| 6 | Drive Folder | `meta.drive_folder_url` (hyperlinked as "View Site Folder") |

4. Style: label cells = bold, 10pt Arial, light blue bg (#EFF5FB); value cells = normal, 10pt Arial, white bg
5. Column widths: 140pt (label), 328pt (value)
6. Flush

### Phase 3: Executive Summary

1. Re-read document, find end index
2. Insert horizontal divider (1pt solid light blue bottom border)
3. Insert "Executive Summary" heading (H1)
4. Insert "Can We Open?" card:
   - Question: "Can we open this school in time for the current school year?" (11pt bold)
   - Answer: `exec.c_answer` value (12pt bold)
   - Checklist (10pt):
     - Education Regulatory Approval: `exec.c_edreg`
     - Occupancy path: `exec.c_occupancy`
     - Zoning: `exec.c_zoning`
5. Insert "Buildout Analysis" heading (H2)
6. Insert Build Scenarios table (4 rows x 4 cols)
7. Flush

### Phase 4: Populate Build Scenarios Table

1. Re-read, find second table (index 1)
2. Populate in reverse order:

| Row | Col 0 | Col 1 (Fastest Open) | Col 2 (Max Capacity) | Col 3 (Recommended Path) |
|---|---|---|---|---|
| 0 (header) | "" | "Fastest Open" | "Max Capacity" | "Recommended Path" |
| 1 | "Student Capacity" | `exec.fastest_open_capacity` | `exec.max_capacity_capacity` | `exec.recommended_path_capacity` |
| 2 | "Target Open Date" | `exec.fastest_open_open_date` | `exec.max_capacity_open_date` | `exec.recommended_path_open_date` |
| 3 | "Estimated CAPEX" | `exec.fastest_open_capex` | `exec.max_capacity_capex` | `exec.recommended_path_capex` |

3. Style: header row = dark blue bg (#1A3C5E), white bold 10pt; data = bold labels in col 0; Recommended Path column may show highlighted bg (#E8F5E9) to visually distinguish the recommendation
4. Flush

### Phase 5: Cost Breakdown

1. Re-read, find end index
2. Insert "Detailed Cost Breakdown" heading (H2)
3. Insert cost table (13 rows x 4 cols)
4. Flush
5. Re-read, find third table (index 2)
6. Populate in reverse order:

| Row | Col 0 (Label) | Col 1 (Fastest Open) | Col 2 (Max Capacity) |
|---|---|---|---|
| 0 (header) | "Line Item" | "Fastest Open" | "Max Capacity" |
| 1 | "Demolition" | `exec.cost_demolition_fastest_open` | `exec.cost_demolition_max_capacity` |
| 2 | "Framing / Doors" | `exec.cost_framing_doors_fastest_open` | `exec.cost_framing_doors_max_capacity` |
| 3 | "MEP / Fire / Life Safety" | `exec.cost_mep_fire_life_safety_fastest_open` | `exec.cost_mep_fire_life_safety_max_capacity` |
| 4 | "Plumbing / Bathrooms" | `exec.cost_plumbing_bathrooms_fastest_open` | `exec.cost_plumbing_bathrooms_max_capacity` |
| 5 | "Finish Work" | `exec.cost_finish_work_fastest_open` | `exec.cost_finish_work_max_capacity` |
| 6 | "Furniture" | `exec.cost_furniture_fastest_open` | `exec.cost_furniture_max_capacity` |
| 7 | "Tech / Security / Signage" | `exec.cost_tech_security_signage_fastest_open` | `exec.cost_tech_security_signage_max_capacity` |
| 8 | "Other Hard Costs" | `exec.cost_other_hard_costs_fastest_open` | `exec.cost_other_hard_costs_max_capacity` |
| 9 | "Soft Costs" | `exec.cost_soft_costs_fastest_open` | `exec.cost_soft_costs_max_capacity` |
| 10 | "GC Fee" | `exec.cost_gc_fee_fastest_open` | `exec.cost_gc_fee_max_capacity` |
| 11 | "Contingency" | `exec.cost_contingency_fastest_open` | `exec.cost_contingency_max_capacity` |
| 12 | "Grand Total" | `exec.cost_grand_total_fastest_open` | `exec.cost_grand_total_max_capacity` |

7. Style: header = dark blue/white; alternating light gray (#F8F9FA) on odd data rows; labels bold; Grand Total row bold values
8. Flush

### Phase 6: Notes + Source Documents

1. Re-read, find end index
2. Insert "Notes and Source Documents" heading (H1)
3. Insert "Acquisition Conditions" subheading (11pt bold) + `exec.acquisition_conditions` value
4. Insert "Risks to Note" subheading (11pt bold) + `exec.risk_notes` value
5. Insert "Source Documents" heading (H2)
6. Insert source documents table (7 rows x 2 cols)
7. Flush

### Phase 7: Populate Source Documents Table

1. Re-read, find fourth table (index 3)
2. Populate in reverse order:

| Row | Col 0 (Document) | Col 1 (Link Token) | Display Label |
|---|---|---|---|
| 0 (header) | "Document" | "Link" | — |
| 1 | "Site Investigation Report (SIR)" | `sources.sir_link` | "View SIR" |
| 2 | "Building Inspection Report" | `sources.inspection_link` | "View Inspection" |
| 3 | "ISP" | `sources.isp_link` | "View ISP" |
| 4 | "Ease of Conversion Report" | `sources.e_occupancy_link` | "View E-Occupancy" |
| 5 | "School Approval Report" | `sources.school_approval_link` | "View School Approval" |
| 6 | "Trace Report" | `sources.trace_link` | "View Report Trace" |

3. Link values starting with `http`: render as clickable hyperlink with display label, blue color (#1155CC)
4. Non-URL values: render as plain text
5. Style: header = dark blue/white; labels bold
6. Flush
7. Track all hyperlink applications in trace dict

---

## Style Constants

| Name | RGB | Hex | Usage |
|---|---|---|---|
| Dark Blue | (0.102, 0.235, 0.369) | #1A3C5E | Table headers, title |
| White | (1.0, 1.0, 1.0) | #FFFFFF | Header text, value cell bg |
| Light Blue BG | (0.937, 0.961, 0.984) | #EFF5FB | Header table label cells |
| Light Blue Border | (0.722, 0.796, 0.878) | #B8CBE0 | Section dividers |
| Light Gray | (0.973, 0.976, 0.980) | #F8F9FA | Alternating row shading |
| Link Blue | (0.067, 0.333, 0.800) | #1155CC | Hyperlinks |

Font: Arial 10pt throughout. Exceptions: title 24pt, question 11pt, answer 12pt.

---

## Tables Summary

| Index | Location | Dimensions | Purpose |
|---|---|---|---|
| 0 | Header | 7 x 2 | Site metadata |
| 1 | Build Scenarios | 4 x 4 | Capacity/CAPEX/Date by scenario (Fastest, Max Cap, Recommended) |
| 2 | Cost Breakdown | 13 x 4 | 12 line items + header (3 scenarios + label col) |
| 3 | Source Documents | 7 x 2 | Document links |

---

## Error Handling

- Table not found after insertion → log error, return partial trace
- Each phase's `batchUpdate` is independent — earlier phases persist if a later phase fails
- Builder never raises exceptions — always returns the trace dict
