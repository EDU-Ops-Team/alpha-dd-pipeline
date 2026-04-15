# V3 Token Map — Complete Token-to-Sindri-Source Mapping

Total tokens: 71 (7 meta + 4 exec card + 12 scenario summary + 48 cost breakdown + 2 notes + 6 sources — some overlap in counting)

---

## Meta Tokens (7)

| Token | Sindri Source | Format |
|---|---|---|
| `meta.site_name` | `site_meta.address` → derive "Alpha {City}" | String |
| `meta.city_state_zip` | `site_meta.city` + `site_meta.state` | "City, ST ZIP" |
| `meta.school_type` | `site_meta.school_type` | String |
| `meta.marketing_name` | derived or same as site_name | String |
| `meta.report_date` | System: current date | MM/DD/YYYY |
| `meta.prepared_by` | `site_meta.p1_name` | String |
| `meta.drive_folder_url` | `site_meta.drive_folder_url` | URL (hyperlinked as "View Site Folder") |

---

## "Can We Open?" Card (4)

| Token | Sindri Source | Allowed Values |
|---|---|---|
| `exec.c_answer` | Synthesized from c_zoning + c_occupancy + c_edreg | `Yes` / `Yes see notes` / `No` |
| `exec.c_zoning` | `sir_best.zoning_status` (vendor > AI) | `Permitted by right` / `Use Permit Required (Admin approval)` / `Use Permit Required (Public approval)` / `Prohibited` |
| `exec.c_occupancy` | `sir_best.feasibility.occupancy_compatibility` + `sir_best.e_occupancy_score` | `Has E-Occupancy` / `Change of use required, meets E-Occupancy` / `Change of use required, needs work` |
| `exec.c_edreg` | `school_approval.archetype` + `school_approval.gating_before_open` | `Not required` / `Required and have done` / `Required have not done` |

---

## Build Scenario Summary (12 = 4 scenarios x 3 metrics)

### Active Scenarios

| Token | Sindri Source |
|---|---|
| `exec.fastest_open_capacity` | `isp_extract.capacity_tiers.micro.max_students` |
| `exec.fastest_open_capex` | `cost_estimates.scenarios["Light renovation"].total` |
| `exec.fastest_open_open_date` | `opening_plan.scenarios.best.target_date` |
| `exec.max_capacity_capacity` | `isp_extract.capacity_tiers.250.max_students` (or .1000 by school type) |
| `exec.max_capacity_capex` | `cost_estimates.scenarios["Full buildout"].total` |
| `exec.max_capacity_open_date` | `opening_plan.scenarios.worst.target_date` |

### Recommended Path (Inferred)

| Token | Source |
|---|---|
| `exec.recommended_path_capacity` | Copied from the winning scenario (see SKILL.md Step 4 inference logic) |
| `exec.recommended_path_capex` | Copied from the winning scenario |
| `exec.recommended_path_open_date` | Copied from the winning scenario |

Inference rule: If both Fastest Open and Max Capacity can complete before Aug 12, 2026, the scenario with higher `capacity / capex` ratio wins. If only one can finish on time, that one wins. When Max Value is added, all on-time scenarios compete on capacity-per-dollar.

### Gap-Labeled Scenarios

| Token | Gap Label |
|---|---|
| `exec.max_value_capacity` | `[Not found — Max Value scenario data not yet available in the pipeline]` |
| `exec.max_value_capex` | `[Not found — Max Value scenario data not yet available in the pipeline]` |
| `exec.max_value_open_date` | `[Not found — Max Value scenario data not yet available in the pipeline]` |

---

## Detailed Cost Breakdown (48 = 12 line items x 4 scenarios)

### Token Pattern

`exec.cost_{row_key}_{scenario}`

### Row Keys

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

### Source by Scenario

| Scenario | Source | Notes |
|---|---|---|
| `fastest_open` | `cost_estimates.scenarios["Light renovation"].line_items` | RayCon MVP scenario |
| `max_capacity` | `cost_estimates.scenarios["Full buildout"].line_items` | RayCon Ideal scenario |
| `recommended_path` | Copied from the winning scenario (Fastest Open or Max Capacity) | Inferred via capacity-per-dollar |
| `max_value` | Empty string `""` | Not yet in pipeline |

### RayCon Line Item → Row Key Mapping

| RayCon Field | Row Key |
|---|---|
| `demolition` | `demolition` |
| `framing` / `framing_doors` | `framing_doors` |
| `mep` / `mep_fire_life_safety` | `mep_fire_life_safety` |
| `plumbing` / `plumbing_bathrooms` | `plumbing_bathrooms` |
| `finishes` / `finish_work` | `finish_work` |
| `furniture` / `ff_e` | `furniture` |
| `technology` / `tech_security_signage` | `tech_security_signage` |
| `other` / `other_hard_costs` | `other_hard_costs` |
| `soft_costs` | `soft_costs` |
| `gc_fee` / `general_contractor` | `gc_fee` |
| `contingency` | `contingency` |
| `total` / `grand_total` | `grand_total` |

---

## Notes Tokens (2)

| Token | Sindri Sources | Format |
|---|---|---|
| `exec.acquisition_conditions` | `inspection_best` (TI asks) + `sir_best` (zoning pre-conditions) + `permit_history` (violations) | Bullet list with source citations |
| `exec.risk_notes` | `inspection_best` (MEP/structural) + `sir_best` (permit blockers) + `permit_history` (deferred maintenance) + `sir_delta`/`inspection_delta` (conflicts) + `opening_plan` (gating factors) | Bullet list with source citations |

---

## Source Document Links (6)

| Token | Sindri Source | Display Label | Gap Label |
|---|---|---|---|
| `sources.sir_link` | `source_doc_urls.sir` | "View SIR" | `[Not found - SIR]` |
| `sources.inspection_link` | `source_doc_urls.inspection` | "View Inspection" | `[Not found - Building Inspection]` |
| `sources.isp_link` | `source_doc_urls.isp` | "View ISP" | `[Not found - ISP]` |
| `sources.e_occupancy_link` | `source_doc_urls.sir` (Phase 7 embedded) | "View E-Occupancy" | `[Not found - E-Occupancy Assessment]` |
| `sources.school_approval_link` | `source_doc_urls.school_approval` | "View School Approval" | `[Not found - School Approval Assessment]` |
| `sources.trace_link` | Auto-populated post-build | "View Report Trace" | (empty) |

---

## Gap Label Scheme

Never use bare `[Pending]` or `[TBD]`. Always use sourced gap labels:

```
[Not found - {what was checked and why it's missing}]
```

Examples:
- `[Not found - SIR not yet available from any source]`
- `[Not found - ISP extraction not yet complete]`
- `[Not found - building inspection not yet received from vendor]`
- `[Not found - Recommended Path scenario not provided]`
- `[Not found - P1 not set in site record]`
