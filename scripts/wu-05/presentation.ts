/**
 * WU-05: Location Presentation
 *
 * Generates a Google Slides location presentation for a prospective school site.
 * The deck is built from five content sources:
 *
 *  1. Site metadata (address, school type) from Sindri / WU-01
 *  2. Enrollment data from the enrollment demographics API
 *  3. Wealth and demographics data from the demographics API
 *  4. Map imagery (satellite, street view, area context) from the maps API
 *  5. A pre-defined slide structure that acts as the presentation template
 *
 * The finished presentation is saved to the M1/Acquire-Property Drive folder and
 * its URL is written back to Sindri as `presentation_url`.
 *
 * Invoking event : UpstreamCompleted from WU-01 (site_meta created)
 * Sindri data in : site_meta (WU-01)
 * Sindri data out: presentation_url
 * RHODES write   : None (presentation is a Drive artefact, not structured business data)
 */

import type { SindriClient } from "../shared/sindri";
import type { SiteMeta, PresentationOutput, SchoolType } from "../shared/types";
import { UpstreamNotReady, ExternalApiError, PipelineError } from "../shared/errors";
import { withRetry } from "../shared/retry";

// ─── External Service Interfaces ─────────────────────────────────────────────

/**
 * Enrollment data for a geographic area around a given address.
 * Returned by the enrollment demographics API.
 */
export interface EnrollmentArea {
  /** Total K-12 students within the primary catchment radius */
  total_k12_enrollment: number;
  /** Total students within the extended market area */
  total_market_area_enrollment: number;
  /** Break down by grade band */
  by_grade_band: {
    pk_k: number;
    grades_1_5: number;
    grades_6_8: number;
    grades_9_12: number;
  };
  /** Public school enrollment within 1 mile */
  public_school_enrollment_1mi: number;
  /** Private school enrollment within 1 mile */
  private_school_enrollment_1mi: number;
  /** Total number of competing private schools within 3 miles */
  competing_private_schools_3mi: number;
  /** Year-over-year enrollment growth rate (decimal, e.g. 0.03 = 3%) */
  yoy_growth_rate: number | null;
  /** Source and vintage of the enrollment data */
  data_source: string;
  data_vintage_year: number;
}

/**
 * Wealth and demographic data for a geographic area around a given address.
 * Returned by the demographics API.
 */
export interface DemographicsArea {
  /** Median household income within 1-mile radius */
  median_hhi_1mi: number | null;
  /** Median household income within 3-mile radius */
  median_hhi_3mi: number | null;
  /** Percentage of households with children under 18, within 1 mile */
  pct_households_with_children_1mi: number | null;
  /** Percentage of adults with a bachelor's degree or higher, within 1 mile */
  pct_college_educated_1mi: number | null;
  /** Estimated private school spending propensity score (0–100) */
  private_school_propensity_score: number | null;
  /** Median home value within 1 mile */
  median_home_value_1mi: number | null;
  /** Total population within 1 mile */
  population_1mi: number | null;
  /** Total population within 3 miles */
  population_3mi: number | null;
  /** Dominant racial/ethnic composition (top 3) */
  top_demographics: string[];
  /** Source and vintage */
  data_source: string;
  data_vintage_year: number;
}

/**
 * A single map image generated for the presentation.
 */
export interface MapImage {
  /** Human-readable label for the slide */
  label: string;
  /** Drive URL of the uploaded image */
  image_url: string;
  /** Image dimensions in pixels */
  width_px: number;
  height_px: number;
}

/**
 * Collection of map images generated for this site.
 */
export interface SiteMapImagery {
  satellite: MapImage;
  street_view: MapImage;
  area_context: MapImage;
}

/**
 * A single slide definition passed to the SlidesClient.
 */
export interface SlideDefinition {
  /** Slide layout type */
  layout: "title" | "title_body" | "two_column" | "image_full" | "table" | "blank";
  /** Slide title text */
  title?: string;
  /** Primary body text or markdown */
  body?: string;
  /** Left column content (two_column layout) */
  left_column?: string;
  /** Right column content (two_column layout) */
  right_column?: string;
  /** Image URL to embed (image_full layout) */
  image_url?: string;
  /** Image caption */
  image_caption?: string;
  /** Table data: first row is headers */
  table_data?: ReadonlyArray<ReadonlyArray<string>>;
  /** Speaker notes for this slide */
  notes?: string;
}

/**
 * Result of creating a Google Slides presentation.
 */
export interface PresentationResult {
  /** Google Slides presentation URL (web view link) */
  url: string;
  /** Internal presentation ID */
  presentation_id: string;
  /** Number of slides created */
  slide_count: number;
}

