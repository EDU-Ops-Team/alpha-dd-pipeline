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
| 04 | Vendor Dispatch (CDS + Worksmith) | Script | WU-02 done | `vendor_packets_sent` | No — transient status |
| 05 | Location Presentation | Script | WU-01 done | `presentation_url` | No — artefact only |
| 06 | Vendor SIR Extraction | Agent | CDS email arrives | `sir_vendor` | Yes — vendor data |
| 07 | Vendor BI Extraction | Agent | Worksmith email arrives | `inspection_vendor` | Yes — vendor data |
| 08 | ISP Extraction | Agent | ISP doc uploaded | `isp_extract` | Yes — capacity data |
| 09 | Delta Computation | Script | WU-06 or WU-07 done | `sir_delta`, `inspection_delta` | Optional — QA metric |
| 10 | RayCon Cost Estimates | Script | ISP + inspection ready | `cost_estimates` | Yes — cost data |
| 11 | Shovels Permit History | Script | WU-01 done | `permit_history` | Yes — permit data |
| 12 | Opening Plan v2 | Agent | SIR + school-approval + inspection + costs ready | `opening_plan` | Yes — decision doc |
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
              |         |
          WU-04 ───    |  WU-03 feeds WU-12 (school-approval → edu regulatory baseline)
          Script       |
              |        |
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
                    WU-12 (Opening Plan v2) ─── Agent
                      deps: WU-02, WU-03, WU-10, WU-06, WU-07
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

### SCRIPT-04: Vendor Dispatch

**Purpose:** Dispatch vendor packets to CDS (phone verification) and Worksmith (field inspection). CDS gets the full SIR with a verification overlay. Worksmith gets a single pre-filled inspection checklist — the template populated with everything AI research already found, plus site-specific tasks appended for issues the SIR flagged but couldn't resolve remotely.

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
    "cds_report_url": "string — Drive URL of the CDS verification report (full SIR + overlay)",
    "cds_bc_item_count": "integer — number of B/C items CDS needs to verify",
    "worksmith_email_sent_at": "ISO timestamp",
    "worksmith_recipient": "string",
    "worksmith_checklist_url": "string — Drive URL of the pre-filled inspection checklist",
    "worksmith_checklist_item_count": "integer — total checklist items (template + appended)",
    "worksmith_prefill_count": "integer — items pre-filled from AI research",
    "worksmith_appended_task_count": "integer — site-specific tasks added beyond template"
  }
}
```

**RHODES Write:** No. This is transient pipeline status — no business value in storing it long-term.

**Logic (pseudocode):**
```
1. Read sir_ai from Sindri (structured extraction from WU-02)
2. Read site_meta from Sindri (address, drive folder URL)
3. Read the full AI SIR markdown from Drive (report_url in sir_ai)

--- CDS Verification Report (unchanged) ---
4. Generate CDS Verification Report:
   a. Scan all tables for B/C confidence rows → build Verification Task Summary table
      - Group by authority (batch calls)
      - Pull contact info from the Authority Chain section
      - Number sequentially
   b. Add 3 columns to every B/C row in the report body:
      "CDS Verified Finding" | "CDS Source" | "CDS Confidence" (all empty)
   c. Embed claim-id HTML comments after each B/C row
   d. Prepend cover sheet + instructions + Verification Task Summary
   e. A-confidence rows and D-confidence task cards: unchanged
   f. Save to Drive → M2 folder as {address}_cds-verification.md

