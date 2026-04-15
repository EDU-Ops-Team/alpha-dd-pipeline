# Alpha DD Pipeline

Sindri work unit pipeline for Due Diligence Report generation. Each work unit is either a **script** (deterministic Convex function) or an **agent** (Claude Managed Agent running a SKILL.md).

## Architecture

14 work units: 7 agents, 7 scripts. All agent skills live in the [Ops-Skills repo](https://github.com/EDU-Ops-Team/Ops-Skills) (submodule at `skills/ops-skills`).

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
       ├── WU-06 (CDS Verification Extraction) ─── Agent [ops-skills/cds-verification-extraction]
       ├── WU-07 (Vendor BI Extraction) ─── Agent [ops-skills/vendor-bi-extraction]
       └── WU-08 (ISP Extraction) ─── Agent [ops-skills/isp-extraction]
          │
       WU-09 (Delta Computation) ─── Script
       WU-10 (RayCon Cost Estimates) ─── Script
       WU-12 (Opening Plan v2) ─── Agent [ops-skills/opening-plan-v2]
       WU-13 (DD Report Assembly) ─── Agent [ops-skills/dd-report-assembly]
       WU-14 (Report Distribution) ─── Script
```

## Data Model

- **Sindri** — pipeline data layer. Each work unit produces data that downstream work units read directly.
- **RHODES** — business data layer. Data goes to RHODES only when it needs long-term storage or availability to other teams.

## Repo Structure

```
alpha-dd-pipeline/
├── skills/
│   └── ops-skills/             # Submodule → EDU-Ops-Team/Ops-Skills
│       ├── ease-of-conversion/           # AGENT-02: AI SIR Generation
│       ├── school-approval/              # AGENT-03: School Approval Analysis
│       ├── cds-verification-extraction/  # AGENT-06: CDS Verification Extraction
│       ├── vendor-bi-extraction/         # AGENT-07: Vendor BI Extraction
│       ├── isp-extraction/               # AGENT-08: ISP Extraction
│       ├── opening-plan-v2/              # AGENT-12: Opening Plan v2
│       └── dd-report-assembly/           # AGENT-13: DD Report Assembly
├── scripts/                    # WU-01, 04, 05, 09, 10, 11, 14 (TypeScript logic)
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
- **Ops-Skills as submodule** — shared team repo, single home for all 7 agent skills. Pipeline repo has no standalone skills — everything references Ops-Skills

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
| AI SIR Generation (AGENT-02) | Complete — in Ops-Skills |
| School Approval (AGENT-03) | Complete — in Ops-Skills |
| CDS Verification Extraction (AGENT-06) | Complete — in Ops-Skills. Pending vendor return samples for validation |
| Vendor BI Extraction (AGENT-07) | Complete — in Ops-Skills. Pending vendor return samples for validation |
| ISP Extraction (AGENT-08) | Complete — in Ops-Skills |
| Opening Plan v2 (AGENT-12) | Complete — in Ops-Skills (v2.2) |
| DD Report Assembly (AGENT-13) | Complete — in Ops-Skills |
| Work unit decomposition (all 14 specs) | Complete |
| Scripts (7 total) | Complete — TypeScript stubs with full logic, typed interfaces, shared types |
