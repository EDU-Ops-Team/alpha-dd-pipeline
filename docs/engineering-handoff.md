# DD Pipeline: Engineering Plan

## Bottom Line

We have two repos doing the same job with duplicate code. We're consolidating into one monorepo, moving the data layer to RHODES, and automating the skills submodule so nobody has to manually sync anything. Three files are already committed and pushed.

---

## What Exists Today

Two repos, 16,000 lines of Python, significant overlap:

| Concern | Repo 1 (alpha-analysis) | Repo 2 (DD reporter) |
|---|---|---|
| Wrike client | wrike.py (1,867 lines) | wrike.py (813 lines) |
| Google client | google_client.py (412 lines) | google_client.py (664 lines) |
| Wrike field IDs | 18 custom field constants | Same 18 constants (identical) |
| Email | AWS SES (1,104 lines) | Gmail SMTP (326 lines) |
| E-Occupancy analysis | Runs in SIR Phase 7 | Standalone tool (redundant) |
| School Approval | Runs fresh each time | Standalone tool (redundant) |
| Skills | Git submodule (Ops-Skills) | Embedded in server.py |

A Wrike field ID change requires PRs to two repos. A skill update touches three locations. Both deploy independently with separate OAuth credentials and CI workflows.

---

## What We're Building

### One monorepo, three layers

```
alpha-site-pipeline/
├── core/                    # Shared library (no MCP dependency)
│   ├── site_record.py       # SiteRecord dataclass + provider protocol
│   ├── rhodes_provider.py   # RHODES MCP client (primary)
│   ├── wrike_provider.py    # Wrike API client (migration fallback)
│   ├── google_client.py     # Unified Google APIs
│   ├── extractors/          # One per document type (SIR, BI, ISP)
│   ├── enrichment/          # RayCon, Shovels, Opening Plan v2
│   └── schema.py            # Site data record schema + DD report tokens
│
├── services/                # Thin MCP wrappers (tool definitions only)
│   ├── intake/              # New Site processing (was alpha-analysis)
│   ├── reporter/            # DD report generation (was DD reporter)
│   └── scanner/             # Inbox scanner + daily sweep
│
├── skills/                  # Git submodule → EDU-Ops-Team/Ops-Skills
│   ├── ease-of-conversion/
│   ├── school-approval/
│   └── opening-plan-v2/     # Replaces sir-to-permitting-plan
│
└── tests/
```

### Why this structure

