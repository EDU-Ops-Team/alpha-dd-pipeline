/**
 * WU-09: Delta Computation
 *
 * Compares AI extraction vs. vendor extraction field-by-field for either the
 * SIR or the building inspection, producing a structured diff used for
 * accuracy benchmarking and conflict detection.
 *
 * Invoking event: UpstreamCompleted from WU-06 (sir_vendor) or WU-07
 * (inspection_vendor), when the corresponding AI version already exists.
 *
 * Connectors: None — pure computation on Sindri data.
 *
 * Sindri data in:  sir_ai + sir_vendor  OR  inspection_ai + inspection_vendor
 * Sindri data out: sir_delta            OR  inspection_delta
 */

import type { SindriClient } from "../shared/sindri";
import type {
  DeltaSeverity,
  DeltaConflict,
  SirDelta,
  InspectionDelta,
  SirAi,
  SirVendor,
  InspectionVendor,
} from "../shared/types";
import { PIPELINE_CONFIG } from "../shared/config";
import { UpstreamNotReady } from "../shared/errors";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Which pair of documents to diff */
export type DeltaType = "sir" | "inspection";

/** Injected dependencies for testability */
export interface ComputeDeltaDeps {
  sindri: SindriClient;
}

/**
 * A flat, primitive-or-string representation of any value for comparison.
 * Arrays are serialised to a stable JSON string so element order matters.
 */
type ScalarValue = string | number | boolean | null;

/** One row in the internal field-by-field walk */
interface FieldRow {
  path: string;
  aiValue: ScalarValue | undefined;
  vendorValue: ScalarValue | undefined;
}

// ─── Severity Lookup ────────────────────────────────────────────────────────

/**
 * Build a fast path-to-severity index from PIPELINE_CONFIG.DELTA_SEVERITY.
 * The config maps severity → string[] of field name fragments; we invert it
 * so we can look up a full dot-path in O(1).
 */
function buildSeverityIndex(): Map<string, DeltaSeverity> {
  const index = new Map<string, DeltaSeverity>();
  for (const [severity, fields] of Object.entries(
    PIPELINE_CONFIG.DELTA_SEVERITY
  )) {
    for (const field of fields) {
      index.set(field, severity as DeltaSeverity);
    }
  }
  return index;
}

const SEVERITY_INDEX = buildSeverityIndex();

/**
 * Resolve the severity of a conflict for a given field path.
 *
 * Match strategy (most-specific wins):
 *  1. Exact full path match (e.g. "feasibility.sprinkler_trigger")
 *  2. Last path segment match (e.g. "sprinkler_required")
 *  3. Default → "low"
 */
function resolveSeverity(fieldPath: string): DeltaSeverity {
  if (SEVERITY_INDEX.has(fieldPath)) {
    return SEVERITY_INDEX.get(fieldPath)!;
  }
  const lastSegment = fieldPath.split(".").pop() ?? fieldPath;
  if (SEVERITY_INDEX.has(lastSegment)) {
    return SEVERITY_INDEX.get(lastSegment)!;
  }
  return "low";
}

// ─── Object Flattening ──────────────────────────────────────────────────────

/**
 * Recursively flatten a nested object into dot-path → scalar entries.
 * Arrays are kept as a serialised JSON string so they can be compared
 * as a unit (preserves order semantics for ordered lists like authority_chain).
 */
function flattenObject(
  obj: Record<string, unknown>,
  prefix = ""
): Map<string, ScalarValue> {
  const result = new Map<string, ScalarValue>();

  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) {
      result.set(path, null);
    } else if (Array.isArray(value)) {
      // Serialise arrays to a stable JSON string for scalar comparison
      result.set(path, JSON.stringify(value));
    } else if (typeof value === "object") {
      const nested = flattenObject(
        value as Record<string, unknown>,
        path
      );
      for (const [nestedPath, nestedValue] of nested) {
        result.set(nestedPath, nestedValue);
      }
    } else {
      result.set(path, value as ScalarValue);
    }
  }

  return result;
}

// ─── Core Comparison Engine ─────────────────────────────────────────────────

/**
 * Compare two objects field-by-field using flattened dot-paths.
 *
 * Returns the four buckets (matches, conflicts, vendorOnly, aiOnly) that
 * make up a delta document.  Works on any flat or nested structure.
 */
