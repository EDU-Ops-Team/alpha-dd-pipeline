/**
 * DD Pipeline — Shared Sindri & RHODES Types
 *
 * Every Sindri data shape used across work units is defined here.
 * Scripts import these types rather than defining their own.
 */

// ─── Site Meta (WU-01 output) ──────────────────────────────────────────────

export type SchoolType = "micro" | "250" | "1000";
export type PipelineStage = "M1" | "M2" | "M3" | "M4" | "M5" | "M6";

export interface SiteMeta {
  site_id: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  school_type: SchoolType;
  drive_folder_url: string;
  loi_doc_url: string;
  p1_name: string | null;
  p1_email: string | null;
  stage: PipelineStage;
  created_at: string; // ISO timestamp
}

// ─── Authority Chain (shared across SIR types) ─────────────────────────────

export interface AuthorityContact {
  authority: string;
  name: string;
  role: string;
  contact: string;
}

// ─── Code Framework (shared across SIR types) ──────────────────────────────

export interface CodeFramework {
  building_code: string;
  fire_code: string;
  health_code: string;
}

// ─── Feasibility (shared across SIR types) ─────────────────────────────────

export interface Feasibility {
  occupancy_compatibility: string;
  sprinkler_trigger: boolean;
  bathroom_requirement: string;
  construction_scope: string[];
}

// ─── AI SIR (WU-02 output) ─────────────────────────────────────────────────

export type ConfidenceLevel = "A" | "B" | "C" | "D";
export type SirRating = "GREEN" | "YELLOW" | "ORANGE" | "RED";
export type Recommendation =
  | "PROCEED"
  | "PROCEED WITH CAUTION"
  | "REQUIRES JUSTIFICATION"
  | "PASS";

export interface SirAi {
  address: string;
  score: number;
  rating: SirRating;
  recommendation: Recommendation;
  e_occupancy_score: number;
  e_occupancy_rating: string;
  zoning_status: string;
  permit_type: string;
  timeline_best_weeks: number;
  timeline_worst_weeks: number;
  cost_range_low: number;
  cost_range_high: number;
  authority_chain: AuthorityContact[];
  code_framework: CodeFramework;
  feasibility: Feasibility;
  unknowns: SirUnknown[];
  report_url: string;
  confidence_labels: Record<string, ConfidenceLevel>;
}

export interface SirUnknown {
  item: string;
  why_it_matters: string;
  field_only: boolean;
}

// ─── School Approval (WU-03 output) ────────────────────────────────────────

export type ApprovalArchetype =
  | "MINIMAL"
  | "NOTIFICATION"
  | "APPROVAL_REQUIRED"
  | "HEAVILY_REGULATED"
  | "WINDOWED";

export type ApprovalZone = "green" | "yellow" | "red";

export type ApprovalType =
  | "NONE"
  | "REGISTRATION_SIMPLE"
  | "LOCAL_APPROVAL_REQUIRED"
  | "LICENSE_REQUIRED"
  | "CERTIFICATE_OR_APPROVAL_REQUIRED"
  | "COMPLEX_OR_OVERSIGHT";

export interface SchoolApproval {
  state: string;
  archetype: ApprovalArchetype;
  zone: ApprovalZone;
  score_0_100: number;
  ease_score_0_10: number;
  approval_type: ApprovalType;
  gating_before_open: boolean;
  timeline_days_preopen: {
    min: number;
    likely: number;
    max: number;
  };
  requirements_summary: string;
  requirements_steps: Array<{
    step: string;
    gating: boolean;
  }>;
  preopen_requirements: {
    teacher_certification_required: boolean;
    curriculum_approval_required: boolean;
    health_safety_inspection_required: boolean;
    background_check_required: boolean;
    financial_reserve_required: boolean;
  };
  calendar_window: {
    next_window_date: string | null;
    submission_deadline: string | null;
    calendar_risk: boolean;
  };
  local_requirements: {
    has_local_overlay: boolean;
    local_notes: string;
  };
  source_urls: string[];
  confidence_0_1: number;
}

// ─── Vendor Packets Sent (WU-04 output) ────────────────────────────────────

export interface VendorPacketsSent {
  cds_email_sent_at: string;
  cds_recipient: string;
  cds_report_url: string;
  cds_bc_item_count: number;
  worksmith_email_sent_at: string;
  worksmith_recipient: string;
  worksmith_checklist_url: string;
  worksmith_checklist_item_count: number;
  worksmith_prefill_count: number;
  worksmith_appended_task_count: number;
}

