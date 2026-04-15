/**
 * RHODES Client Interface
 *
 * Abstraction over the RHODES business data layer.
 * RHODES stores data that needs long-term persistence or visibility
 * to other teams (finance, construction, enrollment, legal, operations).
 *
 * Not every work unit writes to RHODES — only those producing data
 * that other parts of the business need.
 */

import type {
  SiteMeta,
  SirAi,
  SchoolApproval,
  SirVendor,
  InspectionVendor,
  IspExtract,
  CostEstimates,
  PermitHistory,
  OpeningPlan,
  DdReport,
} from "./types";

export interface RhodesClient {
  // ─── Site Management ───────────────────────────────────────────

  /** Create a new site record. Returns the RHODES site ID. */
  createSite(data: {
    address: string;
    city: string;
    state: string;
    zip: string;
    school_type: string;
    stage: string;
    drive_folder_url: string;
  }): Promise<string>;

  /** Update an existing site record. */
  updateSite(
    siteId: string,
    data: Partial<{
      drive_folder_url: string;
      stage: string;
      p1_name: string;
      p1_email: string;
    }>
  ): Promise<void>;

  // ─── Data Writes (one per work unit that writes to RHODES) ────

  /** WU-02: Store AI SIR structured extraction */
  writeSirAi(siteId: string, data: SirAi): Promise<void>;

  /** WU-03: Store school approval analysis */
  writeSchoolApproval(siteId: string, data: SchoolApproval): Promise<void>;

  /** WU-06: Store vendor-verified SIR data */
  writeSirVendor(siteId: string, data: SirVendor): Promise<void>;

  /** WU-07: Store vendor building inspection data */
  writeInspectionVendor(
    siteId: string,
    data: InspectionVendor
  ): Promise<void>;

  /** WU-08: Store ISP extraction (capacity, room inventory) */
  writeIspExtract(siteId: string, data: IspExtract): Promise<void>;

  /** WU-10: Store cost estimates */
  writeCostEstimates(siteId: string, data: CostEstimates): Promise<void>;

  /** WU-11: Store permit history */
  writePermitHistory(siteId: string, data: PermitHistory): Promise<void>;

  /** WU-12: Store opening plan metadata */
  writeOpeningPlan(siteId: string, data: OpeningPlan): Promise<void>;

  /** WU-13: Store DD report metadata (doc_id, url, version, score) */
  writeDdReport(siteId: string, data: DdReport): Promise<void>;
}
