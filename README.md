# Alpha DD Pipeline

Sindri work unit pipeline for Due Diligence Report generation. Each work unit is either a **script** (deterministic Convex function) or an **agent** (Claude Managed Agent running a SKILL.md).

## Architecture

14 work units: 7 agents, 7 scripts.

Pipeline-specific skills live in this repo under `skills/`. Standalone skills that can also run outside the pipeline (ease-of-conversion, school-approval) live in the [Ops-Skills repo](https://github.com/EDU-Ops-Team/Ops-Skills) and are referenced via submodule.

```
WU-01 (Intake) ─── Script
   ├── WU-02 (AI SIR) ─── Agent [ops-skills/ease-of-conversion]
   ├── WU-03 (School Approval) ─── Agent [ops-skills/school-approval]
   ├── WU-05 (Location Presentation) ─── Script
   └── WU-11 (Shovels Permit History) ─── Script
          │
       WU-04 (Vendor Packet Dispatch) ─── Script
          │
       Vendor returns arrive (async)
       ├── WU-06 (CDS Verification Extraction) ─── Agent [skills/cds-verification-extraction]
       ├── WU-07 (Vendor BI Extraction) ─── Agent [skills/vendor-bi-extraction]
       └── WU-08 (ISP Extraction) ─── Agent [skills/isp-extraction]
          │
       WU-09 (Delta Computation) ─── Script
       WU-10 (RayCon Cost Estimates) ─── Script
       WU-12 (Opening Plan v2) ─── Agent [skills/opening-plan-v2]
       WU-13 (DD Report Assembly) ─── Agent [skills/dd-report-assembly]
       WU-14 (Report Distribution) ─── Script
```

## Data Model

- **Sindri** — pipeline data layer. Each work unit produces data that downstream work units read directly.
- **RHODES** — business data layer. Data goes to RHODES only when it needs long-term storage or availability to other teams.

## Repo Structure

```
alpha-dd-pipeline/
├── skills/
│   ├── cds-verification-extraction/  # AGENT-06: CDS Verification Extraction
│   ├── vendor-bi-extraction/         # AGENT-07: Vendor BI Extraction
│   ├── isp-extraction/               # AGENT-08: ISP Extraction
│   ├── opening-plan-v2/              # AGENT-12: Opening Plan v2
│   ├── dd-report-assembly/           # AGENT-13: DD Report Assembly
│   └── ops-skills/                   # Submodule → EDU-Ops-Team/Ops-Skills
│       ├── ease-of-conversion/       #   AGENT-02: AI SIR Generation (standalone)
│       └── school-approval/          #   AGENT-03: School Approval (standalone)
├── scripts/
│   ├── shared/                       # Types, Sindri/RHODES clients, config, errors, retry
│   ├── wu-01/                        # New Site Intake
│   ├── wu-04/                        # Vendor Dispatch (CDS + Worksmith)
│   ├── wu-05/                        # Location Presentation
│   ├── wu-09/                        # Delta Computation
│   ├── wu-10/                        # RayCon Cost Estimates
│   ├── wu-11/                        # Shovels Permit History
│   └── wu-14/                        # Report Distribution
├── docs/
│   ├── sindri-work-unit-decomposition.md  # Full WU specs
│   └── diagrams/
│       ├── process-flow.html              # Interactive process flow
│       └── process-flow-diagram.md        # Mermaid diagram
└── tests/
```

## Key Design Decisions

- **Vendor > AI precedence** — for every field where both sources exist, vendor data wins
- **All SIR data required** — the DD Report won't generate until both AI and vendor SIR, inspection, ISP, cost estimates, and Opening Plan are complete
- **Recommended Path inferred** — capacity-per-dollar ratio among scenarios that can complete before Aug 12, 2026
- **No fabricated timelines** — dates come from the Opening Plan; missing data gets a gap label saying what's needed
- **Human-readable output** — every support document must produce both structured JSON (Sindri) and a readable document (Drive)
- **School-approval feeds Opening Plan** — WU-03 output is pre-enriched input for WU-12's education regulatory section (Agent 3 deepens, doesn't rediscover)
- **Pipeline skills in-repo, standalone skills via submodule** — skills that only run as pipeline work units live here. Skills that can run independently (SIR generation, school approval) live in Ops-Skills so other teams can use them without the pipeline.

## Getting Started

```bash
git clone --recurse-submodules https://github.com/EDU-Ops-Team/alpha-dd-pipeline.git
```

To update the Ops-Skills submodule:
```bash
git submodule update --remote skills/ops-skills
```

## Status

| Component | Status |
|---|---|
| AI SIR Generation (AGENT-02) | Complete — in Ops-Skills (standalone) |
| School Approval (AGENT-03) | Complete — in Ops-Skills (standalone) |
| CDS Verification Extraction (AGENT-06) | Complete — in pipeline repo. Pending vendor return samples |
| Vendor BI Extraction (AGENT-07) | Complete — in pipeline repo. Pending vendor return samples |
| ISP Extraction (AGENT-08) | Complete — in pipeline repo |
| Opening Plan v2 (AGENT-12) | Complete — in pipeline repo (v2.2) |
| DD Report Assembly (AGENT-13) | Complete — in pipeline repo |
| Scripts (7 total) | Complete — TypeScript with full logic, typed interfaces, shared types |
| Work unit decomposition (all 14 specs) | Complete |