--- Worksmith Pre-Filled Inspection Checklist ---
5. Generate Worksmith checklist — ONE document, the checklist IS the deliverable:
   a. Start from the standard 11-section template structure
      (Exterior/Site, Parking/Drop-off, Entry/Egress, Fire Alarm,
      Sprinkler, Emergency Systems, Restrooms/Plumbing, ADA,
      Structural, HVAC/Mechanical, Electrical)
   b. Build the header block:
      - Property Address, Inspection Date (blank), Inspector Name/Firm,
        Inspector Contact, Target Occupancy (E — Private K-8),
        Planned Student Count, Planned Staff Count,
        Building Sq. Footage, Current Occupancy Type
      (all from sir_ai site facts and Phase 7 — pre-fill what we know)
   c. Prepend the Deal-Killer Questions section (answer FIRST):
      - 5 binary questions:
        1. Is there a safe parent drop-off/pick-up area?
        2. Are there at least 2 exits with adequate separation?
        3. Can all exit doors open outward with panic hardware?
        4. Is the building free from obvious structural deficiency?
        5. Is the building free from visible mold, water damage, or active leaks?
      - Each: ☐ Yes  ☐ No  ☐ Needs Further Evaluation
      - If ANY answer is No → call Alpha contact immediately. Stop inspection.
   d. Pre-fill checklist tables from SIR findings:
      For each of the 11 sections, every template line item becomes a table row:
      | Item | AI Pre-Fill | Confirmed ☐ | Finding | Source/Citation | Notes |
      - If the SIR has a finding for this item (any confidence level A/B/C):
        populate "AI Pre-Fill" with the value + confidence tag
        embed a claim-id HTML comment: <!-- claim-id: BI-001 -->
      - If the SIR has no finding (D-confidence or not addressed):
        "AI Pre-Fill" = blank. This is a pure field task.
      - After each section table, include the template's contextual NOTE
        if applicable (fire alarm cost/timeline, 59-student bathroom threshold,
        E-occupancy ventilation rates, etc.)
   e. APPEND site-specific tasks after the 11 standard sections:
      Scan the SIR for D-confidence items and vendor task cards that do NOT
      map to any template line item. These are site-specific risks the AI
      identified but couldn't resolve remotely. Add them as:

      ## Site-Specific Tasks
      These items were flagged by AI research as needing field verification
      for this specific property. They go beyond the standard checklist.

      | # | Task | Why It Matters | What to Document |
      (numbered, with plain-English explanation of why each matters)

   f. Append Occupant Load Verification:
      - Formula 1: Total Occupant Load (Net Floor Area ÷ 100)
      - Formula 2: Student Capacity (Net Learning Area ÷ 40)
      - Pre-fill with SIR values where available
   g. Append Cost Estimate table:
      - Item | Description | Priority | Low Est. | High Est. | Notes
      - Pre-populate category rows: Fire Alarm, Egress, ADA, Plumbing,
        HVAC, Electrical, Structural, Other — values blank for inspector
   h. Append Overall Assessment:
      - ☐ PROCEED — No critical issues
      - ☐ PROCEED WITH CAUTION — Issues with remediation path
      - ☐ REQUIRES JUSTIFICATION — Significant cost/timeline impact
      - ☐ PASS — Critical issues, not recommended
      - Inspector signature, date, next inspection date
   i. Prepend cover instructions:
      ---
      **How to use this checklist**

      This checklist is pre-filled with findings from AI research. Your job:
      1. Answer the Deal-Killer Questions FIRST — if any is No, call us
      2. Work through each section — the "AI Pre-Fill" column shows what
         we found remotely. Confirm it or write the correct finding.
      3. Fill in Source/Citation for every item you verified
      4. Complete the Site-Specific Tasks at the end — these are items
         AI flagged as risks for THIS property specifically
      5. Fill out the Cost Estimate table for every deficiency
      6. Select your overall recommendation

      Do not leave Source/Citation blank on any item you verified.
      ---
   j. Save to Drive → M2 folder as {address}_worksmith-checklist.md

