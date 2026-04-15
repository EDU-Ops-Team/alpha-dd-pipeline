# Sindri Input Schemas — Work Unit Output Formats

Each schema below defines the structured data this agent receives from upstream work units via Sindri. The agent reads these — it never calls upstream APIs or re-runs skills.

**Human-readable output requirement:** Every upstream work unit that produces a support document must write BOTH:
1. Structured JSON to Sindri (for this agent and downstream processing)
2. A human-readable document (markdown rendered as PDF, or Google Doc) to Google Drive (for stakeholders, linked in the DD Report's Source Documents table)

The `source_doc_urls` payload at the bottom of this file points to the human-readable versions. If an upstream work unit only writes structured data and no human-readable document, the Source Documents link will show a gap label.

---

## site_meta (WU-01: New Site Intake)

```json
{
  "site_id": "string — RHODES site ID",
  "address": "string — full street address",
  "city": "string",
  "state": "string — 2-letter code",
  "school_type": "micro | 250 | 1000",
  "drive_folder_url": "string — Google Drive folder URL",
  "loi_doc_url": "string — uploaded LOI URL",
  "p1_name": "string | null",
  "p1_email": "string | null",
  "stage": "M1",
  "created_at": "ISO timestamp"
}
```

---

## sir_ai (WU-02: AI SIR Generation)

```json
{
  "address": "string",
  "score": "integer 0-100",
  "rating": "GREEN | YELLOW | ORANGE | RED",
  "recommendation": "PROCEED | PROCEED WITH CAUTION | REQUIRES JUSTIFICATION | PASS",
  "e_occupancy_score": "integer 0-100",
  "e_occupancy_rating": "string",
  "zoning_status": "string — e.g., 'Permitted by right', 'Conditional Use Permit'",
  "permit_type": "string — e.g., 'Building Permit', 'Use Permit + Building Permit'",
  "timeline_best_weeks": "integer",
  "timeline_worst_weeks": "integer",
  "cost_range_low": "integer — dollars",
  "cost_range_high": "integer — dollars",
  "authority_chain": [
    {
      "authority": "string — e.g., 'Planning', 'Building', 'Fire'",
      "name": "string — department or agency name",
      "role": "string — what they control",
      "contact": "string — phone/email if available"
    }
  ],
  "code_framework": {
    "building_code": "string — e.g., '2021 IBC as amended'",
    "fire_code": "string",
    "health_code": "string"
  },
  "feasibility": {
    "occupancy_compatibility": "string — current vs required occupancy",
    "sprinkler_trigger": "boolean",
    "bathroom_requirement": "string — count needed vs existing",
    "construction_scope": ["string — scope item 1", "string — scope item 2"]
  },
  "unknowns": [
    {
      "item": "string — what's unknown",
      "why_it_matters": "string",
      "field_only": "boolean — can only be resolved with a site visit"
    }
  ],
  "report_url": "string — Drive URL of the full SIR document",
  "confidence_labels": {
    "field_name": "A | B | C | D"
  }
}
```

---

## sir_vendor (WU-06: Vendor SIR Extraction)

Same schema as `sir_ai` (shared SIR schema) plus:

```json
{
  "extracted_at": "ISO timestamp",
  "source_doc_url": "string — Drive URL of the vendor PDF",
  "vendor_notes": "string — free-text notes from vendor not captured in schema"
}
```

Fields may be null if the vendor did not address them.

---

## school_approval (WU-03: School Approval Analysis)

```json
{
  "state": "string — 2-letter code",
  "archetype": "MINIMAL | NOTIFICATION | APPROVAL_REQUIRED | HEAVILY_REGULATED | WINDOWED",
  "zone": "green | yellow | red",
  "score_0_100": "integer",
  "ease_score_0_10": "float",
  "approval_type": "NONE | REGISTRATION_SIMPLE | LOCAL_APPROVAL_REQUIRED | LICENSE_REQUIRED | CERTIFICATE_OR_APPROVAL_REQUIRED | COMPLEX_OR_OVERSIGHT",
  "gating_before_open": "boolean",
  "timeline_days_preopen": {
    "min": "integer",
    "likely": "integer",
    "max": "integer"
  },
  "requirements_summary": "string — plain English",
  "requirements_steps": [
    { "step": "string", "gating": "boolean" }
  ],
  "preopen_requirements": {
    "teacher_certification_required": "boolean",
    "curriculum_approval_required": "boolean",
    "health_safety_inspection_required": "boolean",
    "background_check_required": "boolean",
    "financial_reserve_required": "boolean"
  },
  "calendar_window": {
    "next_window_date": "string | null",
    "submission_deadline": "string | null",
    "calendar_risk": "boolean"
  },
  "local_requirements": {
    "has_local_overlay": "boolean",
    "local_notes": "string"
  },
  "source_urls": ["string"],
  "confidence_0_1": "float"
}
```

---

## inspection_vendor (WU-07: Vendor Building Inspection Extraction)

```json
{
  "extracted_at": "ISO timestamp",
  "source_doc_url": "string — Drive URL of the vendor PDF",
  "address": "string",
  "structural": {
    "construction_type": "string",
    "stories": "integer",
    "basement": "boolean",
    "roof_type": "string",
    "foundation": "string",
    "condition": "string"
  },
  "mep": {
    "hvac_type": "string",
    "hvac_condition": "string",
    "electrical_panel": "string",
    "plumbing_condition": "string",
    "fire_alarm": "boolean",
    "sprinkler_system": "boolean",
    "sprinkler_coverage": "string"
  },
  "ada": {
    "accessible_entrance": "boolean",
    "accessible_restroom": "boolean",
    "elevator": "boolean | null",
    "ramp": "boolean",
    "notes": "string"
  },
  "hazmat": {
    "asbestos_risk": "none | low | medium | high | unknown",
    "lead_paint_risk": "none | low | medium | high | unknown",
    "mold_observed": "boolean",
    "notes": "string"
  },
  "egress": {
    "exit_count": "integer",
    "exit_separation_adequate": "boolean | null",
    "corridor_width_adequate": "boolean | null",
    "dead_end_corridors": "boolean | null",
    "notes": "string"
  },
  "restrooms": {
    "count": "integer",
    "ada_compliant_count": "integer",
    "condition": "string"
  },
  "kitchen": {
    "exists": "boolean",
    "type": "full | kitchenette | none",
    "condition": "string"
  },
  "vendor_notes": "string"
}
```

---

## isp_extract (WU-08: ISP Extraction)

The ISP is a "Program Fit Analysis" PDF — much richer than a basic floor plan. Full schema is in `skills/isp-extraction/references/isp-extraction-schema.json`. Key fields consumed by this agent:

```json
{
  "extracted_at": "ISO timestamp",
  "source_doc_url": "string — Drive URL of the ISP PDF",
  "address": "string",

  "building_code_info": {
    "building_code": "string — e.g., 'IBC 2018'",
    "occupancy_classification": "string — e.g., 'Group E (Educational)'",
    "jurisdiction": "string",
    "amendments": "string | null",
    "sprinkler_system": "boolean",
    "total_occupant_load": "integer",
    "gross_floor_area_sf": "integer"
  },

  "executive_summary": {
    "program_fit_score": "integer 0-100",
    "program_fit_rating": "GOOD FIT | MARGINAL FIT | POOR FIT",
    "requirements_met": "string — e.g., '9/9'",
    "requirements_score": "string | null — e.g., '60/60'",
    "quality_score": "string | null — e.g., '38/40'",
    "total_rooms": "integer",
    "rooms_assigned": "integer",
    "rooms_unassigned": "integer",
    "target_capacity": "integer | null",
    "recommended_capacity": "integer",
    "avg_fit_score_pct": "number — e.g., 89.3",
    "best_tier_met": "string — e.g., 'ideal'"
  },

  "capacity_analysis": {
    "grade_span": "string",
    "guides_required": "integer",
    "recommended_capacity": "integer",
    "gross_ceiling_capacity": "integer | null",
    "nla_capacity": "integer | null",
    "effective_sf_per_student": "integer | null",
    "sharing_penalty": "string",
    "space_requirements": {
      "workshop": "Met | Not Met",
      "one_on_one_meeting": "Met | Not Met",
      "play_area": "Met | Not Met",
      "dining_commons": "Met | Not Met"
    }
  },

  "classroom_assignments": [
    { "room_id": "string", "level": "string", "students": "integer", "area_sf": "integer" }
  ],
  "level_totals": [
    { "level": "string", "room_count": "integer", "total_students": "integer" }
  ],

  "tier_evaluation": [
    { "tier": "string", "meets": "boolean", "required_met": "string", "assignment_pct": "number", "fit_pct": "number", "missing": "string | null" }
  ],

  "ada_precheck": {
    "score": "integer 0-100",
    "errors": "integer",
    "warnings": "integer",
    "violations_by_rule": [ { "rule": "string", "count": "integer", "severity_breakdown": "string" } ],
    "violations": [
      { "severity": "ERROR | WARNING", "location": "string", "rule": "string", "actual": "string | null", "required": "string | null", "description": "string" }
    ]
  },

  "ibc_compliance": {
    "score": "integer 0-100",
    "errors": "integer",
    "warnings": "integer",
    "total_occupant_load": "integer",
    "occupant_load_by_room": [
      { "room_id": "string", "type": "string", "area_sf": "integer", "factor": "integer", "method": "net | gross", "load": "integer" }
    ],
    "plumbing_fixtures": {
      "water_closets_male": { "required": "integer", "notes": "string" },
      "water_closets_female": { "required": "integer", "notes": "string" },
      "lavatories": { "required": "integer", "notes": "string" },
      "drinking_fountains": { "required": "integer", "notes": "string" }
    },
    "plumbing_summary": "string | null",
    "violations": [
      { "severity": "ERROR | WARNING | INFO", "rule": "string", "description": "string" }
    ]
  },

  "adjacency_compliance": {
    "score": "integer 0-100",
    "critical_count": "integer",
    "high_count": "integer",
    "medium_count": "integer",
    "violations": [
      { "priority": "Critical | High | Medium", "rule_number": "integer", "room_types": "string", "relationship": "string", "detail": "string" }
    ]
  },

  "requirement_status": [
    { "room_type": "string", "required": "string", "assigned": "integer", "status": "Met | Not Met" }
  ],

  "optimization_proposals": [
    { "number": "integer", "action": "string", "rooms": "string", "result_type": "string | null", "result_sf": "integer | null", "reason": "string", "priority": "string", "fit_delta": "number" }
  ],

  "room_schedule": [
    { "room_id": "string", "floor": "string", "assignment": "string", "area_sf": "integer", "dimensions": "string | null", "occupant_load": "integer | null", "fit_score_pct": "integer | null" }
  ],

  "door_schedule": [
    { "door_id": "string", "floor": "string", "width_in": "number", "height_in": "number", "notes": "string | null" }
  ]
}
```

**DD Report token mapping for ISP data:**

| Token | ISP Source Field |
|---|---|
| Recommended capacity | `executive_summary.recommended_capacity` |
| Program fit score | `executive_summary.program_fit_score` |
| Grade span | `capacity_analysis.grade_span` |
| Classroom count | Count of `room_schedule` entries where `assignment` = "CLASSROOM" |
| Total SF | `building_code_info.gross_floor_area_sf` |
| SF per student | `capacity_analysis.effective_sf_per_student` |
| Plumbing gap | `ibc_compliance.plumbing_summary` |
| ADA issues count | `ada_precheck.errors` + `ada_precheck.warnings` |
| Adjacency score | `adjacency_compliance.score` |

---

## sir_delta / inspection_delta (WU-09: Delta Computation)

```json
{
  "computed_at": "ISO timestamp",
  "matches": ["field_name_1", "field_name_2"],
  "conflicts": [
    {
      "field": "string — field name",
      "ai_value": "string",
      "vendor_value": "string",
      "severity": "high | medium | low"
    }
  ],
  "vendor_only": ["field_name"],
  "ai_only": ["field_name"],
  "agreement_rate": "float 0-1"
}
```

---

## cost_estimates (WU-10: RayCon Cost Estimates)

```json
{
  "computed_at": "ISO timestamp",
  "inspection_source": "vendor | ai",
  "scenarios": [
    {
      "name": "string — e.g., 'Light renovation', 'Full buildout'",
      "total": "integer — dollars",
      "line_items": [
        { "item": "string — e.g., 'demolition'", "cost": "integer" }
      ]
    }
  ]
}
```

---

## permit_history (WU-11: Shovels Permit History)

```json
{
  "queried_at": "ISO timestamp",
  "address": "string",
  "permits": [
    {
      "permit_number": "string",
      "type": "string",
      "status": "string",
      "issued_date": "string",
      "description": "string"
    }
  ],
  "total_permits": "integer"
}
```

---

## opening_plan (WU-12: Opening Plan Generation)

```json
{
  "generated_at": "ISO timestamp",
  "recommendation": "Go | No Go | Conditional Go",
  "scenarios": {
    "best": { "target_date": "string", "total_cost": "integer", "weeks": "integer" },
    "realistic": { "target_date": "string", "total_cost": "integer", "weeks": "integer" },
    "worst": { "target_date": "string", "total_cost": "integer", "weeks": "integer" }
  },
  "gating_factors": [
    {
      "gate_id": "string",
      "name": "string",
      "resolved_when": "string",
      "good_outcome": "string",
      "bad_outcome": "string"
    }
  ],
  "risks": [
    {
      "track": "string — permit track name",
      "risk": "string",
      "trigger": "string",
      "impact": "string",
      "mitigations": ["string"]
    }
  ],
  "report_url": "string — Drive URL",
  "data_sources_used": {
    "sir_source": "vendor | ai",
    "inspection_source": "vendor | ai"
  }
}
```

---

## source_doc_urls (Assembled by Pipeline Orchestrator)

```json
{
  "sir": "string | null — Drive URL of best available SIR document",
  "inspection": "string | null — Drive URL of best available inspection document",
  "isp": "string | null — Drive URL of the ISP document",
  "school_approval": "string | null — Drive URL of the school approval report",
  "opening_plan": "string | null — Drive URL of the opening plan document"
}
```
