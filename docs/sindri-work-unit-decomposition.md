# DD Pipeline — Sindri Work Unit Decomposition

## Bottom Line

The DD pipeline breaks into 14 work units. 5 are agent skills (Claude reads documents, reasons about data, writes structured output). 9 are scripts (deterministic Convex functions — no LLM needed). The split follows one rule: if the step requires reading unstructured text or making a judgment call, it's an agent. If it's moving data, calling an API with known inputs, or computing a diff, it's a script.

### Data model

- **Sindri** is the pipeline data layer. Each work unit produces data that downstream work units can read directly.
- **RHODES** is the business data layer. Data goes to RHODES only when we want it stored long-term or available to other parts of the business.
- Not every work unit writes to RHODES. Some only pass data forward through Sindri.

---

## Summary Table

| # | Work Unit | Type | Trigger | Sindri Data Out | RHODES Write? |
|---|---|---|---|---|---|
| 01 | New Site Intake | Script | New Site email | `site_meta` | Yes — site record |
| 02 | AI SIR Generation | Agent | WU-01 done | `sir_ai` | Yes — long-term SIR record |
| 03 | School Approval | Agent | WU-01 done | `school_approval` | Yes — regulatory record |
| 04 | Vendor Packet Dispatch | Script | WU-02 done | `vendor_packets_sent` | No — transient status |
| 05 | Location Presentation | Script | WU-01 done | `presentation_url` | No — artefact only |
| 06 | Vendor SIR Extraction | Agent | CDS email arrives | `sir_vendor` | Yes — vendor data |
| 07 | Vendor BI Extraction | Agent | Worksmith email arrives | `inspection_vendor` | Yes — vendor data |
| 08 | ISP Extraction | Agent | ISP doc uploaded | `isp_extract` | Yes — capacity data |
| 09 | Delta Computation | Script | WU-06 or WU-07 done | `sir_delta`, `inspection_delta` | Optional — QA metric |
| 10 | RayCon Cost Estimates | Script | ISP + inspection ready | `cost_estimates` | Yes — cost data |
| 11 | Shovels Permit History | Script | WU-01 done | `permit_history` | Yes — permit data |
| 12 | Opening Plan | Agent | SIR + inspection + costs ready | `opening_plan` | Yes — decision doc |
| 13 | DD Report Assembly | Agent | Minimum data threshold met | `dd_report` | Yes — report record |
| 14 | Report Distribution | Script | WU-13 done | `distribution_log` | No — transient |

**Totals: 5 agents, 9 scripts**

---

## Dependency Graph

```
                        WU-01 (Intake) ─── Script
                       /    |    \     \
                      /     |     \     \
              WU-02    WU-03   WU-05   WU-11
              Agent    Agent   Script  Script
          (AI SIR)  (School) (Slides) (Shovels)
              |
          WU-04 (Vendor Dispatch) ─── Script
              |
     ┌────── ↓ ──────── Vendor returns arrive (async, days/weeks later)
     |                          |                    |
  WU-06                     WU-07                 WU-08
  Agent                     Agent                 Agent
  (Vendor SIR)          (Vendor BI)              (ISP)
     |                      |
  WU-09 (Delta) ─── Script (fires when AI + vendor pair exists)
     |
     └──── Readiness checks ────┐
                                |
                    WU-10 (RayCon) ─── Script
                                |
                    WU-12 (Opening Plan) ─── Agent
                                |
                    WU-13 (DD Report) ─── Agent
                                |
                    WU-14 (Distribution) ─── Script
```

---

## Scripts (9 total)

---

### SCRIPT-01: New Site Intake

**Purpose:** Parse a New Site email and stand up the site record so downstream work units have something to work from.

**Invoking Event:** New Site email received (LOI attachment detected by EmailAgentConnector)

**Subs to Monitor:** Email inbox

**Connectors:** Gmail, RHODES, Google Drive

**Sindri Data Out:**
```json
{
  "site_meta": {
    "site_id": "string — RHODES site ID",
    "address": "string",
    "city": "string",
    "state": "string",
    "school_type": "micro | 250 | 1000",
    "drive_folder_url": "string — Google Drive folder URL",
    "loi_doc_url": "string — uploaded LOI URL",
    "p1_name": "string | null",
    "p1_email": "string | null",
    "stage": "M1",
    "created_at": "ISO timestamp"
  }
}
```