// ─── Presentation URL (WU-05 output) ───────────────────────────────────────

export interface PresentationOutput {
  presentation_url: string;
}

// ─── Vendor SIR (WU-06 output) ─────────────────────────────────────────────

export type VerificationStatus = "confirmed" | "corrected" | "unverified";

export interface VerifiedItem {
  claim_id: string;
  field: string;
  ai_finding: string;
  ai_confidence: "B" | "C";
  cds_finding: string;
  cds_source: string;
  cds_confidence: "A" | "B";
  status: VerificationStatus;
}

export interface NewFinding {
  field: string;
  finding: string;
  source: string;
  section: string;
}

export interface VerificationSummary {
  total_bc_items: number;
  verified_count: number;
  confirmed_count: number;
  corrected_count: number;
  unverified_count: number;
  new_findings_count: number;
}

export interface SirVendor {
  extracted_at: string;
  source_doc_url: string;
  address: string;
  zoning_status: string;
  permit_type: string;
  timeline_best_weeks: number;
  timeline_worst_weeks: number;
  authority_chain: AuthorityContact[];
  code_framework: CodeFramework;
  feasibility: Feasibility;
  verification_summary: VerificationSummary;
  verified_items: VerifiedItem[];
  new_findings: NewFinding[];
  vendor_notes: string;
}

// ─── Vendor Building Inspection (WU-07 output) ─────────────────────────────

export type DealKillerValue = "yes" | "no" | "needs_evaluation";
export type InspectionRecommendation =
  | "PROCEED"
  | "PROCEED WITH CAUTION"
  | "REQUIRES JUSTIFICATION"
  | "PASS";
export type DeficiencyPriority = "CRITICAL" | "IMPORTANT" | "MINOR";

export interface DealKillerFlags {
  safe_dropoff: DealKillerValue;
  adequate_exits: DealKillerValue;
  exit_doors_compliant: DealKillerValue;
  structurally_sound: DealKillerValue;
  no_hazmat_visible: DealKillerValue;
  any_no: boolean;
}

export interface InspectionItem {
  item: string;
  ai_prefill: string | null;
  confirmed: boolean;
  finding: string | null;
  source_citation: string | null;
  notes: string | null;
  claim_id: string | null;
}

export interface InspectionSection {
  items: InspectionItem[];
}

export interface CostEstimateItem {
  item: string;
  description: string;
  priority: DeficiencyPriority;
  low_estimate: number | null;
  high_estimate: number | null;
  notes: string | null;
}

export interface DeficiencySummary {
  critical_count: number;
  important_count: number;
  minor_count: number;
  total_remediation_low: number;
  total_remediation_high: number;
}

export interface SpecialistReferral {
  type:
    | "structural engineer"
    | "MEP engineer"
    | "fire protection engineer"
    | "environmental"
    | "other";
  reason: string;
}

export interface SiteSpecificTask {
  task_number: number;
  task: string;
  finding: string | null;
  documentation: string | null;
}

export interface OccupantLoad {
  net_floor_area_sf: number | null;
  total_occupant_load: number | null;
  net_learning_area_sf: number | null;
  student_capacity: number | null;
}

export interface InspectionVendor {
  extracted_at: string;
  source_doc_url: string;
  address: string;
  inspector_name: string;
  inspection_date: string;
  overall_recommendation: InspectionRecommendation;
  deal_killer_flags: DealKillerFlags;
  sections: {
    exterior_site: InspectionSection;
    parking_dropoff: InspectionSection;
    entry_egress: InspectionSection;
    fire_alarm: InspectionSection;
    sprinkler: InspectionSection;
    emergency_systems: InspectionSection;
    restrooms_plumbing: InspectionSection;
    ada: InspectionSection;
    structural: InspectionSection;
    hvac_mechanical: InspectionSection;
    electrical: InspectionSection;
  };
  occupant_load: OccupantLoad;
  cost_estimates: CostEstimateItem[];
  deficiency_summary: DeficiencySummary;
  specialist_referrals: SpecialistReferral[];
  site_specific_tasks: SiteSpecificTask[];
  vendor_notes: string;
}

// ─── ISP Extract (WU-08 output) ────────────────────────────────────────────

