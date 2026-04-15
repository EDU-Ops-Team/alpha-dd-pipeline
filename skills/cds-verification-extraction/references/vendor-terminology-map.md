# Vendor Terminology Map

This document translates common CDS and vendor language to the canonical field values used in the shared SIR schema. Apply normalization before writing to `sir_vendor` schema fields. Always preserve the vendor's original language in `cds_finding` — normalization only applies to the mapped schema field value.

---

## How to Use This Map

1. Read CDS's raw text from the **CDS Verified Finding** column
2. Look up the raw text in the relevant table below
3. If a match is found, write the **Canonical Value** to the schema field
4. Write CDS's raw text to `cds_finding` unchanged
5. If no match is found, use CDS's raw text as-is and add a note to `vendor_notes` flagging the unmapped term

**Matching rule:** Apply case-insensitive, whitespace-normalized comparison. "by right" and "By Right" and "by-right" are all the same. Partial matches are allowed only where noted.

---

## Zoning Status

Maps to `sir_vendor.zoning_status`

| CDS Says | Canonical Value | Notes |
|---|---|---|
| By right | Permitted by right | Most common CDS shorthand |
| By-right | Permitted by right | Hyphenated variant |
| Permitted | Permitted by right | Generic — accept only if context is clearly about use permission |
| As-of-right | Permitted by right | Legal shorthand |
| Permitted use | Permitted by right | |
| Administrative approval | Permitted by right | Administrative-only path (no hearing) |
| Administrative permit | Permitted by right | |
| CUP | Conditional Use Permit | |
| Conditional use | Conditional Use Permit | |
| Conditional use permit | Conditional Use Permit | |
| Conditional use approval | Conditional Use Permit | |
| CUA | Conditional Use Permit | Some jurisdictions use "Conditional Use Authorization" |
| SUP | Special Use Permit | |
| Special use | Special Use Permit | |
| Special use permit | Special Use Permit | |
| Special exception | Special Use Permit | Common in mid-Atlantic jurisdictions |
| Special exception permit | Special Use Permit | |
| Special exception approval | Special Use Permit | |
| PUD | PUD Amendment | Planned Unit Development — likely requires amendment |
| Planned unit development | PUD Amendment | |
| Variance required | Variance Required | |
| ZBA required | Variance Required | Zoning Board of Appeals — indicates variance path |
| Board of zoning appeals | Variance Required | |
| BZA | Variance Required | |
| Rezoning required | Rezoning Required | |
| Zone change required | Rezoning Required | |
| Text amendment required | Rezoning Required | Code amendment path |
| Not permitted | Prohibited | |
| Prohibited use | Prohibited | |
| Not an allowed use | Prohibited | |
| Prohibited | Prohibited | |

**Unresolvable:** If CDS writes "Requires further research," "Unknown," or similar hedging language, write `null` to the schema field and preserve the raw text in `cds_finding`. Log in `vendor_notes`.

---

## Permit Type

Maps to `sir_vendor.permit_type`

| CDS Says | Canonical Value | Notes |
|---|---|---|
| BP | Building Permit | |
| Building permit | Building Permit | |
| Building permit only | Building Permit | |
| BP only | Building Permit | |
| COO | Change of Occupancy Permit | |
| Change of occupancy | Change of Occupancy Permit | |
| Change of use | Change of Occupancy Permit | Functionally equivalent in most jurisdictions |
| Change of use permit | Change of Occupancy Permit | |
| Use permit | Use Permit | Generic — more specific if context available |
| UP | Use Permit | |
| CUP + BP | Conditional Use Permit + Building Permit | Compound path |
| Conditional use + building permit | Conditional Use Permit + Building Permit | |
| CUP + building permit | Conditional Use Permit + Building Permit | |
| SUP + BP | Special Use Permit + Building Permit | Compound path |
| Special use + building permit | Special Use Permit + Building Permit | |
| Special exception + BP | Special Use Permit + Building Permit | |
| Site plan approval | Site Plan Approval + Building Permit | Site plan typically prerequisite to BP |
| Site plan + BP | Site Plan Approval + Building Permit | |
| Demo permit + BP | Demolition Permit + Building Permit | When demolition is part of scope |
| Tenant improvement | Tenant Improvement Permit | Common for interior-only work |
| TI permit | Tenant Improvement Permit | |
| Interior alteration | Interior Alteration Permit | |

---

## Occupancy Classification

Maps to `sir_vendor.feasibility.occupancy_compatibility` (the current occupancy part)

| CDS Says | IBC Canonical | Notes |
|---|---|---|
| Office | Group B | Business occupancy |
| B | Group B | |
| Medical office | Group B | |
| Professional office | Group B | |
| Retail | Group M | Mercantile occupancy |
| M | Group M | |
| Store | Group M | |
| Warehouse | Group S | Storage occupancy |
| S | Group S | Often S-1 (moderate hazard) or S-2 (low hazard) |
| Light industrial | Group F | Factory/industrial |
| Restaurant | Group A-2 | Assembly — food/drink |
| A-2 | Group A-2 | |
| Bar | Group A-2 | |
| Church | Group A-3 | Assembly — religious |
| A-3 | Group A-3 | |
| Club | Group A-3 | |
| Daycare | Group E | Educational — treat same as school for code triggers |
| School | Group E | |
| E | Group E | |
| Group E | Group E | Already canonical — use as-is |
| Residential | Group R | Need sub-classification (R-1 through R-4) |
| R | Group R | Ask for sub-type if relevant |
| Apartment | Group R-2 | Residential — multi-family |
| Healthcare | Group I | Institutional |
| I | Group I | Need sub-classification |