/**
 * Google Slides client interface required by WU-05.
 */
export interface SlidesClient {
  /**
   * Create a new Google Slides presentation from a slide definition array.
   *
   * @param title  Presentation title (shown in Drive)
   * @param slides Ordered slide definitions
   * @param driveFolderId  Drive folder ID to save the presentation into
   * @returns Presentation result including the public URL
   */
  createPresentation(
    title: string,
    slides: SlideDefinition[],
    driveFolderId: string
  ): Promise<PresentationResult>;

  /**
   * Resolve a Drive folder name to its folder ID for the given site.
   *
   * @param siteId     Sindri site ID
   * @param folderName Logical folder name, e.g. "M1 - Acquire Property"
   */
  resolveFolderId(siteId: string, folderName: string): Promise<string>;
}

/**
 * Enrollment data API interface required by WU-05.
 */
export interface EnrollmentApi {
  /**
   * Fetch enrollment data for the area surrounding a given address.
   *
   * @param address Full street address
   * @param city    City
   * @param state   Two-letter state code
   * @param zip     ZIP code
   * @param radiusMiles  Search radius in miles (default 3)
   */
  getEnrollmentData(params: {
    address: string;
    city: string;
    state: string;
    zip: string;
    radiusMiles?: number;
  }): Promise<EnrollmentArea>;
}

/**
 * Demographics and wealth data API interface required by WU-05.
 */
export interface DemographicsApi {
  /**
   * Fetch wealth and demographic data for the area surrounding a given address.
   *
   * @param address Full street address
   * @param city    City
   * @param state   Two-letter state code
   * @param zip     ZIP code
   */
  getDemographicsData(params: {
    address: string;
    city: string;
    state: string;
    zip: string;
  }): Promise<DemographicsArea>;
}

/**
 * Maps imagery API interface required by WU-05.
 */
export interface MapsApi {
  /**
   * Generate a satellite overhead image of the property and surrounding block.
   *
   * @returns Drive URL of the uploaded image
   */
  getSatelliteImage(params: {
    address: string;
    city: string;
    state: string;
    zip: string;
    zoom?: number;
  }): Promise<MapImage>;

  /**
   * Generate a street-view image from the building frontage.
   *
   * @returns Drive URL of the uploaded image, or null if street view unavailable
   */
  getStreetViewImage(params: {
    address: string;
    city: string;
    state: string;
    zip: string;
  }): Promise<MapImage | null>;

  /**
   * Generate a context map showing the broader neighborhood (schools, amenities, transit).
   *
   * @returns Drive URL of the uploaded image
   */
  getAreaContextMap(params: {
    address: string;
    city: string;
    state: string;
    zip: string;
    radiusMiles?: number;
  }): Promise<MapImage>;
}

