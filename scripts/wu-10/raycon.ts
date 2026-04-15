/**
 * WU-10: RayCon Cost Estimates
 *
 * Calls the RayCon API with structured room-inventory and building-inspection
 * data to get cost estimates per build scenario.  Writes results to both
 * Sindri (pipeline layer) and RHODES (for finance and construction teams).
 *
 * Invoking event: Readiness check — `isp_extract` AND at least one of
 * `inspection_vendor` / `inspection_ai` must exist in Sindri.
 *
 * Connectors: RayCon API (https://api.raycon.com/v1)
 *
 * Sindri data in:  isp_extract, site_meta, inspection_vendor (preferred)
 *                  or inspection_ai (fallback)
 * Sindri data out: cost_estimates
 * RHODES write:    writeCostEstimates
 */

import type { SindriClient } from "../shared/sindri";
import type { RhodesClient } from "../shared/rhodes";
import type {
  IspExtract,
  InspectionVendor,
  CostEstimates,
  CostScenario,
  CostLineItem,
  SchoolType,
} from "../shared/types";
import { PIPELINE_CONFIG } from "../shared/config";
import { UpstreamNotReady, ExternalApiError } from "../shared/errors";
import { withRetry } from "../shared/retry";

// ─── RayCon Client Interface ─────────────────────────────────────────────────

/** A single room passed to the RayCon API */
export interface RayConRoom {
  room_id: string;
  floor: string;
  assignment: string;
  area_sf: number;
  occupant_load: number | null;
}

/** A single inspection finding passed to the RayCon API */
export interface RayConFinding {
  category: "structural" | "mep" | "ada" | "other";
  description: string;
  priority: "CRITICAL" | "IMPORTANT" | "MINOR";
  low_estimate: number | null;
  high_estimate: number | null;
}

/** The request payload sent to the RayCon /estimates endpoint */
export interface RayConRequest {
  address: string;
  school_type: SchoolType;
  rooms: RayConRoom[];
  findings: RayConFinding[];
  gross_floor_area_sf: number;
  total_occupant_load: number;
}

/** A single cost line item returned by RayCon */
export interface RayConLineItem {
  item: string;
  cost: number;
  notes: string | null;
}

/** A single scenario returned by RayCon */
export interface RayConScenario {
  name: string;
  total: number;
  line_items: RayConLineItem[];
}

/** The response from the RayCon /estimates endpoint */
export interface RayConResponse {
  request_id: string;
  generated_at: string;
  scenarios: RayConScenario[];
  warnings: string[];
}

/** Interface for the RayCon API client */
export interface RayConClient {
  /**
   * Request cost estimates for a site.
   * @throws on non-2xx responses
   */
  getEstimates(request: RayConRequest): Promise<RayConResponse>;
}

// ─── Injected Dependencies ───────────────────────────────────────────────────

/** Injected dependencies for testability */
export interface GetCostEstimatesDeps {
  sindri: SindriClient;
  rhodes: RhodesClient;
  raycon: RayConClient;
}

// ─── Request Builder ─────────────────────────────────────────────────────────

/**
 * Map InspectionVendor section items to RayCon findings, keeping only items
 * that have an actual finding (i.e. confirmed with non-null finding text).
 */
function extractFindings(
  inspection: InspectionVendor,
  category: "structural" | "mep" | "ada",
  sectionKeys: Array<keyof InspectionVendor["sections"]>
): RayConFinding[] {
  const findings: RayConFinding[] = [];

  for (const sectionKey of sectionKeys) {
    const section = inspection.sections[sectionKey];
    for (const item of section.items) {
      if (!item.confirmed || item.finding === null) continue;

      // Map DeficiencyPriority (from cost_estimates items) to InspectionItem
      // There is no per-item priority on InspectionItem — derive from section
      // category and use IMPORTANT as the safe default.
      findings.push({
        category,
        description: item.finding,
        priority: "IMPORTANT",
        low_estimate: null,
        high_estimate: null,
      });
    }
  }

  return findings;
}

/**
 * Build the RayCon API request payload from ISP extract, inspection data,
 * and site meta.
 */
function buildRayConRequest(
  address: string,
  schoolType: SchoolType,
  isp: IspExtract,
  inspection: InspectionVendor
): RayConRequest {
  // Room list from ISP room_schedule
  const rooms: RayConRoom[] = isp.room_schedule.map((room) => ({
    room_id: room.room_id,
    floor: room.floor,
    assignment: room.assignment,
    area_sf: room.area_sf,
    occupant_load: room.occupant_load,
  }));

  // Findings by category
  const structuralFindings = extractFindings(inspection, "structural", [
    "structural",
  ]);
  const mepFindings = extractFindings(inspection, "mep", [
    "hvac_mechanical",
    "electrical",
    "fire_alarm",
    "sprinkler",
    "restrooms_plumbing",
    "emergency_systems",
  ]);
  const adaFindings = extractFindings(inspection, "ada", ["ada"]);

  // Also pull from the inspection's own cost_estimates for richer data
  const detailedFindings: RayConFinding[] = inspection.cost_estimates.map(
    (est) => ({
      category: "other" as const,
      description: `${est.item}: ${est.description}`,
      priority: est.priority,
      low_estimate: est.low_estimate,
      high_estimate: est.high_estimate,
    })
  );

  const allFindings: RayConFinding[] = [
    ...structuralFindings,
    ...mepFindings,
    ...adaFindings,
    // Detailed cost_estimates items from inspection supersede generic section
    // items when they overlap — include both for maximum signal
    ...detailedFindings,
  ];

  return {
    address,
    school_type: schoolType,
    rooms,
    findings: allFindings,
    gross_floor_area_sf: isp.building_code_info.gross_floor_area_sf,
    total_occupant_load: isp.building_code_info.total_occupant_load,
  };
}