6. Send CDS email with CDS verification report link
7. Send Worksmith email with pre-filled checklist link
8. Write vendor_packets_sent to Sindri
9. Signal completion
```

**Key design decisions:**

**CDS** gets the full SIR with a verification overlay — they need the context for phone calls and the full report structure for targeted verification of B/C claims.

**Worksmith** gets the checklist as the single deliverable — pre-filled, not accompanied by a separate SIR. The inspector standing in a building needs to know what to look at and what we think they'll find, not read about zoning appeals and fee formulas. The SIR research feeds INTO the checklist rather than sitting alongside it:
- Template items with SIR findings → pre-filled (inspector confirms or corrects)
- Template items without SIR findings → blank (pure field tasks)
- SIR risks that don't map to template items → appended as site-specific tasks

**Both** use claim-id HTML comments for round-trip extraction by AGENT-06 (CDS) and AGENT-07 (Worksmith).

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

### AGENT-06: CDS Verification Extraction

**Purpose:** Read a completed CDS Verification Report (the full AI SIR with CDS's verification columns filled in) and extract both the original AI findings and CDS's verified findings into the standard SIR schema, producing the `sir_vendor` data for downstream comparison and DD Report assembly.

**Invoking Event:** Email received classified as "CDS Verification Return"

**Subs to Monitor:** Email inbox — classify as CDS return (look for CDS sender, verification report attachment, or reply to the outbound CDS email from WU-04)

**Connectors:** Gmail, Google Drive

**Skill:** `cds-verification-extraction/SKILL.md` (NEW — needs to be built)

**Sindri Data In:** `site_meta` (for site matching), `sir_ai` (for baseline comparison), `vendor_packets_sent` (for CDS report URL matching)

**Sindri Data Out:**
```json
{
  "sir_vendor": {
    "extracted_at": "ISO timestamp",
    "source_doc_url": "string — Drive URL of the returned CDS verification report",
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
    "verification_summary": {
      "total_bc_items": "integer — how many B/C items were sent to CDS",
      "verified_count": "integer — how many CDS filled in",
      "confirmed_count": "integer — CDS agreed with AI finding",
      "corrected_count": "integer — CDS provided a different finding",
      "unverified_count": "integer — CDS left blank",
      "new_findings_count": "integer — CDS added items not in original report"
    },
    "verified_items": [
      {
        "claim_id": "string — matches the claim-id HTML comment from Mode 2",
        "field": "string — data point name",
        "ai_finding": "string — original AI value",
        "ai_confidence": "B | C",
        "cds_finding": "string — CDS verified value",
        "cds_source": "string — CDS source (e.g., 'staff call 4/15', 'permit records')",
        "cds_confidence": "A | B",
        "status": "confirmed | corrected | unverified"
      }
    ],
    "new_findings": [
      {
        "field": "string",
        "finding": "string",
        "source": "string",
        "section": "string — which report section CDS added it to"
      }
    ],
    "vendor_notes": "string — any free-text notes CDS added outside the table structure"
  }
}
```

**RHODES Write:** Yes — vendor-verified SIR data is the ground-truth record.

**SKILL.md outline (to build):**
```
# CDS Verification Extraction

## Purpose
Read a completed CDS Verification Report and extract structured data.
The input is the same AI SIR that was sent out, now with CDS's
verification columns filled in.

## Input
- CDS-returned verification report (markdown or docx)
- Extraction schema (same base fields as sir_ai + verification metadata)

## Process
1. Read the returned document
2. Parse tables looking for the 3 CDS columns:
   "CDS Verified Finding" | "CDS Source" | "CDS Confidence"
3. For each B/C row:
   a. Extract the claim-id from the HTML comment
   b. Read the original AI finding from the existing columns
   c. Read the CDS finding from the CDS columns
   d. Classify: confirmed (same value), corrected (different value),
      or unverified (CDS columns blank)
4. Scan for new findings CDS added outside the original tables
5. Extract all schema fields using best available value:
   - CDS-verified value if present, else AI value
6. Build the verification_summary counts

## Key Advantage
Because the returned document IS the original SIR with CDS columns added,
the extraction agent doesn't need to map between two different document
structures. Every field has a known location. The claim-id comments provide
exact row matching.

## Output
- Structured JSON matching the sir_vendor schema
- verification_summary with counts
- verified_items array with per-item detail

## Hard Rules
1. Use the SAME base schema as sir_ai — field names must match exactly
2. When CDS verified a field, use CDS value as the canonical value
3. When CDS left a field blank, carry forward the AI value but do NOT
   upgrade its confidence
4. Do not infer or fill fields neither the AI nor CDS addressed — leave null
5. Preserve CDS's exact language in cds_finding and cds_source
6. If CDS added findings outside the table structure, capture them in
   new_findings array
7. Map CDS terminology to standard values using the same mapping table
   as sir_ai normalization