/** Injected clients for WU-05. */
export interface WU05Clients {
  sindri: SindriClient;
  slides: SlidesClient;
  enrollment: EnrollmentApi;
  demographics: DemographicsApi;
  maps: MapsApi;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WU = "WU-05";
const M1_FOLDER = "M1 - Acquire Property";

// ─── Slide Builders ───────────────────────────────────────────────────────────

/**
 * Build the title slide.
 */
function buildTitleSlide(siteMeta: SiteMeta): SlideDefinition {
  const schoolTypeLabel: Record<SchoolType, string> = {
    micro: "Micro School",
    "250": "250-Student School",
    "1000": "1,000-Student School",
  };

  return {
    layout: "title",
    title: `${siteMeta.address}`,
    body: [
      `${siteMeta.city}, ${siteMeta.state} ${siteMeta.zip}`,
      `School Type: ${schoolTypeLabel[siteMeta.school_type]}`,
      `Pipeline Stage: ${siteMeta.stage}`,
      "",
      `Prepared by Alpha DD Pipeline`,
      `Generated: ${new Date().toLocaleDateString("en-US", { dateStyle: "long" })}`,
    ].join("\n"),
    notes: "Title slide — generated automatically by WU-05 Location Presentation.",
  };
}

/**
 * Build the property overview slide.
 */
function buildOverviewSlide(siteMeta: SiteMeta): SlideDefinition {
  return {
    layout: "title_body",
    title: "Property Overview",
    body: [
      `**Address:** ${siteMeta.address}, ${siteMeta.city}, ${siteMeta.state} ${siteMeta.zip}`,
      `**School Type:** ${siteMeta.school_type}`,
      `**Pipeline Stage:** ${siteMeta.stage}`,
      siteMeta.p1_name ? `**Primary Contact:** ${siteMeta.p1_name}` : null,
      siteMeta.p1_email ? `**Contact Email:** ${siteMeta.p1_email}` : null,
    ]
      .filter((line): line is string => line !== null)
      .join("\n"),
    notes: "Property overview — pulled from Sindri site_meta.",
  };
}

/**
 * Build the satellite map slide.
 */
function buildSatelliteSlide(image: MapImage): SlideDefinition {
  return {
    layout: "image_full",
    title: "Satellite View",
    image_url: image.image_url,
    image_caption: image.label,
    notes: "Satellite overhead image of the property and surrounding block.",
  };
}

/**
 * Build the street-view slide, or a placeholder if unavailable.
 */
function buildStreetViewSlide(image: MapImage | null, siteMeta: SiteMeta): SlideDefinition {
  if (image) {
    return {
      layout: "image_full",
      title: "Street View",
      image_url: image.image_url,
      image_caption: image.label,
      notes: "Street-level view of the building frontage.",
    };
  }

  return {
    layout: "title_body",
    title: "Street View",
    body: `Street view imagery is not available for ${siteMeta.address}.\nReview the satellite image and visit the property for a ground-level assessment.`,
    notes: "Street view unavailable — placeholder slide.",
  };
}

/**
 * Build the area context map slide.
 */
function buildAreaContextSlide(image: MapImage): SlideDefinition {
  return {
    layout: "image_full",
    title: "Area Context",
    image_url: image.image_url,
    image_caption: image.label,
    notes: "Neighborhood context map showing schools, transit, and key amenities within the market area.",
  };
}

/**
 * Format a number as USD currency (no decimals).
 */
function formatCurrency(value: number | null): string {
  if (value === null) return "—";
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

/**
 * Format a decimal as a percentage string.
 */
function formatPct(value: number | null, decimals = 1): string {
  if (value === null) return "—";
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Format a raw number with comma separators.
 */
function formatNumber(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("en-US");
}

/**
 * Build the enrollment summary slide.
 */
function buildEnrollmentSummarySlide(enrollment: EnrollmentArea): SlideDefinition {
  return {
    layout: "title_body",
    title: "Enrollment Overview",
    body: [
      `**Total K-12 Enrollment (Market Area):** ${formatNumber(enrollment.total_market_area_enrollment)}`,
      `**Catchment Area Enrollment:** ${formatNumber(enrollment.total_k12_enrollment)}`,
      `**Year-over-Year Growth:** ${enrollment.yoy_growth_rate !== null ? formatPct(enrollment.yoy_growth_rate) : "—"}`,
      "",
      `**Private Schools within 3 miles:** ${enrollment.competing_private_schools_3mi}`,
      `**Private School Enrollment (1 mi):** ${formatNumber(enrollment.private_school_enrollment_1mi)}`,
      `**Public School Enrollment (1 mi):** ${formatNumber(enrollment.public_school_enrollment_1mi)}`,
      "",
      `_Source: ${enrollment.data_source} (${enrollment.data_vintage_year})_`,
    ].join("\n"),
    notes: "Enrollment summary from the enrollment data API.",
  };
}

/**
 * Build the enrollment by grade band slide.
 */
function buildEnrollmentGradeBandSlide(enrollment: EnrollmentArea): SlideDefinition {
  return {
    layout: "table",
    title: "Enrollment by Grade Band (Market Area)",
    table_data: [
      ["Grade Band", "Enrollment"],
      ["Pre-K / Kindergarten", formatNumber(enrollment.by_grade_band.pk_k)],
      ["Grades 1–5", formatNumber(enrollment.by_grade_band.grades_1_5)],
      ["Grades 6–8", formatNumber(enrollment.by_grade_band.grades_6_8)],
      ["Grades 9–12", formatNumber(enrollment.by_grade_band.grades_9_12)],
      [
        "**Total K-12**",
        `**${formatNumber(enrollment.total_k12_enrollment)}**`,
      ],
    ],
    notes: "Grade band breakdown from the enrollment data API.",
  };
}

/**
 * Build the demographics / wealth slide.
 */
function buildDemographicsSlide(demographics: DemographicsArea): SlideDefinition {
  return {
    layout: "two_column",
    title: "Demographics & Wealth",
    left_column: [
      "**Household Income**",
      `Median HHI (1 mi): ${formatCurrency(demographics.median_hhi_1mi)}`,
      `Median HHI (3 mi): ${formatCurrency(demographics.median_hhi_3mi)}`,
      "",
      "**Housing**",
      `Median Home Value (1 mi): ${formatCurrency(demographics.median_home_value_1mi)}`,
      "",
      "**Population**",
      `Population (1 mi): ${formatNumber(demographics.population_1mi)}`,
      `Population (3 mi): ${formatNumber(demographics.population_3mi)}`,
    ].join("\n"),
    right_column: [
      "**Education & Family**",
      `Households with Children: ${formatPct(demographics.pct_households_with_children_1mi)}`,
      `College-Educated Adults: ${formatPct(demographics.pct_college_educated_1mi)}`,
      "",
      "**Private School Propensity**",
      demographics.private_school_propensity_score !== null
        ? `Score: ${demographics.private_school_propensity_score} / 100`
        : "Score: —",
      "",
      "**Top Demographics**",
      demographics.top_demographics.length > 0
        ? demographics.top_demographics.join(", ")
        : "—",
      "",
      `_Source: ${demographics.data_source} (${demographics.data_vintage_year})_`,
    ].join("\n"),
    notes: "Wealth and demographics data from the demographics API.",
  };
}

/**
 * Build the market summary / conclusion slide.
 */
function buildMarketSummarySlide(
  siteMeta: SiteMeta,
  enrollment: EnrollmentArea,
  demographics: DemographicsArea
): SlideDefinition {
  // Compute a simple headline score from available signals
  const signals: string[] = [];

  if (enrollment.total_k12_enrollment > 5000) {
    signals.push("Strong enrollment base (>5,000 K-12 students in catchment)");
  } else if (enrollment.total_k12_enrollment > 2000) {
    signals.push("Moderate enrollment base (2,000–5,000 K-12 students in catchment)");
  } else {
    signals.push("Limited enrollment base (<2,000 K-12 students in catchment)");
  }

  if (demographics.median_hhi_1mi !== null && demographics.median_hhi_1mi > 100000) {
    signals.push("High-income market (median HHI >$100k within 1 mile)");
  } else if (demographics.median_hhi_1mi !== null && demographics.median_hhi_1mi > 65000) {
    signals.push("Middle-income market (median HHI $65k–$100k within 1 mile)");
  } else {
    signals.push("Lower-income market (median HHI <$65k within 1 mile)");
  }

  if (demographics.pct_college_educated_1mi !== null && demographics.pct_college_educated_1mi > 0.4) {
    signals.push("Highly educated population (>40% college-educated adults)");
  }

  if (enrollment.yoy_growth_rate !== null && enrollment.yoy_growth_rate > 0.02) {
    signals.push(`Growing market (+${formatPct(enrollment.yoy_growth_rate)} YoY enrollment growth)`);
  }

  if (enrollment.competing_private_schools_3mi > 5) {
    signals.push(
      `Competitive market (${enrollment.competing_private_schools_3mi} private schools within 3 miles)`
    );
  }

  return {
    layout: "title_body",
    title: "Market Summary",
    body: [
      `**Location:** ${siteMeta.address}, ${siteMeta.city}, ${siteMeta.state}`,
      "",
      "**Key Market Signals:**",
      ...signals.map((s) => `• ${s}`),
      "",
      "**Next Steps:**",
      "• Review AI SIR for site feasibility",
      "• Await CDS verification and Worksmith inspection results",
    ].join("\n"),
    notes: "Market summary computed from enrollment and demographics signals.",
  };
}

// ─── Slide Structure ──────────────────────────────────────────────────────────

/**
 * Assemble the complete ordered slide array for the location presentation.
 *
 * Slide order:
 *  1. Title
 *  2. Property Overview
 *  3. Satellite View
 *  4. Street View
 *  5. Area Context Map
 *  6. Enrollment Overview
 *  7. Enrollment by Grade Band
 *  8. Demographics & Wealth
 *  9. Market Summary
 */
function buildSlides(
  siteMeta: SiteMeta,
  enrollment: EnrollmentArea,
  demographics: DemographicsArea,
  imagery: SiteMapImagery
): SlideDefinition[] {
  return [
    buildTitleSlide(siteMeta),
    buildOverviewSlide(siteMeta),
    buildSatelliteSlide(imagery.satellite),
    buildStreetViewSlide(imagery.street_view, siteMeta),
    buildAreaContextSlide(imagery.area_context),
    buildEnrollmentSummarySlide(enrollment),
    buildEnrollmentGradeBandSlide(enrollment),
    buildDemographicsSlide(demographics),
    buildMarketSummarySlide(siteMeta, enrollment, demographics),
  ];
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * WU-05: Generate the location presentation for a prospective school site.
 *
 * Reads `site_meta` from Sindri, fetches enrollment and demographic data,
 * generates map imagery, builds a Google Slides presentation, and writes
 * `presentation_url` back to Sindri.
 *
 * @param siteId  Sindri site ID (from WU-01)
 * @param clients Injected service clients
 * @returns The presentation output written to Sindri
 * @throws {UpstreamNotReady}   if site_meta is not yet in Sindri
 * @throws {ExternalApiError}   if any external API call fails after retries
 * @throws {PipelineError}      for other unrecoverable failures
 */
export async function generatePresentation(
  siteId: string,
  clients: WU05Clients
): Promise<PresentationOutput> {
  const { sindri, slides, enrollment, demographics, maps } = clients;

  // ── 1. Validate upstream data is ready ────────────────────────────────────
  const siteMetaExists = await sindri.exists(siteId, "site_meta");
  if (!siteMetaExists) {
    throw new UpstreamNotReady(WU, siteId, ["site_meta"]);
  }

  // ── 2. Read site_meta ─────────────────────────────────────────────────────
  const siteMeta = await sindri.read(siteId, "site_meta");
  if (!siteMeta) {
    throw new PipelineError(WU, siteId, "site_meta returned null after exists check");
  }

  const locationParams = {
    address: siteMeta.address,
    city: siteMeta.city,
    state: siteMeta.state,
    zip: siteMeta.zip,
  };

  // ── 3. Fetch external data in parallel ────────────────────────────────────
  // Enrollment, demographics, and map imagery can all be fetched concurrently.
  let enrollmentData: EnrollmentArea;
  let demographicsData: DemographicsArea;
  let satelliteImage: MapImage;
  let streetViewImage: MapImage | null;
  let areaContextImage: MapImage;

  try {
    [enrollmentData, demographicsData, satelliteImage, streetViewImage, areaContextImage] =
      await Promise.all([
        withRetry(
          () => enrollment.getEnrollmentData({ ...locationParams, radiusMiles: 3 }),
          { retryOn: (err) => err instanceof ExternalApiError }
        ),
        withRetry(
          () => demographics.getDemographicsData(locationParams),
          { retryOn: (err) => err instanceof ExternalApiError }
        ),
        withRetry(
          () => maps.getSatelliteImage({ ...locationParams, zoom: 18 }),
          { retryOn: (err) => err instanceof ExternalApiError }
        ),
        // Street view is best-effort — null return is valid
        withRetry(
          () => maps.getStreetViewImage(locationParams),
          { retryOn: (err) => err instanceof ExternalApiError }
        ).catch(() => null),
        withRetry(
          () => maps.getAreaContextMap({ ...locationParams, radiusMiles: 3 }),
          { retryOn: (err) => err instanceof ExternalApiError }
        ),
      ]);
  } catch (err) {
    throw new ExternalApiError(
      WU,
      siteId,
      "External Data API",
      null,
      `Failed to fetch external data: ${String(err)}`
    );
  }

  const imagery: SiteMapImagery = {
    satellite: satelliteImage,
    street_view: streetViewImage ?? {
      label: "Street View Unavailable",
      image_url: "",
      width_px: 0,
      height_px: 0,
    },
    area_context: areaContextImage,
  };

  // ── 4. Build slide definitions ─────────────────────────────────────────────
  const slideDefinitions = buildSlides(siteMeta, enrollmentData, demographicsData, imagery);

  // ── 5. Resolve Drive folder ID ─────────────────────────────────────────────
  let folderId: string;
  try {
    folderId = await withRetry(
      () => slides.resolveFolderId(siteId, M1_FOLDER),
      { retryOn: (err) => err instanceof ExternalApiError }
    );
  } catch (err) {
    throw new ExternalApiError(
      WU,
      siteId,
      "Google Drive",
      null,
      `Failed to resolve Drive folder "${M1_FOLDER}": ${String(err)}`
    );
  }

  // ── 6. Create the Google Slides presentation ──────────────────────────────
  const presentationTitle = `Location Presentation — ${siteMeta.address}, ${siteMeta.city}, ${siteMeta.state}`;

  let presentationResult: PresentationResult;
  try {
    presentationResult = await withRetry(
      () => slides.createPresentation(presentationTitle, slideDefinitions, folderId),
      {
        maxAttempts: 2,
        retryOn: (err) => err instanceof ExternalApiError,
      }
    );
  } catch (err) {
    throw new ExternalApiError(
      WU,
      siteId,
      "Google Slides",
      null,
      `Failed to create presentation: ${String(err)}`
    );
  }

  // ── 7. Write presentation_url to Sindri ──────────────────────────────────
  const output: PresentationOutput = {
    presentation_url: presentationResult.url,
  };

  await sindri.write(siteId, "presentation_url", output);

  return output;
}