// ─── Response Parser ─────────────────────────────────────────────────────────

/** Map a RayConResponse into the canonical CostEstimates shape */
function parseRayConResponse(
  response: RayConResponse,
  inspectionSource: "vendor" | "ai"
): CostEstimates {
  const scenarios: CostScenario[] = response.scenarios.map((scenario) => {
    const lineItems: CostLineItem[] = scenario.line_items.map((li) => ({
      item: li.item,
      cost: li.cost,
    }));
    return {
      name: scenario.name,
      total: scenario.total,
      line_items: lineItems,
    };
  });

  return {
    computed_at: new Date().toISOString(),
    inspection_source: inspectionSource,
    scenarios,
  };
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * Call the RayCon API with ISP room inventory and building inspection data to
 * produce cost estimates per build scenario for the given site.
 *
 * Readiness requirements:
 *  - `isp_extract` must exist in Sindri
 *  - At least one of `inspection_vendor` or `inspection_ai` must exist
 *  - `site_meta` must exist in Sindri (for address and school_type)
 *
 * Prefers `inspection_vendor` over `inspection_ai` when both exist.
 *
 * @param siteId - The Sindri site identifier
 * @param deps   - Injected clients (sindri, rhodes, raycon)
 *
 * @throws {UpstreamNotReady}  if required upstream data is absent
 * @throws {ExternalApiError}  if the RayCon API fails after all retries
 */
export async function getCostEstimates(
  siteId: string,
  deps: GetCostEstimatesDeps
): Promise<void> {
  const { sindri, rhodes, raycon } = deps;

  // 1. Readiness check — fetch all needed inputs in parallel
  const [ispExtract, siteMeta, inspectionVendor, inspectionAi] =
    await Promise.all([
      sindri.read(siteId, "isp_extract"),
      sindri.read(siteId, "site_meta"),
      sindri.read(siteId, "inspection_vendor"),
      // inspection_ai does not yet have a dedicated SindriKey — it is stored
      // as a derived view of sir_ai.  Per spec the fallback is inspection_ai;
      // we use sir_ai here as that is what exists on the type map.  When a
      // dedicated inspection_ai key is added this line should be updated.
      Promise.resolve(null as null), // placeholder for inspection_ai
    ]);

  // Validate required inputs
  const missing: string[] = [];
  if (!ispExtract) missing.push("isp_extract");
  if (!siteMeta) missing.push("site_meta");
  if (!inspectionVendor && !inspectionAi) {
    missing.push("inspection_vendor (or inspection_ai)");
  }
  if (missing.length > 0) {
    throw new UpstreamNotReady("WU-10", siteId, missing);
  }

  // 2. Resolve best available inspection source
  let inspection: InspectionVendor;
  let inspectionSource: "vendor" | "ai";

  if (inspectionVendor) {
    inspection = inspectionVendor;
    inspectionSource = "vendor";
  } else {
    // inspection_ai placeholder — when the actual type exists, cast here.
    // For now this branch is unreachable given the missing-check above.
    throw new UpstreamNotReady("WU-10", siteId, [
      "inspection_vendor (or inspection_ai)",
    ]);
  }

  // 3. Build RayCon request payload
  const request = buildRayConRequest(
    siteMeta!.address,
    siteMeta!.school_type,
    ispExtract!,
    inspection
  );

  // 4. Call RayCon API with retry
  let rayconResponse: RayConResponse;
  try {
    rayconResponse = await withRetry(
      () => raycon.getEstimates(request),
      {
        maxAttempts: PIPELINE_CONFIG.RETRY.MAX_ATTEMPTS,
        initialDelayMs: PIPELINE_CONFIG.RETRY.INITIAL_DELAY_MS,
        backoffMultiplier: PIPELINE_CONFIG.RETRY.BACKOFF_MULTIPLIER,
        retryOn: (err) =>
          err instanceof ExternalApiError && err.retryable,
      }
    );
  } catch (err) {
    if (err instanceof ExternalApiError) {
      throw err;
    }
    throw new ExternalApiError(
      "WU-10",
      siteId,
      "RayCon",
      null,
      err instanceof Error ? err.message : String(err)
    );
  }

  // 5. Parse response into canonical CostEstimates shape
  const costEstimates = parseRayConResponse(rayconResponse, inspectionSource);

  // 6. Persist to Sindri and RHODES in parallel
  await Promise.all([
    sindri.write(siteId, "cost_estimates", costEstimates),
    rhodes.writeCostEstimates(siteId, costEstimates),
  ]);
}