```

**Supporting Files (to build):**
- `SKILL.md` — extraction instructions and schema
- `references/shared-sir-schema.json` — the schema shared between AI and vendor extractions
- `references/vendor-terminology-map.md` — maps vendor language to standard field values

---

### AGENT-07: Vendor Building Inspection Extraction

**Purpose:** Read a completed Worksmith pre-filled inspection checklist returned from the field and extract structured data into the standard inspection schema. The return is the same checklist document sent out via WU-04 — now with the inspector's findings filled in alongside the AI pre-fills. Claim-id HTML comments embedded during generation enable field-by-field delta matching.

**Invoking Event:** Email received classified as "Worksmith Building Inspection Return"

**Subs to Monitor:** Email inbox — classify as Worksmith return (look for Worksmith sender, checklist attachment, or reply to the outbound Worksmith email from WU-04)

**Connectors:** Gmail, Google Drive

**Skill:** `vendor-bi-extraction/SKILL.md` (NEW — needs to be built)

**Sindri Data In:** `site_meta` (for site matching), `sir_ai` (for claim-id cross-reference)

**Sindri Data Out:**
```json
{
  "inspection_vendor": {
    "extracted_at": "ISO timestamp",
    "source_doc_url": "string — Drive URL of the completed inspection report",
    "address": "string",
    "inspector_name": "string",
    "inspection_date": "string — ISO date",
    "overall_recommendation": "PROCEED | PROCEED WITH CAUTION | REQUIRES JUSTIFICATION | PASS",
    "deal_killer_flags": {
      "safe_dropoff": "yes | no | needs_evaluation",
      "adequate_exits": "yes | no | needs_evaluation",
      "exit_doors_compliant": "yes | no | needs_evaluation",
      "structurally_sound": "yes | no | needs_evaluation",
      "no_hazmat_visible": "yes | no | needs_evaluation",
      "any_no": "boolean — true if any answer is No"
    },
    "sections": {
      "exterior_site": {
        "items": [
          {
            "item": "string — checklist item name",
            "ai_prefill": "string | null — what the SIR pre-filled",
            "confirmed": "boolean — inspector checked the Confirmed box",
            "finding": "string | null — inspector's actual finding (if different from AI or new)",
            "source_citation": "string | null — how they verified (observation, measurement, photo, etc.)",
            "notes": "string | null",
            "claim_id": "string | null — from HTML comment, for delta matching"
          }
        ]
      },
      "parking_dropoff": { "items": "[same structure]" },
      "entry_egress": { "items": "[same structure]" },
      "fire_alarm": { "items": "[same structure]" },
      "sprinkler": { "items": "[same structure]" },
      "emergency_systems": { "items": "[same structure]" },
      "restrooms_plumbing": { "items": "[same structure]" },
      "ada": { "items": "[same structure]" },
      "structural": { "items": "[same structure]" },
      "hvac_mechanical": { "items": "[same structure]" },
      "electrical": { "items": "[same structure]" }
    },
    "occupant_load": {
      "net_floor_area_sf": "integer | null",
      "total_occupant_load": "integer | null",
      "net_learning_area_sf": "integer | null",
      "student_capacity": "integer | null"
    },
    "cost_estimates": [
      {
        "item": "string — category (Fire Alarm, Egress, ADA, Plumbing, HVAC, Electrical, Structural, Other)",
        "description": "string",
        "priority": "CRITICAL | IMPORTANT | MINOR",
        "low_estimate": "number | null",
        "high_estimate": "number | null",
        "notes": "string | null"
      }
    ],
    "deficiency_summary": {
      "critical_count": "integer",
      "important_count": "integer",
      "minor_count": "integer",
      "total_remediation_low": "number — sum of all low estimates",
      "total_remediation_high": "number — sum of all high estimates"
    },
    "specialist_referrals": [
      {
        "type": "structural engineer | MEP engineer | fire protection engineer | environmental | other",
        "reason": "string"
      }
    ],
    "site_specific_tasks": [
      {
        "task_number": "integer",
        "task": "string — what was asked",
        "finding": "string | null — inspector's response",
        "documentation": "string | null — what they documented (photos, measurements, etc.)"
      }
    ],
    "vendor_notes": "string — any inspector observations not captured in structured fields"
  }
}
```

**RHODES Write:** Yes — inspection data is the structural ground truth for the site.

**SKILL.md outline (to build):**
```
# Vendor Building Inspection Extraction