export interface IspExtract {
  extracted_at: string;
  source_doc_url: string;
  address: string;
  building_code_info: {
    building_code: string;
    occupancy_classification: string;
    jurisdiction: string;
    amendments: string | null;
    sprinkler_system: boolean;
    total_occupant_load: number;
    gross_floor_area_sf: number;
  };
  executive_summary: {
    program_fit_score: number;
    program_fit_rating: "GOOD FIT" | "MARGINAL FIT" | "POOR FIT";
    requirements_met: string;
    requirements_score: string | null;
    quality_score: string | null;
    total_rooms: number;
    rooms_assigned: number;
    rooms_unassigned: number;
    target_capacity: number | null;
    recommended_capacity: number;
    avg_fit_score_pct: number;
    best_tier_met: string;
  };
  capacity_analysis: {
    grade_span: string;
    guides_required: number;
    recommended_capacity: number;
    gross_ceiling_capacity: number | null;
    nla_capacity: number | null;
    effective_sf_per_student: number | null;
    sharing_penalty: string;
    space_requirements: {
      workshop: "Met" | "Not Met";
      one_on_one_meeting: "Met" | "Not Met";
      play_area: "Met" | "Not Met";
      dining_commons: "Met" | "Not Met";
    };
  };
  classroom_assignments: Array<{
    room_id: string;
    level: string;
    students: number;
    area_sf: number;
  }>;
  level_totals: Array<{
    level: string;
    room_count: number;
    total_students: number;
  }>;
  tier_evaluation: Array<{
    tier: string;
    meets: boolean;
    required_met: string;
    assignment_pct: number;
    fit_pct: number;
    missing: string | null;
  }>;
  ada_precheck: {
    score: number;
    errors: number;
    warnings: number;
    violations_by_rule: Array<{
      rule: string;
      count: number;
      severity_breakdown: string;
    }>;
    violations: Array<{
      severity: "ERROR" | "WARNING";
      location: string;
      rule: string;
      actual: string | null;
      required: string | null;
      description: string;
    }>;
  };
  ibc_compliance: {
    score: number;
    errors: number;
    warnings: number;
    total_occupant_load: number;
    occupant_load_by_room: Array<{
      room_id: string;
      type: string;
      area_sf: number;
      factor: number;
      method: "net" | "gross";
      load: number;
    }>;
    plumbing_fixtures: {
      water_closets_male: { required: number; notes: string };
      water_closets_female: { required: number; notes: string };
      lavatories: { required: number; notes: string };
      drinking_fountains: { required: number; notes: string };
    };
    plumbing_summary: string | null;
    violations: Array<{
      severity: "ERROR" | "WARNING" | "INFO";
      rule: string;
      description: string;
    }>;
  };
  adjacency_compliance: {
    score: number;
    critical_count: number;
    high_count: number;
    medium_count: number;
    violations: Array<{
      priority: "Critical" | "High" | "Medium";
      rule_number: number;
      room_types: string;
      relationship: string;
      detail: string;
    }>;
  };
  requirement_status: Array<{
    room_type: string;
    required: string;
    assigned: number;
    status: "Met" | "Not Met";
  }>;
  optimization_proposals: Array<{
    number: number;
    action: string;
    rooms: string;
    result_type: string | null;
    result_sf: number | null;
    reason: string;
    priority: string;
    fit_delta: number;
  }>;
  room_schedule: Array<{
    room_id: string;
    floor: string;
    assignment: string;
    area_sf: number;
    dimensions: string | null;
    occupant_load: number | null;
    fit_score_pct: number | null;
  }>;
  door_schedule: Array<{
    door_id: string;
    floor: string;
    width_in: number;
    height_in: number;
    notes: string | null;
  }>;
}

// ─── Delta (WU-09 output) ──────────────────────────────────────────────────

export type DeltaSeverity = "high" | "medium" | "low";

export interface DeltaConflict {
  field: string;
  ai_value: string;
  vendor_value: string;
  severity: DeltaSeverity;
}

export interface SirDelta {
  computed_at: string;
  matches: string[];
  conflicts: DeltaConflict[];
  vendor_only: string[];
  ai_only: string[];
  agreement_rate: number;
}

export interface InspectionDelta {
  computed_at: string;
  matches: string[];
  conflicts: DeltaConflict[];
  vendor_only: string[];
  ai_only: string[];
  agreement_rate: number;
}

// ─── Cost Estimates (WU-10 output) ─────────────────────────────────────────