**Construction of the occupancy_compatibility string:**
- Format: "Current: {CDS canonical}. Change to Group E required." or "Current: {CDS canonical}. No occupancy change needed." (when already Group E)
- Always state whether a change of occupancy is required

---

## Confidence Level

Maps to `cds_confidence` in `verified_items`

CDS may use various confidence systems. Map to A/B/null:

| CDS Says | Maps To | Rationale |
|---|---|---|
| High | A | CDS-verified high confidence = authoritative |
| Confirmed | A | Explicit confirmation = authoritative |
| Verified | A | Explicit verification = authoritative |
| Confirmed with source | A | |
| A | A | Direct use of our system |
| Medium | B | CDS-verified but less certain = high-confidence inferred |
| Likely | B | |
| Probable | B | |
| B | B | Direct use of our system |
| Low | null | CDS is not confident — treat as unverified, flag in vendor_notes |
| Uncertain | null | |
| Unknown | null | |
| C | null | CDS should not return C — flag in vendor_notes, treat as unverified |
| D | null | CDS should not return D — flag in vendor_notes, treat as unverified |
| N/A | null | Not applicable to this site |
| — | null | Blank / dash |

**Important:** If CDS returns a C or D confidence, this is unexpected (CDS should only return A or B on items they have verified). Flag in `vendor_notes`: "CDS returned {C/D} confidence on claim-id {X} — treated as unverified pending human review."

---

## Common CDS Abbreviations

| Abbreviation | Full Term | Schema Relevance |
|---|---|---|
| AHJ | Authority Having Jurisdiction | authority_chain |
| BP | Building Permit | permit_type |
| CUP | Conditional Use Permit | zoning_status, permit_type |
| SUP | Special Use Permit | zoning_status, permit_type |
| COO / CO | Certificate of Occupancy | permit_type notes |
| C of O | Certificate of Occupancy | permit_type notes |
| TI | Tenant Improvement | permit_type |
| PD | Planning Department | authority_chain |
| BD | Building Department | authority_chain |
| FD | Fire Department | authority_chain |
| SFM | State Fire Marshal | authority_chain |
| DOH | Department of Health | authority_chain |
| FHA | Fire & Health Authority (combined) | authority_chain — split into two entries |
| DOT | Department of Transportation | authority_chain |
| FEMA | Federal Emergency Management Agency | feasibility / unknowns |
| ADA | Americans with Disabilities Act | feasibility.construction_scope |
| IBC | International Building Code | code_framework.building_code |
| IFC | International Fire Code | code_framework.fire_code |
| NFPA | National Fire Protection Association | code_framework.fire_code |
| NFPA 13 | NFPA 13 Sprinkler Standard | feasibility.sprinkler_trigger context |
| NFPA 72 | NFPA 72 Fire Alarm Standard | feasibility.construction_scope |
| BZ | Base Zoning | zoning_status context |
| OL | Occupant Load | feasibility.bathroom_requirement context |
| SF | Square Feet | Various |
| FA | Fire Area | feasibility.sprinkler_trigger context |
| BG / B/G | Below Grade | feasibility.sprinkler_trigger context |
| FAC | Florida Administrative Code | code_framework.health_code for FL sites |
| COMAR | Code of Maryland Regulations | code_framework for MD sites |

---

## Timeline Normalization

Maps to `timeline_best_weeks` and `timeline_worst_weeks` (integers — weeks)

| CDS Says | Normalize To | Notes |
|---|---|---|
| X weeks | X | Direct integer |
| X–Y weeks | best = X, worst = Y | Range — split to best/worst |
| X to Y weeks | best = X, worst = Y | |
| About X months | best = X×4, worst = X×5 | Convert months to weeks; months are imprecise |
| X–Y months | best = X×4, worst = Y×5 | |
| X days | round(X/7) | Convert days to weeks, round up |
| X business days | round(X/5) | Convert business days → work weeks → calendar weeks |
| TBD | null | Cannot compute — log as null |
| Unknown | null | |
| N/A | null | |

**When CDS provides a timeline different from AI:** If CDS provides a single number where AI had a range, use CDS's number for the field they addressed. Flag in `vendor_notes` if the provided value fills only one of the two fields.

---

## Source Citation Normalization

The `cds_source` field preserves CDS's exact language. For the confidence_labels field and downstream use, classify the source type:

| CDS Source Contains | Treat As | Confidence Class |
|---|---|---|
| "Staff call," "staff email," "planning call," similar | Staff confirmation | A |
| Statute number (e.g., "FL Stat. 553.80") | Published statute | A |
| Code citation (e.g., "IBC 2021 §903.2.3") | Published code | A |
| Ordinance number | Published ordinance | A |
| "County assessor," "assessor portal" | Authoritative database | A |
| FEMA map reference (e.g., "FIRM Panel 12099C0XXX") | FEMA authoritative | A |
| Permit database reference | Authoritative database | A |
| "County website," "city website" | Published online source | B |
| Published fee schedule | Published online source | B |
| "Google," "Google Maps" | Web research | B or C depending on what was looked up |
| "Satellite imagery," "street view" | Remote visual | C |
| "Site observation," "field visit," "observed on site" | Field observation | A (for field-verifiable facts) |
| "Visual inspection" | Field observation | A (for field-verifiable facts) |
| Blank | Unknown | null |

---

## Handling Unmapped Terms

When CDS uses a term not in this map:

1. Write CDS's exact text to `cds_finding` (required)
2. Attempt a best-guess canonical match from the nearest category
3. Write the best-guess canonical value to the schema field
4. Add a `vendor_notes` entry: "Unmapped CDS term '{raw term}' in field '{field}' — mapped to '{canonical}' using best-guess. Human review recommended."

If no reasonable guess exists, write `null` to the schema field and log the unmapped term.