## Purpose
Extract structured data from a completed Worksmith pre-filled inspection
checklist returned from the field into the standard inspection schema.

## Input
- Completed checklist (from email attachment or Drive upload)
  Format: markdown with header block, deal-killer questions,
  11-section inspection tables, site-specific tasks, occupant load,
  cost estimate table, overall assessment.
  Each table row has: Item | AI Pre-Fill | Confirmed | Finding | Source/Citation | Notes
  Claim-id HTML comments embedded after pre-filled rows.
- site_meta (for address matching)
- sir_ai (for claim-id cross-reference)

## Process
1. Read the completed checklist
2. Extract header info: inspector name, date, overall recommendation
3. Extract deal-killer flags (5 binary questions)
   NOTE: if any_no = true, this is an early-exit signal — flag prominently
4. For each of the 11 inspection sections:
   a. Parse the table rows
   b. For each row: extract item name, AI pre-fill, confirmed flag,
      inspector finding, source/citation, notes
   c. Extract claim-id from HTML comments
   d. Classify: confirmed (AI + inspector agree), corrected (differ),
      new_finding (inspector found something AI missed),
      unverified (inspector left blank)
5. Extract site-specific task responses (appended section beyond the 11 standard)
   - These are the D-confidence / SIR-flagged items unique to this property
6. Extract occupant load calculations
7. Extract cost estimate table → structured array with totals
8. Extract specialist referrals if any
9. Compute deficiency summary: count by priority, sum cost ranges

## Output
- Structured JSON matching the inspection_vendor schema
- claim_ids preserved for WU-09 delta computation
- deficiency_summary with rollup counts and cost totals

## Hard Rules
1. Never infer construction type — only extract if explicitly stated
2. Never upgrade condition assessments — use the inspector's language
3. Leave fields null if the inspector did not address them
4. Flag any deal-killer "No" answers prominently in the output
5. Preserve claim-ids exactly as found — do not regenerate
6. Cost estimates extracted as-is — do not adjust or average
7. If the inspector recommends specialist follow-up, capture it
   in specialist_referrals — the DD report needs this
8. Overall recommendation must be one of the 4 standard values.
   If inspector used non-standard language, map it:
   "Approved" → PROCEED, "Conditionally approved" → PROCEED WITH CAUTION,
   "Major concerns" → REQUIRES JUSTIFICATION, "Failed" / "Not recommended" → PASS