**RHODES Write:** Yes — create the site record (address, school type, stage M1, Drive folder URL). This is the business-facing site record that other teams see.

**Logic (pseudocode):**
```
1. Parse email: extract sender, subject, body, attachments
2. Extract address from email body or LOI attachment (regex + validation)
3. Extract school type from email body (default: micro)
4. Call RHODES: create_site(address, school_type, stage="M1")
5. Call Google Drive: create folder structure
   └── {Site Name}/
       ├── M1 - Acquire Property/
       ├── M2 - Permits/
       ├── M3 - Build Out/
       ├── M4 - Staffing/
       ├── M5 - Enrollment/
       └── M6 - Operations/
6. Upload LOI to M1 folder
7. Call RHODES: update site with drive_folder_url
8. Write site_meta to Sindri for downstream WUs
9. Signal completion
```

**Error handling:**
- Address extraction fails → flag for human review, do not create site
- RHODES create fails → retry once, then alert
- Drive folder creation fails → retry once, then alert

---

### SCRIPT-04: Vendor Packet Dispatch

**Purpose:** Package the AI SIR output into vendor-ready packets and email them to CDS (for SIR verification) and Worksmith (for building inspection).

**Invoking Event:** `UpstreamCompleted` from WU-02 (AI SIR complete)

**Subs to Monitor:** WU-02 completion — `sir_ai` exists in Sindri

**Connectors:** Gmail (SES), Google Drive

**Sindri Data In:** `site_meta` (from WU-01), `sir_ai` (from WU-02)

**Sindri Data Out:**
```json
{
  "vendor_packets_sent": {
    "cds_email_sent_at": "ISO timestamp",
    "cds_recipient": "string",
    "cds_packet_url": "string — Drive URL of the vendor packet",
    "worksmith_email_sent_at": "ISO timestamp",
    "worksmith_recipient": "string",
    "worksmith_packet_url": "string — Drive URL of the inspection brief"
  }
}
```

**RHODES Write:** No. This is transient pipeline status — no business value in storing it long-term.

**Logic (pseudocode):**
```
1. Read sir_ai from Sindri (structured extraction from WU-02)
2. Read site_meta from Sindri (address, drive folder URL)
3. Generate CDS vendor packet:
   a. Apply ease-of-conversion Mode 2 transformation rules:
      - Confidence A items → keep as-is
      - Confidence B/C items → rewrite as "AI found: [value] — please verify"
      - Add empty Source column for vendor to fill
      - Confidence D items → pass through as vendor task cards
   b. Prepend cover note with instructions
   c. Save to Drive → M2 folder
4. Generate Worksmith inspection brief:
   a. Site address, school type, building facts from sir_ai
   b. Pre-filled checklist from sir_ai Phase 7 unknowns
   c. Save to Drive → M2 folder
5. Send CDS email with packet attached
6. Send Worksmith email with brief attached
7. Write vendor_packets_sent to Sindri
8. Signal completion
```

**Error handling:**
- Email send fails → retry with exponential backoff (max 3 attempts)
- Drive upload fails → retry once, then alert

---

### SCRIPT-05: Location Presentation

**Purpose:** Generate a Google Slides location presentation with enrollment scores, wealth data, and map imagery.

**Invoking Event:** `UpstreamCompleted` from WU-01

**Subs to Monitor:** WU-01 completion — `site_meta` exists in Sindri

**Connectors:** Google Slides, Google Drive, enrollment/wealth data APIs, mapping APIs

**Sindri Data In:** `site_meta` (from WU-01)

**Sindri Data Out:**
```json
{
  "presentation_url": "string — Google Slides URL"
}
```

**RHODES Write:** No. The presentation is an artefact in Drive, not structured business data.

**Logic (pseudocode):**
```
1. Read site_meta from Sindri (address, school type)
2. Call enrollment data API for the address area
3. Call wealth/demographics API for the address area
4. Generate map imagery (satellite, street view, area context)
5. Create Google Slides presentation from template:
   - Title slide: site name, address
   - Enrollment data slides
   - Wealth/demographics slides
   - Map slides
6. Save to Drive → M1 folder
7. Write presentation_url to Sindri
8. Signal completion
```