- **core/**: Pure Python, no MCP imports. Every function is independently testable.
- **services/**: 5-10 lines of boilerplate per tool. Business logic lives in core/.
- **skills/**: Git submodule to the shared Ops-Skills repo. One source of truth.

---

## RHODES as the Data Store

Site data record lives in RHODES, not Google Docs. RHODES work units store each pipeline stage output:

| Work Unit | What It Stores |
|---|---|
| sir_ai | AI SIR structured extraction (Phase 1-9 output) |
| sir_vendor | CDS vendor SIR structured extraction |
| sir_delta | Computed diff between AI and vendor |
| inspection_ai | AI Building Inspection extraction |
| inspection_vendor | Worksmith vendor Building Inspection extraction |
| inspection_delta | Computed diff between AI and vendor |
| isp_extract | ISP structured extraction |
| school_approval | Skill output (zone, archetype, timeline) |
| cost_estimates | RayCon results per scenario |
| permit_history | Shovels results |
| opening_plan | Permitting plan output |
| dd_report | Report metadata (doc_id, url, version) |

### Dual-column design

AI and vendor versions use the same extraction schema. This gives you:

- **Accuracy benchmarking** — track how close AI outputs are to vendor-verified data
- **Conflict detection** — AI says "permitted by right" but vendor says "use permit required" gets flagged automatically
- **Sourcing rules** — vendor data wins when available, AI fills the gaps
- **No data loss** — AI output is never overwritten

### Event-driven pipeline

Instead of running one monolithic agent loop per site:

1. Document arrives → extract to the right work unit
2. Check readiness (SIR + BI + ISP all present?)
3. When ready → run enrichment (RayCon, Shovels, Opening Plan)
4. Assemble DD report from structured work unit data only

Report assembly drops from 10-18 minutes to about 2 minutes. The agent reads structured data and maps fields to tokens — it never re-reads raw PDFs.

---

## What's Already Done

Three files committed and pushed to alpha-analysis-downstream-processing:

### 1. Auto-sync workflow

**File**: `.github/workflows/sync-ops-skills.yml`

Keeps the skills/ submodule in sync with Ops-Skills automatically. Three trigger paths:
- **repository_dispatch** — Ops-Skills pushes to main, downstream repo updates immediately
- **Scheduled poll** — every 6 hours as fallback
- **Manual dispatch** — from the Actions tab

When the submodule SHA changes, the workflow:
1. Runs the smoke test first
2. Only if tests pass, commits the update with a changelog
3. Pushes the commit

### 2. Smoke test

**File**: `tests/test_skill_context.py`

25 tests covering:
- Submodule directory structure (5 tests)
- SKILL.md loading for both allowed skills (2 tests)
- All reference documents load correctly (8 tests)
- Path traversal attacks are rejected (3 tests)
- Unknown skill names are rejected (5 tests)
- Nonexistent documents return errors, not crashes (2 tests)

Self-contained — runs with just pytest, no full package install needed.

### 3. Webhook setup docs

**File**: `docs/ops-skills-webhook-setup.md`

Instructions for adding the notify-downstream workflow to the Ops-Skills repo so sync is immediate instead of waiting for the 6-hour poll.

---

## What You Need to Set Up

**One secret required now**: Add a `GH_PAT` secret to the alpha-analysis-downstream-processing repo. Needs a PAT with contents:write scope. Without this, the auto-sync workflow can't push commits.

**Optional (for instant sync)**: Add the notify-downstream.yml workflow to the Ops-Skills repo + a DOWNSTREAM_PAT secret there. Without this, sync still works — just on the 6-hour poll schedule.

---

## Implementation Phases

### Phase 1: Monorepo consolidation (1-2 weeks)
- Create alpha-site-pipeline repo
- Deduplicate Wrike, Google, and email clients into core/
- Move services from both repos
- Keep skills/ as git submodule
- Remove embedded E-Occupancy and School Approval from DD reporter
- Single pyproject.toml, unified test suite
- Archive old repos (read-only)

### Phase 2: RHODES integration (2-3 weeks)
- Define full site data record schema in core/schema.py
- Build rhodes_provider.py using RHODES MCP tools
- Build document extractors (one per doc type)
- Build delta computation logic
- Wire extractors into the intake and scanner services

### Phase 3: Event-driven enrichment (1-2 weeks)
- Readiness check after each work unit write
- Trigger RayCon + Shovels + Opening Plan when ready
- Rewrite DD report agent to read from RHODES work units only
- Remove raw document reading from report path

### Phase 4: Polish (ongoing)
- RHODES webhooks to replace polling
- Pipeline status dashboard
- AI accuracy tracking (delta agreement rates over time)
- Regression tests against known-good reports

---

## Key Decisions Already Made

- **RHODES work units** store all site data (not Google Docs)
- **Vendor data wins** over AI data when both exist
- **E-Occupancy eliminated** as standalone — SIR Phase 7 is the single source
- **School Approval stays separate** (different domain from building code)
- **Skills stay as git submodule** to EDU-Ops-Team/Ops-Skills (shared team resource)
- **Wrike→RHODES migration** uses an adapter pattern so we can run both in parallel during cutover

---

## Links

- Upstream repo: https://github.com/trilogy-group/alpha-analysis-downstream-processing
- DD Reporter repo: https://github.com/GFooteGK1/due-diligence-reporter
- Ops-Skills submodule: https://github.com/EDU-Ops-Team/Ops-Skills
- RHODES MCP: https://location-os-mcp.ephor.workers.dev/mcp (54 tools)