function compareObjects(
  aiObj: Record<string, unknown>,
  vendorObj: Record<string, unknown>
): {
  matches: string[];
  conflicts: DeltaConflict[];
  vendorOnly: string[];
  aiOnly: string[];
} {
  const aiFlat = flattenObject(aiObj);
  const vendorFlat = flattenObject(vendorObj);

  const allPaths = new Set<string>([
    ...aiFlat.keys(),
    ...vendorFlat.keys(),
  ]);

  const matches: string[] = [];
  const conflicts: DeltaConflict[] = [];
  const vendorOnly: string[] = [];
  const aiOnly: string[] = [];

  for (const path of allPaths) {
    const hasAi = aiFlat.has(path);
    const hasVendor = vendorFlat.has(path);

    if (hasAi && hasVendor) {
      const aiVal = aiFlat.get(path)!;
      const vendorVal = vendorFlat.get(path)!;

      // Normalise comparison: treat null and undefined as equivalent,
      // and coerce numbers to strings for loose equality across sources.
      const normAi = aiVal === null ? null : String(aiVal);
      const normVendor = vendorVal === null ? null : String(vendorVal);

      if (normAi === normVendor) {
        matches.push(path);
      } else {
        conflicts.push({
          field: path,
          ai_value: normAi ?? "null",
          vendor_value: normVendor ?? "null",
          severity: resolveSeverity(path),
        });
      }
    } else if (hasVendor && !hasAi) {
      vendorOnly.push(path);
    } else if (hasAi && !hasVendor) {
      aiOnly.push(path);
    }
  }

  return { matches, conflicts, vendorOnly, aiOnly };
}

/**
 * Compute the agreement rate: matches / (matches + conflicts).
 * Returns 1.0 when there are no fields to compare (vacuously true).
 */
function computeAgreementRate(
  matchCount: number,
  conflictCount: number
): number {
  const denominator = matchCount + conflictCount;
  if (denominator === 0) return 1.0;
  return parseFloat((matchCount / denominator).toFixed(4));
}

// ─── Projection Helpers ─────────────────────────────────────────────────────

/**
 * Extract the comparable scalar fields from a SirAi document.
 * Excludes pipeline-internal fields that are not meaningful to diff
 * (e.g. report_url, confidence_labels, unknowns arrays).
 */
function projectSirAi(sir: SirAi): Record<string, unknown> {
  return {
    address: sir.address,
    score: sir.score,
    rating: sir.rating,
    recommendation: sir.recommendation,
    e_occupancy_score: sir.e_occupancy_score,
    e_occupancy_rating: sir.e_occupancy_rating,
    zoning_status: sir.zoning_status,
    permit_type: sir.permit_type,
    timeline_best_weeks: sir.timeline_best_weeks,
    timeline_worst_weeks: sir.timeline_worst_weeks,
    cost_range_low: sir.cost_range_low,
    cost_range_high: sir.cost_range_high,
    authority_chain: sir.authority_chain,
    code_framework: sir.code_framework,
    feasibility: sir.feasibility,
  };
}

/**
 * Extract the comparable scalar fields from a SirVendor document.
 * Excludes vendor-specific metadata (source_doc_url, verification_summary,
 * verified_items, new_findings, vendor_notes) that have no AI counterpart.
 */
function projectSirVendor(sir: SirVendor): Record<string, unknown> {
  return {
    address: sir.address,
    zoning_status: sir.zoning_status,
    permit_type: sir.permit_type,
    timeline_best_weeks: sir.timeline_best_weeks,
    timeline_worst_weeks: sir.timeline_worst_weeks,
    authority_chain: sir.authority_chain,
    code_framework: sir.code_framework,
    feasibility: sir.feasibility,
  };
}

/**
 * Extract comparable scalar fields from an InspectionVendor document.
 * Focuses on the fields that the AI inspection is expected to produce:
 * overall recommendation, deal-killer flags, occupant load, and deficiency
 * summary.  Detailed section items are compared as serialised arrays.
 */