```

**Supporting Files (to build):**
- `SKILL.md` — full extraction instructions, schema reference, and examples
- `references/shared-inspection-schema.json` — the standard inspection schema (11 sections + cost estimates + occupant load)
- `references/condition-scale.md` — standard condition assessment scale
- `references/checklist-section-map.md` — maps the 11 template sections to schema field paths (handles format variations between sites)

---

### AGENT-08: ISP Extraction

**Purpose:** Read a Program Fit Analysis PDF (the ISP document generated by Alpha's space-planning tool) and extract all structured data: building code info, scores, capacity analysis, classroom assignments, ADA pre-check, IBC compliance, adjacency compliance, room schedule, and door schedule.

**Invoking Event:** ISP document uploaded to Drive (or received via email)

**Subs to Monitor:** Drive folder watch (M1 folder) or email inbox classification

**Connectors:** Google Drive

**Skill:** `isp-extraction/SKILL.md` (BUILT — in alpha-dd-pipeline repo)

**Sindri Data In:** `site_meta` (for site matching)

**Sindri Data Out:**
```json
{
  "isp_extract": {
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
      "requirements_score": "string | null",
      "quality_score": "string | null",
      "total_rooms": "integer",
      "rooms_assigned": "integer",
      "rooms_unassigned": "integer",
      "target_capacity": "integer | null",
      "recommended_capacity": "integer",
      "avg_fit_score_pct": "number",
      "best_tier_met": "string"
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
      "violations": [ { "severity": "ERROR | WARNING", "location": "string", "rule": "string", "actual": "string | null", "required": "string | null", "description": "string" } ]
    },
    "ibc_compliance": {
      "score": "integer 0-100",
      "errors": "integer",
      "warnings": "integer",
      "total_occupant_load": "integer",
      "occupant_load_by_room": [ { "room_id": "string", "type": "string", "area_sf": "integer", "factor": "integer", "method": "net | gross", "load": "integer" } ],
      "plumbing_fixtures": {
        "water_closets_male": { "required": "integer", "notes": "string" },
        "water_closets_female": { "required": "integer", "notes": "string" },
        "lavatories": { "required": "integer", "notes": "string" },
        "drinking_fountains": { "required": "integer", "notes": "string" }
      },
      "plumbing_summary": "string | null",
      "violations": [ { "severity": "ERROR | WARNING | INFO", "rule": "string", "description": "string" } ]
    },
    "adjacency_compliance": {
      "score": "integer 0-100",
      "critical_count": "integer",
      "high_count": "integer",
      "medium_count": "integer",
      "violations": [ { "priority": "Critical | High | Medium", "rule_number": "integer", "room_types": "string", "relationship": "string", "detail": "string" } ]
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
}
```

**RHODES Write:** Yes — capacity data, scores, and room inventory are used by enrollment, operations, and finance teams.

**Supporting Files (BUILT):**
- `skills/isp-extraction/SKILL.md` — full extraction instructions with 12-step process and 12 hard rules
- `skills/isp-extraction/references/isp-extraction-schema.json` — complete JSON Schema

---

### AGENT-12: Opening Plan v2

**Purpose:** Two-pass permitting plan generation. Pass 1 builds a deterministic SIR baseline with mandatory ASHRAE 62.1 HVAC calculation, AHERA hazmat gating (pre-1978 buildings), and ADA elevator determination. Pass 2 launches 5 parallel research agents (Zoning, Building, Health/Edu Regulatory, Fire, ADA/HVAC) to enrich the baseline with primary-source citations, named contacts, and cunning-path strategies. Agent 3 (Health/Edu Regulatory) receives `school_approval` output (WU-03) as its education regulatory baseline — 15 fields are PRE-ENRICHED so the agent deepens rather than rediscovers. Output is a Google Doc from the master template.

**Invoking Event:** Readiness check — best available SIR + `school_approval` + inspection + `cost_estimates` all exist in Sindri

**Subs to Monitor:** Sindri — compound watch on SIR + school_approval + inspection + cost_estimates

**Connectors:** Google Drive, Google Docs

**Skill:** `opening-plan-v2/SKILL.md` (v2.2)
- Replaces `sir-to-permitting-plan`
- Two-pass architecture: SIR baseline (deterministic) + 5 parallel research agents (aspirational)
- Mandatory Pass 1 calculations: HVAC ventilation delta (ASHRAE 62.1), elevator requirement (ADA §206.2.3), AHERA hazmat gate (pre-1978)
- Research agents: Zoning & Land Use, Building Code, Health/Food/Edu Regulatory, Fire Code & Life Safety, ADA/HVAC & Accessibility
- Agent 3 consumes `school_approval` (WU-03) as PRE-ENRICHED baseline for education regulatory fields
- Mandatory research checks: state sprinkler threshold amendment, NFPA 101 cross-check, conflicting standards resolution protocol, attorney verification
- Depends on `school-approval` skill (user scope) as a pre-step
- 18 hard rules, 3 executive checklists (Andy, Neeraj, JC)

**Sindri Data In:**
- `sir_ai` (from WU-02) — required for Pass 1 baseline
- Best available SIR: `sir_vendor` preferred, `sir_ai` fallback
- Best available inspection: `inspection_vendor` preferred, `inspection_ai` fallback
- `cost_estimates` (from WU-10)
- `permit_history` (from WU-11)
- `school_approval` (from WU-03) — **new dependency**: pre-enriches 15 edu regulatory fields for Agent 3
- `sir_delta` or `inspection_delta` (from WU-09, if available — highlights conflicts)
- `site_meta` (from WU-01)

**Sindri Data Out:**
```json
{
  "opening_plan": {
    "generated_at": "ISO timestamp",
    "skill_version": "2.2",
    "recommendation": "Go | No Go | Conditional Go",
    "scenarios": {
      "best": { "target_date": "string", "total_cost": "integer", "weeks": "integer" },
      "realistic": { "target_date": "string", "total_cost": "integer", "weeks": "integer" },
      "worst": { "target_date": "string", "total_cost": "integer", "weeks": "integer" }
    },
    "gating_factors": [
      {
        "gate_id": "string — e.g. gate_0, gate_0hm, gate_1",
        "name": "string",
        "gate_type": "site_kill | hazmat | timeline_branch | scope_unknown | permit_cycle",
        "resolved_when": "string",
        "good_outcome": "string",
        "bad_outcome": "string"
      }
    ],
    "deterministic_calculations": {
      "hvac_ventilation_delta": {
        "existing_cfm": "integer",
        "required_cfm": "integer",
        "multiplier": "float",
        "estimated_cost_low": "integer",
        "estimated_cost_high": "integer"
      },
      "elevator_required": "boolean",
      "hazmat_gate": {
        "applicable": "boolean — true if pre-1978",
        "estimated_weeks": "integer — 6-8 if applicable"
      }
    },
    "research_enrichment_summary": {
      "fields_enriched": "integer",
      "sir_confirmed": "integer",
      "sir_contradicted": "integer",
      "sir_gaps_filled": "integer",
      "named_contacts_found": "integer",
      "conflicting_standards": ["string — if any"]
    },
    "edu_regulatory": {
      "archetype": "string — from school-approval",
      "gating_before_open": "boolean",
      "calendar_window": "string | null",
      "equivalency_pathways": ["string — from Agent 3 research"],
      "denial_precedents": ["string — from Agent 3 research"]
    },
    "risks": [
      {
        "track": "string",
        "risk": "string",
        "trigger": "string",
        "impact": "string",
        "mitigations": ["string"]
      }
    ],
    "report_url": "string — Drive URL of the full Opening Plan Google Doc",
    "data_sources_used": {
      "sir_source": "vendor | ai",
      "inspection_source": "vendor | ai",
      "school_approval_used": "boolean"
    }
  }
}
```

**RHODES Write:** Yes — the Opening Plan is a decision document used by leadership and construction.

**Supporting Files:**
- `SKILL.md` — full skill definition (v2.2)
- `references/field-mapping.md` — SIR-to-plan field mapping with PRE-ENRICHED type, scenario derivation logic, ENRICH protocol
- `references/template-content.md` — full section-by-section template hierarchy
- `references/executive-mindset.md` — Andy/Neeraj/JC evaluation standards

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
| `isp-extraction` | alpha-dd-pipeline | Extract structured data from Program Fit Analysis PDFs | **BUILT** — 12-step extraction, 12 hard rules, full JSON Schema |
| `dd-report-assembly` | DD Reporter (or monorepo) | Assemble DD report from structured Sindri data | Low — logic largely exists, needs restructuring to read from Sindri instead of raw docs |

All three extraction skills belong in the shared Ops-Skills repo since other teams may need the same extraction schemas. The DD report assembly skill is pipeline-specific and belongs in the monorepo.

---

## Shared Schemas

The dual-column design depends on AI and vendor extractions using identical schemas. These schemas live alongside the skills in Ops-Skills:

| Schema | Used By | Fields |
|---|---|---|
| `shared-sir-schema.json` | WU-02 (sir_ai), WU-06 (sir_vendor), WU-09 (sir_delta) | zoning, authority chain, code framework, permit path, feasibility, environmental, infrastructure |
| `shared-inspection-schema.json` | WU-07 (inspection_vendor), WU-09 (inspection_delta) | 11 sections (exterior/site, parking/drop-off, entry/egress, fire alarm, sprinkler, emergency systems, restrooms/plumbing, ADA, structural, HVAC/mechanical, electrical) + deal-killer flags, occupant load, cost estimates, deficiency summary, specialist referrals, overall recommendation |
| `isp-extraction-schema.json` | WU-08 (isp_extract) | building code info, executive summary, capacity analysis, classroom assignments, tier evaluation, ADA pre-check, IBC compliance (occupant load + plumbing), adjacency compliance, requirement status, optimization proposals, room schedule, door schedule |

The AI SIR (WU-02) doesn't directly use `shared-sir-schema.json` today — its output is defined by the ease-of-conversion skill. A mapping layer in WU-02 or a schema update to the skill will be needed to ensure the output conforms to the shared schema for delta computation.