---

### SCRIPT-09: Delta Computation

**Purpose:** Compare AI extraction vs. vendor extraction field-by-field, producing a structured diff. Used for accuracy benchmarking and conflict detection.

**Invoking Event:** `UpstreamCompleted` from WU-06 (vendor SIR) or WU-07 (vendor BI), when the corresponding AI version already exists in Sindri

**Subs to Monitor:** Sindri — watch for `sir_vendor` when `sir_ai` exists, or `inspection_vendor` when `inspection_ai` exists

**Connectors:** None — pure computation on Sindri data

**Sindri Data In:** `sir_ai` + `sir_vendor`, or `inspection_ai` + `inspection_vendor`

**Sindri Data Out:**
```json
{
  "sir_delta": {
    "computed_at": "ISO timestamp",
    "matches": ["field_name_1", "field_name_2"],
    "conflicts": [
      {
        "field": "zoning_status",
        "ai_value": "Permitted by right",
        "vendor_value": "Use Permit Required (Admin)",
        "severity": "high"
      }
    ],
    "vendor_only": ["field_name"],
    "ai_only": ["field_name"],
    "agreement_rate": 0.82
  }
}
```

**RHODES Write:** Optional. If we want to track AI accuracy over time for benchmarking, write the `agreement_rate` and conflict count. Otherwise keep in Sindri only.

**Logic (pseudocode):**
```
1. Read AI extraction and vendor extraction from Sindri
2. Both use the same schema — iterate field-by-field:
   a. Both present + same value → "match"
   b. Both present + different value → "conflict"
      - Classify severity from lookup table:
        - high: zoning status, occupancy type, sprinkler requirement, permit type
        - medium: timeline estimates, fee amounts, code edition
        - low: contact info, formatting differences
   c. Vendor has field, AI doesn't → "vendor_only"
   d. AI has field, vendor doesn't → "ai_only"
3. Compute agreement_rate = matches / (matches + conflicts)
4. Write delta to Sindri
5. Signal completion
```

**Severity lookup table:**

| Fields | Severity |
|---|---|
| zoning_status, occupancy_classification, sprinkler_required, permit_type, use_permission | high |
| timeline_best, timeline_worst, fee_amounts, code_edition, fire_code_edition | medium |
| contact_name, contact_phone, formatting, minor_notes | low |

---

### SCRIPT-10: RayCon Cost Estimates

**Purpose:** Call the RayCon API with structured room and inspection data to get cost estimates per build scenario.

**Invoking Event:** Readiness check — `isp_extract` exists in Sindri AND (`inspection_vendor` OR `inspection_ai`) exists

**Subs to Monitor:** Sindri — compound watch on `isp_extract` + best available inspection data

**Connectors:** RayCon API

**Sindri Data In:** `isp_extract` (from WU-08), best available inspection (`inspection_vendor` preferred, `inspection_ai` fallback), `site_meta` (from WU-01)

**Sindri Data Out:**
```json
{
  "cost_estimates": {
    "computed_at": "ISO timestamp",
    "inspection_source": "vendor | ai",
    "scenarios": [
      {
        "name": "Light renovation",
        "total": 125000,
        "line_items": [
          { "item": "Restroom renovation", "cost": 45000 },
          { "item": "Fire alarm upgrade", "cost": 15000 }
        ]
      }
    ]
  }
}
```

**RHODES Write:** Yes — cost estimates are decision-critical and used by other teams (finance, construction).

**Logic (pseudocode):**
```
1. Read isp_extract from Sindri → room inventory, capacity data
2. Read best available inspection data:
   a. If inspection_vendor exists → use it (vendor > AI)
   b. Else use inspection_ai
   c. Record which source was used
3. Read site_meta from Sindri → address, school type
4. Build RayCon API request:
   - Room list from ISP
   - Structural findings from inspection
   - MEP findings from inspection
   - ADA findings from inspection
   - School type for scope calibration
5. Call RayCon API
6. Parse response into scenario-based estimates
7. Write cost_estimates to Sindri
8. Write cost_estimates to RHODES (for finance/construction teams)
9. Signal completion
```

**Error handling:**
- RayCon API unavailable → retry with backoff (max 3), then mark as pending and alert
- Inspection data incomplete → call with available data, flag gaps in output