function projectInspectionVendor(
  inspection: InspectionVendor
): Record<string, unknown> {
  return {
    address: inspection.address,
    overall_recommendation: inspection.overall_recommendation,
    deal_killer_flags: inspection.deal_killer_flags,
    occupant_load: inspection.occupant_load,
    deficiency_summary: inspection.deficiency_summary,
    // Flatten section-level items for comparison
    sections_exterior_site: inspection.sections.exterior_site.items,
    sections_parking_dropoff: inspection.sections.parking_dropoff.items,
    sections_entry_egress: inspection.sections.entry_egress.items,
    sections_fire_alarm: inspection.sections.fire_alarm.items,
    sections_sprinkler: inspection.sections.sprinkler.items,
    sections_emergency_systems: inspection.sections.emergency_systems.items,
    sections_restrooms_plumbing:
      inspection.sections.restrooms_plumbing.items,
    sections_ada: inspection.sections.ada.items,
    sections_structural: inspection.sections.structural.items,
    sections_hvac_mechanical: inspection.sections.hvac_mechanical.items,
    sections_electrical: inspection.sections.electrical.items,
  };
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * Compare AI extraction vs. vendor extraction for either the SIR or the
 * building inspection, producing a structured delta document.
 *
 * For SIR: reads `sir_ai` and `sir_vendor` from Sindri, diffs the shared
 * comparable fields, and writes `sir_delta`.
 *
 * For inspection: reads `inspection_vendor` and `sir_ai` (as a stand-in for
 * inspection_ai — the AI-prefilled values stored inside InspectionVendor),
 * and writes `inspection_delta`.
 *
 * @param siteId    - The Sindri site identifier
 * @param deltaType - Which pair to diff: "sir" | "inspection"
 * @param deps      - Injected clients (sindri)
 *
 * @throws {UpstreamNotReady} if required upstream data is absent
 */
export async function computeDelta(
  siteId: string,
  deltaType: DeltaType,
  deps: ComputeDeltaDeps
): Promise<void> {
  const { sindri } = deps;

  if (deltaType === "sir") {
    await computeSirDelta(siteId, sindri);
  } else {
    await computeInspectionDelta(siteId, sindri);
  }
}

// ─── SIR Delta ───────────────────────────────────────────────────────────────

async function computeSirDelta(
  siteId: string,
  sindri: SindriClient
): Promise<void> {
  // 1. Read upstream documents
  const [sirAi, sirVendor] = await Promise.all([
    sindri.read(siteId, "sir_ai"),
    sindri.read(siteId, "sir_vendor"),
  ]);

  const missing: string[] = [];
  if (!sirAi) missing.push("sir_ai");
  if (!sirVendor) missing.push("sir_vendor");
  if (missing.length > 0) {
    throw new UpstreamNotReady("WU-09", siteId, missing);
  }

  // 2. Project to comparable shape
  const aiProjection = projectSirAi(sirAi!);
  const vendorProjection = projectSirVendor(sirVendor!);

  // 3. Compare field-by-field
  const { matches, conflicts, vendorOnly, aiOnly } = compareObjects(
    aiProjection,
    vendorProjection
  );

  // 4. Build delta document
  const sirDelta: SirDelta = {
    computed_at: new Date().toISOString(),
    matches,
    conflicts,
    vendor_only: vendorOnly,
    ai_only: aiOnly,
    agreement_rate: computeAgreementRate(matches.length, conflicts.length),
  };

  // 5. Write to Sindri
  await sindri.write(siteId, "sir_delta", sirDelta);
}

// ─── Inspection Delta ─────────────────────────────────────────────────────────

async function computeInspectionDelta(
  siteId: string,
  sindri: SindriClient
): Promise<void> {
  // 1. Read upstream document — inspection_vendor is required
  const inspectionVendor = await sindri.read(siteId, "inspection_vendor");
  if (!inspectionVendor) {
    throw new UpstreamNotReady("WU-09", siteId, ["inspection_vendor"]);
  }

  // 2. The AI "inspection" is represented by the ai_prefill values embedded
  //    inside each InspectionItem.  We extract those alongside the confirmed
  //    vendor findings to create two comparable projections.
  const aiProjection = extractAiPrefillProjection(inspectionVendor);
  const vendorProjection = projectInspectionVendor(inspectionVendor);

  // 3. Compare field-by-field
  const { matches, conflicts, vendorOnly, aiOnly } = compareObjects(
    aiProjection,
    vendorProjection
  );

  // 4. Build delta document
  const inspectionDelta: InspectionDelta = {
    computed_at: new Date().toISOString(),
    matches,
    conflicts,
    vendor_only: vendorOnly,
    ai_only: aiOnly,
    agreement_rate: computeAgreementRate(matches.length, conflicts.length),
  };

  // 5. Write to Sindri
  await sindri.write(siteId, "inspection_delta", inspectionDelta);
}

/**
 * Extract the AI-prefill values from an InspectionVendor document,
 * building a comparable projection keyed identically to
 * projectInspectionVendor so the two projections can be diffed.
 *
 * When an item has no ai_prefill the field is omitted (→ vendor_only).
 */
function extractAiPrefillProjection(
  inspection: InspectionVendor
): Record<string, unknown> {
  const projection: Record<string, unknown> = {
    address: inspection.address,
    overall_recommendation: inspection.overall_recommendation,
    deal_killer_flags: inspection.deal_killer_flags,
    occupant_load: inspection.occupant_load,
    deficiency_summary: inspection.deficiency_summary,
  };

  // For each section, collect items that have an ai_prefill value
  const sectionMap: Record<
    string,
    keyof InspectionVendor["sections"]
  > = {
    sections_exterior_site: "exterior_site",
    sections_parking_dropoff: "parking_dropoff",
    sections_entry_egress: "entry_egress",
    sections_fire_alarm: "fire_alarm",
    sections_sprinkler: "sprinkler",
    sections_emergency_systems: "emergency_systems",
    sections_restrooms_plumbing: "restrooms_plumbing",
    sections_ada: "ada",
    sections_structural: "structural",
    sections_hvac_mechanical: "hvac_mechanical",
    sections_electrical: "electrical",
  };

  for (const [projKey, sectionKey] of Object.entries(sectionMap)) {
    const items = inspection.sections[sectionKey].items;
    // Build a parallel array of ai_prefill values (null where absent)
    const aiItems = items.map((item) => ({
      item: item.item,
      ai_prefill: item.ai_prefill,
    }));
    // Only include the section in the AI projection if at least one
    // item has a non-null prefill — otherwise it's a vendor-only section
    if (aiItems.some((i) => i.ai_prefill !== null)) {
      projection[projKey] = aiItems;
    }
  }

  return projection;
}