export interface CostLineItem {
  item: string;
  cost: number;
}

export interface CostScenario {
  name: string;
  total: number;
  line_items: CostLineItem[];
}

export interface CostEstimates {
  computed_at: string;
  inspection_source: "vendor" | "ai";
  scenarios: CostScenario[];
}

// ─── Permit History (WU-11 output) ─────────────────────────────────────────

export interface Permit {
  permit_number: string;
  type: string;
  status: string;
  issued_date: string;
  description: string;
}

export interface PermitHistory {
  queried_at: string;
  address: string;
  permits: Permit[];
  total_permits: number;
}

// ─── Opening Plan (WU-12 output) ───────────────────────────────────────────

export interface OpeningPlanScenario {
  target_date: string;
  total_cost: number;
  weeks: number;
}

export interface GatingFactor {
  gate_id: string;
  name: string;
  gate_type:
    | "site_kill"
    | "hazmat"
    | "timeline_branch"
    | "scope_unknown"
    | "permit_cycle";
  resolved_when: string;
  good_outcome: string;
  bad_outcome: string;
}

export interface OpeningPlan {
  generated_at: string;
  skill_version: string;
  recommendation: "Go" | "No Go" | "Conditional Go";
  scenarios: {
    best: OpeningPlanScenario;
    realistic: OpeningPlanScenario;
    worst: OpeningPlanScenario;
  };
  gating_factors: GatingFactor[];
  deterministic_calculations: {
    hvac_ventilation_delta: {
      existing_cfm: number;
      required_cfm: number;
      multiplier: number;
      estimated_cost_low: number;
      estimated_cost_high: number;
    };
    elevator_required: boolean;
    hazmat_gate: {
      applicable: boolean;
      estimated_weeks: number;
    };
  };
  research_enrichment_summary: {
    fields_enriched: number;
    sir_confirmed: number;
    sir_contradicted: number;
    sir_gaps_filled: number;
    named_contacts_found: number;
    conflicting_standards: string[];
  };
  edu_regulatory: {
    archetype: string;
    gating_before_open: boolean;
    calendar_window: string | null;
    equivalency_pathways: string[];
    denial_precedents: string[];
  };
  risks: Array<{
    track: string;
    risk: string;
    trigger: string;
    impact: string;
    mitigations: string[];
  }>;
  report_url: string;
  data_sources_used: {
    sir_source: "vendor" | "ai";
    inspection_source: "vendor" | "ai";
    school_approval_used: boolean;
  };
}

// ─── DD Report (WU-13 output) ──────────────────────────────────────────────

export interface DdReport {
  generated_at: string;
  doc_id: string;
  doc_url: string;
  version: number;
  score: number | null;
  recommendation: string;
  data_sources_used: {
    sir_source: "vendor" | "ai" | "both";
    inspection_source: "vendor" | "ai" | "both";
    cost_source: "raycon" | null;
    permit_source: "shovels" | null;
  };
  tokens_populated: number;
  tokens_missing: string[];
}

// ─── Distribution Log (WU-14 output) ───────────────────────────────────────

export interface DistributionLog {
  email_sent_at: string;
  recipients: string[];
  chat_notified_at: string;
  chat_space: string;
}

// ─── Sindri Data Keys ──────────────────────────────────────────────────────

/** All possible Sindri data keys produced by work units */
export type SindriKey =
  | "site_meta"
  | "sir_ai"
  | "school_approval"
  | "vendor_packets_sent"
  | "presentation_url"
  | "sir_vendor"
  | "inspection_vendor"
  | "isp_extract"
  | "sir_delta"
  | "inspection_delta"
  | "cost_estimates"
  | "permit_history"
  | "opening_plan"
  | "dd_report"
  | "distribution_log";

/** Maps Sindri keys to their TypeScript types */
export interface SindriDataMap {
  site_meta: SiteMeta;
  sir_ai: SirAi;
  school_approval: SchoolApproval;
  vendor_packets_sent: VendorPacketsSent;
  presentation_url: PresentationOutput;
  sir_vendor: SirVendor;
  inspection_vendor: InspectionVendor;
  isp_extract: IspExtract;
  sir_delta: SirDelta;
  inspection_delta: InspectionDelta;
  cost_estimates: CostEstimates;
  permit_history: PermitHistory;
  opening_plan: OpeningPlan;
  dd_report: DdReport;
  distribution_log: DistributionLog;
}
