# Alpha DD Pipeline

Sindri work unit pipeline for Due Diligence Report generation. 14 work units: 7 deterministic scripts and 7 Claude agent skills.

## Quick Start

```bash
# Clone with submodules (required — standalone skills live in Ops-Skills)
git clone --recurse-submodules https://github.com/EDU-Ops-Team/alpha-dd-pipeline.git
cd alpha-dd-pipeline

# If you already cloned without --recurse-submodules
git submodule update --init --recursive
```

### Updating the Ops-Skills Submodule

The `skills/ops-skills/` directory is a Git submodule pointing to [EDU-Ops-Team/Ops-Skills](https://github.com/EDU-Ops-Team/Ops-Skills). When that repo updates (e.g., the ease-of-conversion skill improves), pull the latest:

```bash
git submodule update --remote skills/ops-skills
git add skills/ops-skills
git commit -m "chore: update ops-skills submodule"
```

> **Common gotcha:** If `skills/ops-skills/` is empty after cloning, you forgot `--recurse-submodules`. Run `git submodule update --init --recursive` to fix.

---

## Architecture

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

### Data Model

- **Sindri** — pipeline data layer. Each work unit produces typed data that downstream work units read directly.
- **RHODES** — business data layer. Data goes to RHODES only when it needs long-term storage or availability to other teams.

Not every work unit writes to RHODES. Some only pass data forward through Sindri.

---

## Skills vs Scripts

Every work unit is either a **skill** (agent) or a **script**. The rule is simple:

| | Skill (Agent) | Script |
|---|---|---|
| **When to use** | Reads unstructured text or makes a judgment call | Moves data, calls APIs with known inputs, or computes diffs |
| **Runs on** | Claude Managed Agent (loads SKILL.md) | Convex function (deterministic TypeScript) |
| **Location** | `skills/<name>/SKILL.md` + `references/` | `scripts/<wu-number>/<name>.ts` |
| **Types** | Defined in SKILL.md prose + reference schemas | Imported from `scripts/shared/types.ts` |
| **Output** | Writes Sindri record via structured output | Writes Sindri record via `SindriClient` |
| **Testable offline** | Manually — give the agent a sample doc and check output | Programmatically — unit tests with mocked Sindri/RHODES |

### Why the Split Matters

Scripts are fast, cheap, and deterministic. If a work unit doesn't require reading unstructured text, it should be a script. Agents are powerful but cost tokens and take longer. The pipeline pays for agents only where their reasoning ability is needed.

### Pipeline Skills vs Standalone Skills

Skills in this repo fall into two categories:

| | Pipeline Skills | Standalone Skills |
|---|---|---|
| **Location** | `skills/<name>/` (this repo) | `skills/ops-skills/<name>/` (submodule) |
| **Source repo** | This repo (`alpha-dd-pipeline`) | [Ops-Skills](https://github.com/EDU-Ops-Team/Ops-Skills) |
| **Can run alone?** | No — needs Sindri data from upstream work units | Yes — works outside the pipeline |
| **Examples** | CDS extraction, vendor BI extraction, ISP extraction, Opening Plan, DD Report Assembly | ease-of-conversion (AI SIR), school-approval |
| **Who maintains?** | Pipeline team | Ops team (shared across teams) |

The rule: if a skill only makes sense as part of the pipeline, it lives here. If someone on another team could use it independently, it lives in Ops-Skills.

---

## Repo Structure

```
alpha-dd-pipeline/
├── skills/                               # Agent work units
│   ├── cds-verification-extraction/      # AGENT-06: CDS Verification Extraction
│   │   ├── SKILL.md                      #   Agent instructions
│   │   └── references/                   #   Extraction schema, walkthrough, term map
│   ├── vendor-bi-extraction/             # AGENT-07: Vendor BI Extraction
│   │   ├── SKILL.md
│   │   └── references/
│   ├── isp-extraction/                   # AGENT-08: ISP Extraction
│   │   ├── SKILL.md
│   │   └── references/
│   ├── opening-plan-v2/                  # AGENT-12: Opening Plan v2
│   │   ├── SKILL.md
│   │   └── references/
│   ├── dd-report-assembly/               # AGENT-13: DD Report Assembly
│   │   ├── SKILL.md
│   │   └── references/
│   └── ops-skills/                       # Submodule → EDU-Ops-Team/Ops-Skills
│       ├── ease-of-conversion/           #   AGENT-02: AI SIR Generation (standalone)
│       └── school-approval/              #   AGENT-03: School Approval (standalone)
├── scripts/                              # Deterministic work units
│   ├── shared/                           # Shared infrastructure
│   │   ├── types.ts                      #   All 15 Sindri + RHODES types
│   │   ├── sindri.ts                     #   Sindri client (read/write pipeline data)
│   │   ├── rhodes.ts                     #   RHODES client (business data writes)
│   │   ├── config.ts                     #   Pipeline config (deadlines, endpoints, etc.)
│   │   ├── errors.ts                     #   Custom error classes
│   │   ├── retry.ts                      #   Retry wrapper for flaky externals
│   │   └── index.ts                      #   Barrel export
│   ├── wu-01/intake.ts                   # New Site Intake
│   ├── wu-04/vendor-dispatch.ts          # Vendor Dispatch (CDS + Worksmith)
│   ├── wu-05/presentation.ts            # Location Presentation (9-slide deck)
│   ├── wu-09/delta.ts                    # Delta Computation (flatten + compare)
│   ├── wu-10/raycon.ts                   # RayCon Cost Estimates
│   ├── wu-11/shovels.ts                  # Shovels Permit History
│   └── wu-14/distribution.ts            # Report Distribution
├── docs/
│   ├── sindri-work-unit-decomposition.md # Full specifications for all 14 WUs
│   ├── diagrams/
│   │   ├── process-flow.html            # Interactive process flow diagram
│   │   └── process-flow-diagram.md      # Mermaid source
│   └── examples/
│       └── prototype-worksmith-checklist-tampa.md
├── tsconfig.json                         # TypeScript config (scripts only)
└── .gitmodules                           # Submodule config for ops-skills
```

---

## Shared Script Infrastructure

All scripts import from `scripts/shared/`. Key modules:

| Module | What It Does |
|---|---|
| `types.ts` | Every Sindri and RHODES type used across work units (15 interfaces). Scripts import from here — never define their own. |
| `sindri.ts` | Client for reading and writing pipeline data. `get<T>(key)` and `set<T>(key, data)`. |
| `rhodes.ts` | Client for writing to the business data layer. Only used when data needs long-term storage. |
| `config.ts` | Pipeline constants: school year deadline, vendor endpoints, Drive folder structure, Shovels API config. |
| `errors.ts` | Custom error classes: `UpstreamNotReady`, `ExternalApiError`, `ValidationError`, `RhodesWriteError`. |
| `retry.ts` | `withRetry(fn, opts)` wrapper for external API calls. Exponential backoff with configurable max retries. |

### Script Conventions

Every script follows the same structure:

```typescript
/**
 * WU-XX: <Name>
 *
 * <One-paragraph description of what this work unit does.>
 *
 * Invoking event: <what triggers this script>
 * Connectors: <external APIs or services used>
 *
 * Sindri data in:  <upstream records read>
 * Sindri data out: <record this script writes>
 * RHODES write:    <RHODES method, or "none">
 */

import type { SindriClient } from "../shared/sindri";
import type { RhodesClient } from "../shared/rhodes";
import type { ... } from "../shared/types";
import { PIPELINE_CONFIG } from "../shared/config";
import { UpstreamNotReady, ExternalApiError } from "../shared/errors";
import { withRetry } from "../shared/retry";
```

---

## Adding a New Pipeline Skill

When a new work unit needs an agent (reads unstructured text, makes judgment calls), follow these steps:

### 1. Create the Skill Directory

```bash
mkdir -p skills/<skill-name>/references
```

Use kebab-case for the directory name. It should match the skill's purpose (e.g., `zoning-letter-extraction`, not `wu-15`).

### 2. Write SKILL.md

Every SKILL.md follows this structure:

```markdown
# <Skill Name> (WU-XX)

## Purpose
One paragraph: what this agent does, what it reads, what it produces.
State what it does NOT do (no web searches, no re-running upstream skills, etc.).

## Pipeline Position
ASCII diagram showing where this skill sits in the pipeline.
Show upstream inputs and downstream consumers.

## Inputs
Table of all inputs with Source (which Sindri record) and Required (yes/no).
Include validation rules (address matching, required field checks).

## Output Schema
The exact Sindri record shape this agent writes.
Use TypeScript interface syntax matching scripts/shared/types.ts.

## Processing Rules
Numbered list of extraction/transformation rules.
Be explicit — the agent follows these literally.

## Error Handling
What to do when inputs are missing, malformed, or contradictory.
Define fallback behavior for every failure mode.

## Quality Checks
Validation the agent runs on its own output before writing to Sindri.
```

### 3. Add Reference Files

Put supporting material in `references/`:

- **Schemas** (`.json`) — structured output schemas, shared field definitions
- **Walkthroughs** (`.md`) — step-by-step extraction examples with real data
- **Term maps** (`.md`) — vendor-specific terminology translations
- **Templates** (`.md`) — output templates or document structure specs

Reference files are loaded by the agent at runtime. Keep them focused — one concept per file.

### 4. Add the Type to `scripts/shared/types.ts`

Even though skills don't import TypeScript directly, the Sindri record shape must be defined in `types.ts` so downstream scripts can read it:

```typescript
// ─── <Skill Name> (WU-XX output) ──────────────────────────────────────────

export interface YourNewRecord {
  site_id: string;
  // ... fields matching the Output Schema in SKILL.md
}
```

### 5. Update Documentation

- **`docs/sindri-work-unit-decomposition.md`** — add a full WU spec section following the existing format
- **`docs/diagrams/process-flow.html`** — add the node to the interactive diagram
- **`docs/diagrams/process-flow-diagram.md`** — add to the Mermaid source
- **This README** — add to the Architecture diagram and Status table

### 6. Checklist

Before committing:

- [ ] `SKILL.md` has Purpose, Pipeline Position, Inputs, Output Schema, Processing Rules, Error Handling, Quality Checks
- [ ] Reference files exist and are linked from SKILL.md
- [ ] Output type added to `scripts/shared/types.ts`
- [ ] Decomposition doc updated with full WU spec
- [ ] Process flow diagrams updated (both HTML and Mermaid)
- [ ] README Architecture diagram and Status table updated

---

## Adding a New Script

For deterministic work units (no unstructured text, no judgment calls):

### 1. Create the Script

```bash
mkdir -p scripts/wu-XX
```

Write your script following the conventions in [Script Conventions](#script-conventions). Import all types from `scripts/shared/types.ts` and all utilities from `scripts/shared/`.

### 2. Add the Type

Add your Sindri output type to `scripts/shared/types.ts`.

### 3. Update Documentation

Same docs as skills: decomposition doc, diagrams, and this README.

---

## Key Design Decisions

- **Vendor > AI precedence** — for every field where both sources exist, vendor data wins.
- **All SIR data required** — the DD Report won't generate until AI SIR, vendor SIR, inspection, ISP, cost estimates, and Opening Plan are all complete.
- **Recommended Path inferred** — capacity-per-dollar ratio among scenarios that can complete before the school year deadline.
- **No fabricated timelines** — dates come from the Opening Plan. Missing data gets a gap label saying what's needed.
- **Human-readable output** — every support document produces both structured JSON (Sindri) and a readable document (Drive).
- **School-approval feeds Opening Plan** — WU-03 output is pre-enriched input for WU-12's education regulatory section.
- **Pipeline skills in-repo, standalone skills via submodule** — skills that only run as pipeline work units live here. Skills that can run independently live in Ops-Skills so other teams can use them without pulling the pipeline.

---

## Status

| Component | Type | Location | Status |
|---|---|---|---|
| New Site Intake (WU-01) | Script | `scripts/wu-01/` | Complete |
| AI SIR Generation (WU-02) | Agent | `skills/ops-skills/ease-of-conversion/` | Complete (standalone) |
| School Approval (WU-03) | Agent | `skills/ops-skills/school-approval/` | Complete (standalone) |
| Vendor Dispatch (WU-04) | Script | `scripts/wu-04/` | Complete |
| Location Presentation (WU-05) | Script | `scripts/wu-05/` | Complete |
| CDS Verification Extraction (WU-06) | Agent | `skills/cds-verification-extraction/` | Complete — pending vendor samples |
| Vendor BI Extraction (WU-07) | Agent | `skills/vendor-bi-extraction/` | Complete — pending vendor samples |
| ISP Extraction (WU-08) | Agent | `skills/isp-extraction/` | Complete |
| Delta Computation (WU-09) | Script | `scripts/wu-09/` | Complete |
| RayCon Cost Estimates (WU-10) | Script | `scripts/wu-10/` | Complete |
| Shovels Permit History (WU-11) | Script | `scripts/wu-11/` | Complete |
| Opening Plan v2 (WU-12) | Agent | `skills/opening-plan-v2/` | Complete (v2.2) |
| DD Report Assembly (WU-13) | Agent | `skills/dd-report-assembly/` | Complete |
| Report Distribution (WU-14) | Script | `scripts/wu-14/` | Complete |
| Work unit decomposition | Docs | `docs/sindri-work-unit-decomposition.md` | Complete (all 14 specs) |