---

### SCRIPT-11: Shovels Permit History

**Purpose:** Pull permit history for the site address from the Shovels API.

**Invoking Event:** `UpstreamCompleted` from WU-01 (address available)

**Subs to Monitor:** WU-01 completion — `site_meta` with address exists in Sindri

**Connectors:** Shovels API

**Sindri Data In:** `site_meta` (from WU-01)

**Sindri Data Out:**
```json
{
  "permit_history": {
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
}
```

**RHODES Write:** Yes — permit history is useful for construction planning teams.

**Logic (pseudocode):**
```
1. Read site_meta from Sindri → address
2. Call Shovels API: get_permits(address)
3. Parse response into structured permit list
4. Write permit_history to Sindri
5. Write permit_history to RHODES
6. Signal completion
```

**Error handling:**
- Shovels API unavailable → retry with backoff, then mark as pending
- No permits found → write empty permit list (valid result, not an error)

---

### SCRIPT-14: Report Distribution

**Purpose:** Email the completed DD Report to stakeholders and post notifications.

**Invoking Event:** `UpstreamCompleted` from WU-13 (DD report created)

**Subs to Monitor:** WU-13 completion — `dd_report` with `doc_url` exists in Sindri

**Connectors:** Gmail, Google Chat

**Sindri Data In:** `dd_report` (from WU-13), `site_meta` (from WU-01)

**Sindri Data Out:**
```json
{
  "distribution_log": {
    "email_sent_at": "ISO timestamp",
    "recipients": ["email1@trilogy.com", "email2@trilogy.com"],
    "chat_notified_at": "ISO timestamp",
    "chat_space": "string"
  }
}
```

**RHODES Write:** No. Distribution is transient — the report itself is already in RHODES via WU-13.

**Logic (pseudocode):**
```
1. Read dd_report from Sindri → doc_url, doc_id, version
2. Read site_meta from Sindri → site name, address, p1_name, p1_email
3. Compose email:
   - To: P1 + stakeholder list
   - Subject: "DD Report: {site_name} — {address}"
   - Body: report link, key summary (score, recommendation)
4. Send email via Gmail
5. Post Google Chat notification to the DD channel:
   - Site name, score, recommendation, report link
6. Write distribution_log to Sindri
7. Signal completion
```

---

## Agent Skills (5 total)

Each agent runs as a Claude Managed Agent with a SKILL.md and supporting files.

---

### AGENT-02: AI SIR Generation

**Purpose:** Run a comprehensive AI-first Site Investigation Report covering zoning, permitting, code analysis, and school conversion feasibility for a given address.

**Invoking Event:** `UpstreamCompleted` from WU-01

**Subs to Monitor:** WU-01 completion — `site_meta` exists in Sindri

**Connectors:** Web search, Google Drive, RHODES

**Skill:** `ease-of-conversion/SKILL.md` (Mode 1 — SIR Generation)
- Existing skill in Ops-Skills repo
- 9 research phases, 17 hard rules, 9-section output contract
- Produces E-Occupancy score in Phase 7 — no separate E-Occupancy work unit needed

**Sindri Data In:** `site_meta` (address, school type)

**Sindri Data Out:**
```json
{
  "sir_ai": {
    "address": "string",
    "score": "integer 0-100",
    "rating": "GREEN | YELLOW | ORANGE | RED",
    "recommendation": "PROCEED | PROCEED WITH CAUTION | REQUIRES JUSTIFICATION | PASS",
    "e_occupancy_score": "integer 0-100",
    "e_occupancy_rating": "string",
    "zoning_status": "string",
    "permit_type": "string",
    "timeline_best_weeks": "integer",
    "timeline_worst_weeks": "integer",
    "cost_range_low": "integer",
    "cost_range_high": "integer",
    "authority_chain": [
      { "authority": "string", "name": "string", "role": "string", "contact": "string" }
    ],
    "code_framework": {
      "building_code": "string",
      "fire_code": "string",
      "health_code": "string"
    },
    "feasibility": {
      "occupancy_compatibility": "string",
      "sprinkler_trigger": "boolean",
      "bathroom_requirement": "string",
      "construction_scope": ["item1", "item2"]
    },
    "unknowns": [
      { "item": "string", "why_it_matters": "string", "field_only": "boolean" }
    ],
    "report_url": "string — Drive URL of the full SIR markdown/PDF",
    "confidence_labels": { "field_name": "A|B|C|D" }
  }
}
```

