/**
 * Pipeline Configuration
 *
 * Environment-specific settings, API endpoints, and constants.
 * All work units read from this rather than hardcoding values.
 */

export const PIPELINE_CONFIG = {
  // ─── Target Dates ────────────────────────────────────────────
  /** Current school year opening deadline */
  SCHOOL_YEAR_DEADLINE: "2026-08-12",

  // ─── Google Drive ────────────────────────────────────────────
  /** Standard folder structure created per site */
  DRIVE_FOLDER_STRUCTURE: [
    "M1 - Acquire Property",
    "M2 - Permits",
    "M3 - Build Out",
    "M4 - Staffing",
    "M5 - Enrollment",
    "M6 - Operations",
  ],

  // ─── Vendor Recipients ───────────────────────────────────────
  CDS: {
    DEFAULT_RECIPIENT: "inspections@cds-group.com",
    EMAIL_SUBJECT_PREFIX: "CDS Verification Request:",
  },
  WORKSMITH: {
    DEFAULT_RECIPIENT: "inspections@worksmith.com",
    EMAIL_SUBJECT_PREFIX: "Building Inspection Request:",
  },

  // ─── API Endpoints ───────────────────────────────────────────
  SHOVELS: {
    BASE_URL: "https://api.shovels.ai/v2",
  },
  RAYCON: {
    BASE_URL: "https://api.raycon.com/v1",
  },

  // ─── Distribution ────────────────────────────────────────────
  DISTRIBUTION: {
    /** Default stakeholder list for DD report distribution */
    STAKEHOLDER_EMAILS: [
      // Populated from RHODES or env config
    ] as string[],
    CHAT_SPACE: "spaces/dd-reports",
    EMAIL_SUBJECT_PREFIX: "DD Report:",
  },

  // ─── Delta Computation ───────────────────────────────────────
  /** Severity classification for field conflicts */
  DELTA_SEVERITY: {
    high: [
      "zoning_status",
      "occupancy_classification",
      "sprinkler_required",
      "permit_type",
      "use_permission",
    ],
    medium: [
      "timeline_best",
      "timeline_worst",
      "fee_amounts",
      "code_edition",
      "fire_code_edition",
    ],
    low: [
      "contact_name",
      "contact_phone",
      "formatting",
      "minor_notes",
    ],
  } as Record<string, string[]>,

  // ─── Retry Config ────────────────────────────────────────────
  RETRY: {
    MAX_ATTEMPTS: 3,
    INITIAL_DELAY_MS: 1000,
    BACKOFF_MULTIPLIER: 2,
  },
} as const;
