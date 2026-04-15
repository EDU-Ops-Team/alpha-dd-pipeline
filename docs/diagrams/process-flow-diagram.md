# DD Pipeline — Process Flow

> Interactive version: [process-flow.html](process-flow.html) (open locally or via GitHub Pages)

```mermaid
%%{ init: { "theme": "neutral", "flowchart": { "curve": "basis", "padding": 16, "nodeSpacing": 30, "rankSpacing": 50 } } }%%

flowchart TD

  %% ── Phase 1: Intake ──────────────────────────────────────────
  subgraph phase1 ["Phase 1 — Intake"]
    WU01["WU-01 · Script\nNew Site Intake\n📦 site_meta"]
  end

  %% ── Phase 2: Parallel Research ────────────────────────────────
  subgraph phase2 ["Phase 2 — Parallel Research"]
    WU02["WU-02 · Agent\nAI SIR Generation\n📦 sir_ai"]
    WU03["WU-03 · Agent\nSchool Approval\n📦 school_approval"]
    WU05["WU-05 · Script\nLocation Presentation\n📦 presentation_url"]
    WU11["WU-11 · Script\nShovels Permit History\n📦 permit_history"]
  end

  %% ── Phase 3: Vendor Dispatch ──────────────────────────────────
  subgraph phase3 ["Phase 3 — Vendor Dispatch"]
    WU04["WU-04 · Script\nVendor Dispatch\n(CDS + Worksmith)\n📦 vendor_packets_sent"]
  end

  %% ── Async boundary ────────────────────────────────────────────
  ASYNC:::asyncDivider

  %% ── Phase 4: Vendor Returns + ISP ─────────────────────────────
  subgraph phase4 ["Phase 4 — Vendor Returns + ISP"]
    WU06["WU-06 · Agent\nCDS Verification\nExtraction\n📦 sir_vendor"]
    WU07["WU-07 · Agent\nVendor BI Extraction\n📦 inspection_vendor"]
    WU08["WU-08 · Agent\nISP Extraction\n📦 isp_extract"]
  end

  %% ── Phase 5: Delta + Cost Processing ──────────────────────────
  subgraph phase5 ["Phase 5 — Delta + Cost Processing"]
    WU09["WU-09 · Script\nDelta Computation\n📦 sir_delta · inspection_delta"]
    WU10["WU-10 · Script\nRayCon Cost Estimates\n📦 cost_estimates"]
  end

  %% ── Phase 6: Plan + Report Assembly ───────────────────────────
  subgraph phase6 ["Phase 6 — Plan + Report Assembly"]
    WU12["WU-12 · Agent\nOpening Plan v2\n(two-pass + 5 research agents)\n📦 opening_plan"]
    WU13["WU-13 · Agent\nDD Report Assembly\n📦 dd_report"]
  end

  %% ── Phase 7: Distribution ─────────────────────────────────────
  subgraph phase7 ["Phase 7 — Distribution"]
    WU14["WU-14 · Script\nReport Distribution\n📦 distribution_log"]
  end

  %% ── Edges ─────────────────────────────────────────────────────

  %% Phase 1 → Phase 2
  WU01 --> WU02
  WU01 --> WU03
  WU01 --> WU05
  WU01 --> WU11

  %% Phase 2 → Phase 3
  WU02 --> WU04

  %% Async boundary
  WU04 -. "vendor returns (days/weeks)" .-> ASYNC
  ASYNC -. " " .-> WU06
  ASYNC -. " " .-> WU07

  %% Phase 3/4 → Phase 4
  WU04 --> WU06
  WU04 --> WU07

  %% Phase 4 → Phase 5
  WU06 --> WU09
  WU07 --> WU09
  WU08 --> WU10
  WU07 --> WU10

  %% Phase 2/5 → Phase 6 (Opening Plan v2 dependencies)
  WU02 --> WU12
  WU03 -->|"edu regulatory baseline"| WU12
  WU10 --> WU12
  WU06 --> WU12
  WU07 --> WU12

  %% Phase 6 internal + upstream → DD Report
  WU12 --> WU13
  WU09 --> WU13
  WU08 --> WU13
  WU03 --> WU13
  WU11 --> WU13

  %% Phase 6 → Phase 7
  WU13 --> WU14

  %% ── Styles ────────────────────────────────────────────────────

  classDef agent fill:#e8f4f5,stroke:#01696f,stroke-width:2px,color:#28251d
  classDef script fill:#faf0e8,stroke:#964219,stroke-width:2px,color:#28251d
  classDef asyncDivider fill:none,stroke:none,color:#bab9b4,font-size:11px

  class WU02,WU03,WU06,WU07,WU08,WU12,WU13 agent
  class WU01,WU04,WU05,WU09,WU10,WU11,WU14 script
  class ASYNC asyncDivider

  ASYNC["⏳ Vendor returns arrive async"]
```

## Legend

| Color | Type | Examples |
|---|---|---|
| Teal border | Agent (LLM) | WU-02 AI SIR, WU-03 School Approval, WU-12 Opening Plan v2 |
| Orange border | Script (Deterministic) | WU-01 Intake, WU-04 Vendor Dispatch, WU-10 RayCon |

## Key Dependency: School Approval → Opening Plan v2

WU-03 (School Approval) now feeds WU-12 (Opening Plan v2) directly. The school-approval output pre-populates 15 education regulatory fields (state archetype, approval type, gating status, calendar windows, etc.) so that Opening Plan v2's Research Agent 3 can deepen rather than rediscover the baseline.