**RHODES Write:** Yes — the SIR structured extraction is long-term valuable and used by construction, finance, and leadership.

**Supporting Files:**
- `SKILL.md` — full skill definition (exists)
- `references/sir-report.md` — report template and flag page format
- `references/site-eval-brainlift.md` — scoring rubric, construction scope inference table
- `references/corrections-schema.md` — benchmark corrections format

---

### AGENT-03: School Approval Analysis

**Purpose:** Score how hard it is to legally operate a private K-8 school at a given address, based on state regulatory requirements.

**Invoking Event:** `UpstreamCompleted` from WU-01

**Subs to Monitor:** WU-01 completion — `site_meta` with address + state exists in Sindri

**Connectors:** Web search, RHODES

**Skill:** `school-approval/SKILL.md`
- Existing skill in Ops-Skills repo
- 5 state archetypes (MINIMAL → WINDOWED)
- 50-state baseline score table
- JSON + human-readable output

**Sindri Data In:** `site_meta` (address, state)

**Sindri Data Out:**
```json
{
  "school_approval": {
    "state": "string",
    "archetype": "MINIMAL | NOTIFICATION | APPROVAL_REQUIRED | HEAVILY_REGULATED | WINDOWED",
    "zone": "green | yellow | red",
    "score_0_100": "integer",
    "ease_score_0_10": "float",
    "approval_type": "NONE | REGISTRATION_SIMPLE | LOCAL_APPROVAL_REQUIRED | LICENSE_REQUIRED | CERTIFICATE_OR_APPROVAL_REQUIRED | COMPLEX_OR_OVERSIGHT",
    "gating_before_open": "boolean",
    "timeline_days_preopen": { "min": "integer", "likely": "integer", "max": "integer" },
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
}
```

**RHODES Write:** Yes — regulatory classification is used by legal and operations teams.

**Supporting Files:**
- `SKILL.md` — full skill definition (exists)
- `references/report-template.md` — human-readable report format

---

### AGENT-06: Vendor SIR Extraction

**Purpose:** Read a CDS vendor SIR PDF and extract structured data using the same schema as the AI SIR, enabling field-by-field comparison.

**Invoking Event:** Email received classified as "CDS SIR Return"

**Subs to Monitor:** Email inbox — classify as CDS vendor return (look for CDS sender, SIR attachment keywords)

**Connectors:** Gmail, Google Drive

**Skill:** `vendor-sir-extraction/SKILL.md` (NEW — needs to be built)

**Sindri Data In:** `site_meta` (for site matching — address, drive folder)

**Sindri Data Out:**
```json
{
  "sir_vendor": {
    "extracted_at": "ISO timestamp",
    "source_doc_url": "string — Drive URL of the vendor PDF",
    "address": "string",
    "zoning_status": "string",
    "permit_type": "string",
    "timeline_best_weeks": "integer",
    "timeline_worst_weeks": "integer",
    "authority_chain": [
      { "authority": "string", "name": "string", "role": "string", "contact": "string" }
    ],
    "code_framework": {
      "building_code": "string",
      "fire_code": "string",
      "health_code": "string"
    },
    "feasibility": {
      "occupancy_compatibility": "string",
      "sprinkler_trigger": "boolean",
      "bathroom_requirement": "string",
      "construction_scope": ["item1", "item2"]
    },
    "vendor_notes": "string — free-text notes from the vendor not captured in schema fields"
  }
}
```

**RHODES Write:** Yes — vendor SIR data is the ground-truth record.

