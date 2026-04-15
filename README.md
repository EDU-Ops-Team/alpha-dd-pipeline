# Alpha DD Pipeline

Sindri work unit pipeline for Due Diligence Report generation. Each work unit is either a **script** (deterministic Convex function) or an **agent** (Claude Managed Agent running a SKILL.md).

## Architecture

14 work units: 5 agents, 9 scripts.

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
       ├── WU-06 (Vendor SIR Extraction) ─── Agent
       ├── WU-07 (Vendor BI Extraction) ─── Agent
       └── WU-08 (ISP Extraction) ─── Agent
          │
       WU-09 (Delta Computation) ─── Script
       WU-10 (RayCon Cost Estimates) ─── Script
       WU-12 (Opening Plan v2) ─── Agent [ops-skills/opening-plan-v2]
       WU-13 (DD Report Assembly) ─── Agent [dd-report-assembly]
       WU-14 (Report Distribution) ─── Script
```

## Data Model

- **Sindri** — pipeline data layer. Each work unit produces data that downstream work units read directly.
- **RHODES** — business data layer. Data goes to RHODES only when it needs long-term storage or availability to other teams.

## Repo Structure

```
alpha-dd-pipeline/
├── skills/
│   ├── dd-report-assembly/     # AGENT-13: DD Report Assembly (new)
│   │   ├── SKILL.md
│   │   └── references/
│   ├── vendor-sir-extraction/  # AGENT-06: CDS vendor SIR extraction (pending samples)
│   ├── vendor-bi-extraction/   # AGENT-07: Worksmith BI extraction (pending samples)
│   ├── isp-extraction/         # AGENT-08: ISP extraction (pending samples)
│   └── ops-skills/             # Submodule → EDU-Ops-Team/Ops-Skills
│       ├── ease-of-conversion/ # AGENT-02: AI SIR Generation
│       ├── school-approval/    # AGENT-03: School Approval Analysis
│       └── opening-plan-v2/       # AGENT-12: Opening Plan v2 (two-pass: SIR baseline + research enrichment)
├── scripts/                    # WU-01, 04, 05, 09, 10, 11, 14 (TypeScript logic)
├── docs/
│   ├── sindri-work-unit-decomposition.md  # Full WU specs
│   └── engineering-handoff.md             # Engineering plan for handoff
└── tests/
```

## Key Design Decisions

- **Vendor > AI precedence** — for every field where both sources exist, vendor data wins
- **All SIR data required** — the DD Report won't generate until both AI and vendor SIR, inspection, ISP, cost estimates, and Opening Plan are complete
- **Recommended Path inferred** — capacity-per-dollar ratio among scenarios that can complete before Aug 12, 2026
- **No fabricated timelines** — dates come from the Opening Plan; missing data gets a gap label saying what's needed
- **Human-readable output** — every support document must produce both structured JSON (Sindri) and a readable document (Drive)
- **School-approval feeds Opening Plan** — WU-03 output is pre-enriched input for WU-12's education regulatory section (Agent 3 deepens, doesn't rediscover)
- **Ops-Skills as submodule** — shared team repo, one source of truth for ease-of-conversion, school-approval, and opening-plan-v2

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
| DD Report Assembly skill (AGENT-13) | Complete — ready for review |
| Work unit decomposition (all 14 specs) | Complete — ready for review |
| Vendor SIR Extraction (AGENT-06) | Pending vendor document samples |
| Vendor BI Extraction (AGENT-07) | Pending vendor document samples |
| ISP Extraction (AGENT-08) | Pending vendor document samples |
| Scripts (9 total) | Pending — TypeScript logic next |