**SKILL.md outline (to build):**
```
# Vendor SIR Extraction

## Purpose
Extract structured data from a CDS vendor SIR PDF into the standard
SIR schema, enabling direct comparison with the AI SIR extraction.

## Input
- PDF file (from email attachment or Drive upload)
- Extraction schema (same fields as sir_ai — shared schema definition)

## Process
1. Read the PDF
2. Identify sections: zoning, authority chain, code framework, permit path,
   feasibility, environmental, infrastructure
3. For each schema field, extract the vendor's finding
4. Map vendor terminology to standard field values where possible
5. Capture vendor-specific notes that don't map to schema fields

## Output
- Structured JSON matching the sir_ai schema
- vendor_notes field for unstructured vendor observations

## Hard Rules
1. Use the SAME schema as sir_ai — field names must match exactly
2. Do not infer or fill fields the vendor did not address — leave null
3. Preserve vendor's exact language in vendor_notes
4. Map vendor terminology to standard values:
   - "By right" / "Permitted" / "As of right" → "Permitted by right"
   - "CUP" / "Conditional" / "Special Use" → "Conditional Use Permit"
   - etc. (full mapping table in references/)
```

**Supporting Files (to build):**
- `SKILL.md` — extraction instructions and schema
- `references/shared-sir-schema.json` — the schema shared between AI and vendor extractions
- `references/vendor-terminology-map.md` — maps vendor language to standard field values

---

### AGENT-07: Vendor Building Inspection Extraction

**Purpose:** Read a Worksmith Building Inspection PDF and extract structured data into the standard inspection schema.

**Invoking Event:** Email received classified as "Worksmith Building Inspection Return"

**Subs to Monitor:** Email inbox — classify as Worksmith return

**Connectors:** Gmail, Google Drive

**Skill:** `vendor-bi-extraction/SKILL.md` (NEW — needs to be built)

**Sindri Data In:** `site_meta` (for site matching)

**Sindri Data Out:**
```json
{
  "inspection_vendor": {
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
}
```

**RHODES Write:** Yes — inspection data is the structural ground truth for the site.

**SKILL.md outline (to build):**
```
# Vendor Building Inspection Extraction

## Purpose
Extract structured data from a Worksmith Building Inspection PDF into
the standard inspection schema.

## Input
- PDF file (from email attachment or Drive upload)
- Extraction schema (shared inspection schema definition)

## Process
1. Read the PDF
2. Identify sections: structural, MEP, ADA, hazmat, egress, restrooms, kitchen
3. For each schema field, extract the inspector's finding
4. Classify condition assessments using standard scale
5. Capture inspector notes that don't map to schema fields

## Output
- Structured JSON matching the inspection schema
- vendor_notes field for unstructured observations

## Hard Rules
1. Never infer construction type — only extract if explicitly stated
2. Never upgrade condition assessments — use the inspector's language
3. Leave fields null if the inspector did not address them
4. Flag any safety concerns (hazmat, egress deficiency) prominently
```

**Supporting Files (to build):**
- `SKILL.md` — extraction instructions and schema
- `references/shared-inspection-schema.json` — the standard inspection schema
- `references/condition-scale.md` — standard condition assessment scale

---

### AGENT-08: ISP Extraction

**Purpose:** Read an ISP (Interior Space Plan) document and extract room inventory, capacity tiers, and ADA compliance data.

**Invoking Event:** ISP document uploaded to Drive (or received via email)

**Subs to Monitor:** Drive folder watch (M1 folder) or email inbox classification

**Connectors:** Google Drive

**Skill:** `isp-extraction/SKILL.md` (NEW — needs to be built)

**Sindri Data In:** `site_meta` (for site matching)

**Sindri Data Out:**
```json
{
  "isp_extract": {
    "extracted_at": "ISO timestamp",
    "source_doc_url": "string — Drive URL",
    "address": "string",
    "total_sf": "integer",
    "usable_sf": "integer",
    "rooms": [
      {
        "name": "string",
        "type": "classroom | office | restroom | common | kitchen | storage | other",
        "sf": "integer",
        "capacity": "integer | null",
        "ada_compliant": "boolean | null",
        "notes": "string"
      }
    ],
    "capacity_tiers": {
      "micro": { "rooms_used": "integer", "max_students": "integer" },
      "250": { "rooms_used": "integer", "max_students": "integer" },
      "1000": { "rooms_used": "integer", "max_students": "integer" }
    },
    "ada_summary": {
      "accessible_entrance": "boolean | null",
      "accessible_restrooms": "integer",
      "accessible_classrooms": "integer",
      "notes": "string"
    },
    "special_use_areas": ["string — e.g., gym, cafeteria, library"]
  }
}
```

**RHODES Write:** Yes — capacity data is used by enrollment, operations, and finance teams.

**SKILL.md outline (to build):**
```
# ISP Extraction

## Purpose
Extract room inventory, capacity data, and ADA compliance from an
Interior Space Plan document.

## Input
- ISP document (PDF, typically a floor plan with room labels and SF)

## Process
1. Read the document
2. Identify each room: name, type, square footage
3. Calculate capacity per room using standard SF/student ratios
4. Compute capacity tiers (micro, 250, 1000 school models)
5. Assess ADA compliance indicators
6. Identify special-use areas

## Output
- Structured JSON with room inventory and capacity tiers

## Hard Rules
1. Never fabricate room dimensions — extract only what's stated
2. Use standard capacity ratios:
   - Classroom: 1 student per 20 SF (net usable)
   - Common area: varies by use
3. Flag rooms where SF is not stated — do not estimate
4. Capacity tiers must reflect realistic room allocation, not just SF math
```

**Supporting Files (to build):**
- `SKILL.md` — extraction instructions and schema
- `references/capacity-ratios.md` — standard SF-per-student ratios by room type
- `references/shared-isp-schema.json` — the ISP extraction schema

---

### AGENT-12: Opening Plan Generation

**Purpose:** Synthesize SIR, inspection, cost, permit, and school approval data into a scenario-based Opening Plan (Permitting Plan) with timelines, gating factors, and risk analysis.

**Invoking Event:** Readiness check — best available SIR + inspection + `cost_estimates` all exist in Sindri

**Subs to Monitor:** Sindri — compound watch on SIR + inspection + cost_estimates

**Connectors:** Google Drive

**Skill:** `sir-to-permitting-plan/SKILL.md`
- Existing skill in Ops-Skills repo
- 8-step conversion process, 12 hard rules
- Produces 3 scenarios (best/realistic/worst), gating factors, per-track risk analysis

**Sindri Data In:**
- Best available SIR: `sir_vendor` preferred, `sir_ai` fallback
- Best available inspection: `inspection_vendor` preferred, `inspection_ai` fallback
- `cost_estimates` (from WU-10)
- `permit_history` (from WU-11)
- `school_approval` (from WU-03)
- `sir_delta` or `inspection_delta` (from WU-09, if available — highlights conflicts)
- `site_meta` (from WU-01)

**Sindri Data Out:**
```json
{
  "opening_plan": {
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
        "track": "string",
        "risk": "string",
        "trigger": "string",
        "impact": "string",
        "mitigations": ["string"]
      }
    ],
    "report_url": "string — Drive URL of the full Opening Plan document",
    "data_sources_used": {
      "sir_source": "vendor | ai",
      "inspection_source": "vendor | ai"
    }
  }
}
```

**RHODES Write:** Yes — the Opening Plan is a decision document used by leadership and construction.

**Supporting Files:**
- `SKILL.md` — full skill definition (exists)
- `references/permitting-plan-template.md` — the output template

---

### AGENT-13: DD Report Assembly

**Purpose:** Read all structured work unit data from Sindri, apply vendor > AI precedence, map to the 40 V3 template tokens, and produce the final DD Report Google Doc.

**Invoking Event:** Readiness check — minimum data threshold met (SIR + inspection + ISP extractions exist in Sindri)

**Subs to Monitor:** Sindri — compound watch across `sir_ai` or `sir_vendor`, `inspection_ai` or `inspection_vendor`, `isp_extract`

**Connectors:** Google Docs (programmatic doc builder)

**Skill:** `dd-report-assembly/SKILL.md` (NEW — needs to be built, but most logic exists in the current DD reporter)

**Sindri Data In:** ALL upstream work unit data:
- `site_meta` (WU-01)
- `sir_ai` (WU-02) and/or `sir_vendor` (WU-06)
- `school_approval` (WU-03)
- `inspection_vendor` (WU-07) and/or `inspection_ai` (inferred from SIR)
- `isp_extract` (WU-08)
- `sir_delta`, `inspection_delta` (WU-09, if available)
- `cost_estimates` (WU-10)
- `permit_history` (WU-11)
- `opening_plan` (WU-12)

**Sindri Data Out:**
```json
{
  "dd_report": {
    "generated_at": "ISO timestamp",
    "doc_id": "string — Google Doc ID",
    "doc_url": "string — Google Doc URL",
    "version": "integer",
    "score": "integer 0-100",
    "recommendation": "string",
    "data_sources_used": {
      "sir_source": "vendor | ai | both",
      "inspection_source": "vendor | ai | both",
      "cost_source": "raycon",
      "permit_source": "shovels"
    },
    "tokens_populated": "integer — how many of 40 tokens were filled",
    "tokens_missing": ["token_name — list of unfilled tokens"]
  }
}
```

**RHODES Write:** Yes — report metadata (doc_id, url, version, score) is long-term business data.

**Precedence rules (enforced in skill):**
1. For every field: use `vendor` value if it exists, else use `ai` value
2. When `delta` exists and shows a high-severity conflict, flag it in the report narrative
3. Never re-read raw PDFs — all data comes from Sindri structured extractions
4. If a token can't be populated from any source, leave it marked as `[DATA NOT AVAILABLE]`

**SKILL.md outline (to build):**
```
# DD Report Assembly

## Purpose
Assemble the Due Diligence Report from structured Sindri work unit data.
The agent reads structured data only — no raw PDFs.

## Input
- All Sindri work unit data (listed above)
- V3 report template (40 tokens)

## Process
1. Read all available work unit data from Sindri
2. For each of the 40 template tokens:
   a. Identify the source work unit(s) for that token
   b. Apply vendor > AI precedence
   c. Map the structured data to the token value
3. Build the narrative sections:
   a. "Can We Answer" card — derived from data completeness
   b. Build scenarios — from cost_estimates
   c. Cost breakdown — from cost_estimates + fee data
   d. Risk notes — from sir_delta conflicts, opening_plan risks
   e. Acquisition conditions — from opening_plan gating factors
4. Call the programmatic Google Doc builder
5. Write report metadata to Sindri

## Hard Rules
1. Never read raw PDFs — only structured Sindri data
2. Vendor > AI for every field where both exist
3. Flag delta conflicts in the narrative
4. Every token must be populated or explicitly marked missing
5. Report must be self-contained — readable without referencing source docs
```

**Supporting Files (to build):**
- `SKILL.md` — assembly instructions
- `references/v3-token-map.md` — maps each of the 40 tokens to its source work unit(s) and field(s)
- `references/v3-template.md` — the V3 report template

---

## New Skills to Build

| Skill | Repo | Purpose | Estimated Effort |
|---|---|---|---|
| `vendor-sir-extraction` | Ops-Skills | Extract structured data from CDS vendor SIR PDFs | Medium — schema exists from ease-of-conversion, need extraction instructions + terminology map |
| `vendor-bi-extraction` | Ops-Skills | Extract structured data from Worksmith BI PDFs | Medium — need to define inspection schema + extraction instructions |
| `isp-extraction` | Ops-Skills | Extract room inventory + capacity from ISP docs | Medium — need schema + capacity ratio references |
| `dd-report-assembly` | DD Reporter (or monorepo) | Assemble DD report from structured Sindri data | Low — logic largely exists, needs restructuring to read from Sindri instead of raw docs |

All three extraction skills belong in the shared Ops-Skills repo since other teams may need the same extraction schemas. The DD report assembly skill is pipeline-specific and belongs in the monorepo.

---

## Shared Schemas

The dual-column design depends on AI and vendor extractions using identical schemas. These schemas live alongside the skills in Ops-Skills:

| Schema | Used By | Fields |
|---|---|---|
| `shared-sir-schema.json` | WU-02 (sir_ai), WU-06 (sir_vendor), WU-09 (sir_delta) | zoning, authority chain, code framework, permit path, feasibility, environmental, infrastructure |
| `shared-inspection-schema.json` | WU-07 (inspection_vendor), WU-09 (inspection_delta) | structural, MEP, ADA, hazmat, egress, restrooms, kitchen |
| `shared-isp-schema.json` | WU-08 (isp_extract) | rooms, capacity tiers, ADA summary, special use areas |

The AI SIR (WU-02) doesn't directly use `shared-sir-schema.json` today — its output is defined by the ease-of-conversion skill. A mapping layer in WU-02 or a schema update to the skill will be needed to ensure the output conforms to the shared schema for delta computation.
