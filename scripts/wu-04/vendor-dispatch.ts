/**
 * WU-04: Vendor Dispatch
 *
 * Dispatches two vendor packets after the AI Site Investigation Report (SIR) is complete:
 *
 *  1. CDS Verification Report — the full AI SIR markdown with a verification overlay:
 *     every B/C-confidence row gets three empty columns appended for CDS to fill in
 *     (CDS Verified Finding, CDS Source, CDS Confidence), claim-id HTML comment
 *     anchors for round-trip extraction, a Verification Task Summary table, and a
 *     cover sheet. Saved to the M2/Permits Drive folder.
 *
 *  2. Worksmith Pre-Filled Inspection Checklist — a single stand-alone document built
 *     from the canonical 11-section template, pre-populated wherever the SIR has
 *     findings, with site-specific tasks appended for AI-flagged risks that don't map
 *     to any template line item. Saved to the M2/Permits Drive folder.
 *
 * Both documents embed HTML claim-id comments so AGENT-06 and AGENT-07 can extract
 * completed data without brittle table parsing.
 *
 * Invoking event : UpstreamCompleted from WU-02 (AI SIR complete)
 * Sindri data in : site_meta (WU-01), sir_ai (WU-02)
 * Sindri data out: vendor_packets_sent
 * RHODES write   : None
 */

import type { SindriClient } from "../shared/sindri";
import type {
  SiteMeta,
  SirAi,
  AuthorityContact,
  VendorPacketsSent,
  SirUnknown,
} from "../shared/types";
import { UpstreamNotReady, ExternalApiError, PipelineError } from "../shared/errors";
import { withRetry } from "../shared/retry";
import { PIPELINE_CONFIG } from "../shared/config";

// ─── External Service Interfaces ────────────────────────────────────────────

/** Minimal Google Drive interface required by WU-04. */
export interface DriveClient {
  /**
   * Read a file from Drive by its URL.
   * Returns the raw file content as a string.
   */
  readFile(fileUrl: string): Promise<string>;

  /**
   * Upload a file to a specific Drive folder.
   * @param folderName  Logical folder name matching DRIVE_FOLDER_STRUCTURE, e.g. "M2 - Permits"
   * @param fileName    File name including extension
   * @param content     File content as a UTF-8 string
   * @param mimeType    MIME type, e.g. "text/markdown"
   * @returns Public shareable URL for the uploaded file
   */
  uploadFile(
    siteId: string,
    folderName: string,
    fileName: string,
    content: string,
    mimeType: string
  ): Promise<string>;
}

/** Minimal email interface required by WU-04. */
export interface EmailClient {
  /**
   * Send a plain-text + HTML email.
   * @throws {ExternalApiError} on delivery failure
   */
  sendEmail(params: {
    to: string;
    subject: string;
    body: string;
  }): Promise<{ sentAt: string }>;
}

/** Injected clients for WU-04. */
export interface WU04Clients {
  sindri: SindriClient;
  drive: DriveClient;
  email: EmailClient;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const WU = "WU-04";
const M2_FOLDER = "M2 - Permits";

// ─── Checklist Template ──────────────────────────────────────────────────────

/**
 * Canonical 11-section inspection checklist template.
 *
 * Each section contains an ordered list of template line items and an optional
 * contextual note to be appended after the section's table.
 *
 * This is the authoritative template for Worksmith building inspections.
 * WU-07 extraction will map findings back to these section keys.
 */
export const INSPECTION_TEMPLATE: ReadonlyArray<ChecklistSection> = [
  {
    key: "exterior_site",
    title: "1. Exterior / Site",
    items: [
      "Building exterior condition (walls, roof, foundation, grading)",
      "Visible signs of water intrusion, staining, or efflorescence",
      "Roof condition and drainage (gutters, downspouts, flat-roof ponding)",
      "Site grading and drainage — water flows away from building",
      "Utility connections visible and properly protected",
      "Site accessibility from public street",
      "Fencing, gates, and perimeter security",
    ],
    note: null,
  },
  {
    key: "parking_dropoff",
    title: "2. Parking / Drop-off",
    items: [
      "Dedicated parent drop-off/pick-up lane exists and is separated from parking",
      "Parking lot surface condition (cracks, potholes, drainage)",
      "ADA-accessible parking spaces (count and location)",
      "ADA van-accessible space (8 ft stall + 8 ft aisle)",
      "Path of travel from parking to building entrance is accessible",
      "Curb cuts present at all pedestrian crossings",
      "Parking lot lighting adequacy",
      "School bus or van loading zone (if applicable)",
    ],
    note: "A safe parent drop-off/pick-up area is a deal-killer question. If no viable drop-off configuration exists on-site or at the curb, escalate immediately.",
  },
  {
    key: "entry_egress",
    title: "3. Entry / Egress",
    items: [
      "Number of exits from the building (minimum 2 required)",
      "Exit separation — are exits distributed around the perimeter?",
      "Exit door hardware: panic/crash bar on outward-swinging doors",
      "Exit door width (minimum 32 in. clear, 36 in. preferred)",
      "Exit corridors free of obstructions",
      "Exit signs present, illuminated, and visible from all points of egress",
      "Emergency lighting with battery backup at exits",
      "Stairwell enclosure and self-closing fire doors (if multi-story)",
      "Interior path-of-travel width to exits (minimum 44 in.)",
    ],
    note: "Adequate exits and panic hardware are deal-killer questions. IBC §1006.3 requires minimum 2 exits for assembly occupancies > 49 persons.",
  },
  {
    key: "fire_alarm",
    title: "4. Fire Alarm",
    items: [
      "Fire alarm system present (panel location and manufacturer)",
      "System monitoring status (local only vs. central station)",
      "Horn/strobe devices present in all occupied spaces",
      "Manual pull stations at all required locations",
      "System last inspection date and certification status",
      "Any open trouble codes or system faults",
      "Smoke detectors in corridors and mechanical rooms",
    ],
    note: "Installing or upgrading a fire alarm system to E-occupancy code costs $15,000–$50,000 and takes 8–16 weeks (permit + inspection cycle). Factor into timeline if not present or undersized.",
  },
  {
    key: "sprinkler",
    title: "5. Sprinkler System",
    items: [
      "Sprinkler system present (wet pipe vs. dry pipe vs. none)",
      "Coverage area — full building or partial?",
      "Sprinkler heads in good condition (no paint, corrosion, or damage)",
      "Control valve location and tamper-switch status",
      "Backflow preventer present and tagged",
      "Water supply connection and main size",
      "System last inspection date and certification status",
    ],
    note: "E-occupancy sprinkler trigger: IBC §903.2.3 requires sprinklers when occupied floor is > 55 ft above grade or building area > 12,000 SF (check local amendments). Retrofitting costs $8–$15/SF installed.",
  },
  {
    key: "emergency_systems",
    title: "6. Emergency Systems",
    items: [
      "Emergency exit lighting with battery backup (all corridors and exits)",
      "Emergency generator present (if applicable)",
      "Generator last test date",
      "Fire extinguishers present, tagged, and not expired",
      "Emergency shutoffs labeled and accessible (gas, electric, water)",
      "Posted emergency evacuation plan",
    ],
    note: null,
  },
  {
    key: "restrooms_plumbing",
    title: "7. Restrooms / Plumbing",
    items: [
      "Number of toilet fixtures (male and female separately)",
      "Number of lavatory/sink fixtures",
      "Number of drinking fountains",
      "Accessible toilet room present (IBC/ADAAG)",
      "Toilet room door hardware accessible (lever or power-assist)",
      "Plumbing fixtures in working order (flush, drain, supply pressure)",
      "Water heater capacity and age",
      "Visible supply or drain leaks",
      "Floor drain in restrooms (required by most codes)",
      "Janitor sink/service sink present",
    ],
    note: "IBC §2902 minimum fixture counts for E-occupancy: 1 WC per 30 students (each sex), 1 lavatory per 50 students. At 59+ students, an additional bathroom set is typically required.",
  },
  {
    key: "ada",
    title: "8. ADA / Accessibility",
    items: [
      "Accessible route from public way to primary entrance (slope, surface, width)",
      "Accessible entrance (automatic door or power-assist, or low-force manual)",
      "Threshold heights at entries (max 1/2 in. beveled, 1/4 in. perpendicular)",
      "Elevator or platform lift present (required if program on upper floors)",
      "Accessible restroom interior (turning radius, grab bars, fixture heights)",
      "Corridor width (min 44 in., 60 in. preferred)",
      "Floor surface — hard, stable, and slip-resistant",
      "Signage with Braille at room identification points",
      "Accessible service counter or reception desk height",
    ],
    note: "ADA alterations trigger: any renovation > 20% of total construction cost must include path-of-travel upgrades to primary function areas. Budget $5,000–$30,000 depending on current conditions.",
  },
  {
    key: "structural",
    title: "9. Structural",
    items: [
      "Visible cracks in foundation, slab, or walls (note width and orientation)",
      "Evidence of differential settlement (uneven floors, sticking doors)",
      "Ceiling condition — sagging, water staining, or visible structural damage",
      "Load-bearing wall identification (note any removed or compromised members)",
      "Roof structure visible from attic/plenum (if accessible)",
      "Evidence of prior flooding, fire, or major repair",
    ],
    note: "Is the building free from obvious structural deficiency is a deal-killer question. If any structural concern is identified, a licensed structural engineer must review before proceeding.",
  },
  {
    key: "hvac_mechanical",
    title: "10. HVAC / Mechanical",
    items: [
      "HVAC system type (rooftop package, split system, fan coil, other)",
      "Number of zones and approximate age of equipment",
      "Ventilation rate: can system meet E-occupancy CFM/person requirements?",
      "Air handling unit condition and filter status",
      "CO₂ monitoring or demand-controlled ventilation present",
      "Exhaust fans in restrooms and kitchen/break room",
      "Gas meter and main shutoff accessible",
      "Mechanical room clearances (30 in. min. service access)",
      "Refrigerant type (note if R-22 legacy system requiring upgrade)",
    ],
    note: "E-occupancy ventilation: ASHRAE 62.1 requires 10 CFM/person + 0.12 CFM/SF for classrooms. Most commercial systems sized for office occupancy require balancing or supplemental units. Budget $3,000–$15,000 per zone.",
  },
  {
    key: "electrical",
    title: "11. Electrical",
    items: [
      "Main panel location and amperage (minimum 200A for school occupancy)",
      "Sub-panels: location, size, and available breaker slots",
      "Panel condition — no double-taps, breakers labeled, no signs of overheating",
      "Outlet coverage in classrooms (min 1 per wall, or per NEC 210.52 for the occupancy)",
      "GFCI outlets in wet areas (restrooms, kitchen, within 6 ft of sinks)",
      "Emergency lighting circuits on dedicated breaker",
      "Lighting type and controls (fluorescent, LED, occupancy sensors)",
      "Evidence of aluminum branch wiring (requires remediation)",
      "Grounding and bonding visible at panel",
    ],
    note: "Is the building free from visible electrical hazards covers obvious deficiencies. For full code compliance, a licensed electrician or MEP engineer should review the panel and branch circuits.",
  },
] as const;

/** Template section definition. */
interface ChecklistSection {
  /** Key matching InspectionVendor.sections field names */
  key: string;
  /** Display title with section number */
  title: string;
  /** Ordered line items for this section */
  items: ReadonlyArray<string>;
  /** Optional contextual note appended below the section table */
  note: string | null;
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Derive a clean filesystem/URL-safe filename fragment from an address.
 * "123 Main St, Suite 4" → "123_main_st_suite_4"
 */
function addressSlug(address: string): string {
  return address
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Parse the markdown SIR and return every line that represents a B/C-confidence
 * table row, along with its position (line index) in the document.
 *
 * Heuristic: look for rows containing ` | B ` or ` | C ` (confidence column),
 * or rows preceded by a `<!-- confidence: B -->` / `<!-- confidence: C -->`
 * HTML comment that upstream SIR generation may have embedded.
 */
interface BcRow {
  /** Original line text */
  line: string;
  /** 0-based line index in the document */
  lineIndex: number;
  /** Confidence level of this row */
  confidence: "B" | "C";
  /** Sequential claim ID, e.g. "SIR-001" */
  claimId: string;
  /** Best-guess authority name extracted from the row */
  authority: string;
}

function parseBcRows(markdown: string): BcRow[] {
  const lines = markdown.split("\n");
  const results: BcRow[] = [];
  let claimCounter = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match table rows that have a confidence column with value B or C.
    // We look for | B | or | C | (with optional whitespace) anywhere in the row.
    const bcMatch = line.match(/\|\s*([BC])\s*\|/);
    if (!bcMatch) continue;
    if (!line.trim().startsWith("|")) continue; // must be a table row

    const confidence = bcMatch[1] as "B" | "C";
    const claimId = `SIR-${String(claimCounter).padStart(3, "0")}`;

    // Extract a rough authority name: look for a cell that matches a capitalised
    // proper noun before the confidence cell. Fall back to "Unknown Authority".
    const cells = line.split("|").map((c) => c.trim());
    const authority = cells.find((c) => c.length > 3 && /^[A-Z]/.test(c)) ?? "Unknown Authority";

    results.push({ line, lineIndex: i, confidence, claimId, authority });
    claimCounter++;
  }

  return results;
}

/**
 * Build the Verification Task Summary markdown table grouped by authority.
 */
function buildVerificationTaskSummary(
  bcRows: BcRow[],
  authorityChain: AuthorityContact[]
): string {
  // Group claim IDs by authority
  const byAuthority = new Map<string, { claims: string[]; contact: AuthorityContact | undefined }>();

  for (const row of bcRows) {
    if (!byAuthority.has(row.authority)) {
      const contact = authorityChain.find(
        (a) =>
          a.authority.toLowerCase().includes(row.authority.toLowerCase()) ||
          row.authority.toLowerCase().includes(a.authority.toLowerCase())
      );
      byAuthority.set(row.authority, { claims: [], contact });
    }
    byAuthority.get(row.authority)!.claims.push(row.claimId);
  }

  const rows: string[] = [
    "| # | Authority | Contact Name | Role | Contact Info | Claim IDs to Verify |",
    "|---|-----------|--------------|------|--------------|---------------------|",
  ];

  let rowNum = 1;
  for (const [authority, { claims, contact }] of byAuthority) {
    const name = contact?.name ?? "—";
    const role = contact?.role ?? "—";
    const contactInfo = contact?.contact ?? "—";
    const claimList = claims.join(", ");
    rows.push(`| ${rowNum++} | ${authority} | ${name} | ${role} | ${contactInfo} | ${claimList} |`);
  }

  return rows.join("\n");
}

/**
 * Generate the CDS Verification Report markdown.
 *
 * Process:
 * 1. Parse B/C rows and assign claim IDs.
 * 2. Build the Verification Task Summary table.
 * 3. Rewrite the markdown: inject three empty CDS columns into every B/C row
 *    and append a claim-id HTML comment.
 * 4. Prepend cover sheet + instructions + summary.
 */
function generateCdsReport(params: {
  sirMarkdown: string;
  sirAi: SirAi;
  siteMeta: SiteMeta;
  bcRows: BcRow[];
}): { markdown: string; bcItemCount: number } {
  const { sirMarkdown, sirAi, siteMeta, bcRows } = params;

  // Build a lookup: lineIndex → BcRow
  const bcByLine = new Map<number, BcRow>();
  for (const row of bcRows) {
    bcByLine.set(row.lineIndex, row);
  }

  // Rewrite lines
  const lines = sirMarkdown.split("\n");
  const rewrittenLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const bcRow = bcByLine.get(i);
    if (bcRow) {
      // Inject three empty CDS columns at the end of the row (before trailing |)
      const trimmed = lines[i].trimEnd();
      const augmented = trimmed.endsWith("|")
        ? trimmed.slice(0, -1) + " |  | — | — | — |"
        : trimmed + " |  | — | — | — |";

      rewrittenLines.push(augmented);
      rewrittenLines.push(`<!-- claim-id: ${bcRow.claimId} -->`);
    } else {
      // Check if this is a header separator row for a table that contains B/C rows —
      // if so, extend the separator to cover the three new columns.
      // A header separator looks like: | --- | --- | ...
      if (
        lines[i].trim().startsWith("|") &&
        /\|[-: ]+\|/.test(lines[i])
      ) {
        // Check if the very next non-empty line in bcByLine is adjacent
        // (rough heuristic: extend separator if any B/C row exists within 20 lines)
        const windowEnd = Math.min(i + 20, lines.length);
        let hasBcInWindow = false;
        for (let j = i + 1; j < windowEnd; j++) {
          if (bcByLine.has(j)) {
            hasBcInWindow = true;
            break;
          }
        }
        if (hasBcInWindow) {
          const trimmed = lines[i].trimEnd();
          const extended = trimmed.endsWith("|")
            ? trimmed.slice(0, -1) + " | --- | --- | --- |"
            : trimmed + " | --- | --- | --- |";
          rewrittenLines.push(extended);
          continue;
        }
      }
      rewrittenLines.push(lines[i]);
    }
  }

  const modifiedBody = rewrittenLines.join("\n");

  // Build cover sheet
  const generatedAt = new Date().toISOString();
  const coverSheet = `# CDS Verification Report
## ${siteMeta.address}, ${siteMeta.city}, ${siteMeta.state} ${siteMeta.zip}

**Generated:** ${generatedAt}
**AI SIR Rating:** ${sirAi.rating} (Score: ${sirAi.score})
**AI Recommendation:** ${sirAi.recommendation}
**B/C Items for Verification:** ${bcRows.length}
**Cost Range (AI Estimate):** $${sirAi.cost_range_low.toLocaleString()} – $${sirAi.cost_range_high.toLocaleString()}

---

## Instructions for CDS

This document is a copy of the AI-generated Site Investigation Report with a **verification overlay**.

**Your task:**
1. Work through every table row that has confidence **B** or **C**.
2. For each B/C row, fill in three new columns appended at the end:
   - **CDS Verified Finding** — what you found via phone/web verification
   - **CDS Source** — the source you used (name, URL, or phone log)
   - **CDS Confidence** — your confidence in the verified finding (A or B)
3. Every B/C row has an HTML comment \`<!-- claim-id: SIR-XXX -->\` immediately below it.
   Do not remove these comments — they are used for automated extraction.
4. A-confidence rows are pre-verified and do not require action.
5. D-confidence task cards at the end of sections are field-only — skip them.
6. Return the completed document to this Drive folder when done.

**Authority contact information is in the Verification Task Summary below.**

---

## Verification Task Summary

${buildVerificationTaskSummary(bcRows, sirAi.authority_chain)}

---

*Original AI SIR follows below*

---

`;

  return {
    markdown: coverSheet + modifiedBody,
    bcItemCount: bcRows.length,
  };
}

/**
 * Look up a SIR finding for a given template line item.
 *
 * Strategy: search the markdown for a table row whose first cell loosely matches
 * the template item text, and extract the finding value and confidence level.
 *
 * Returns null if no matching finding is present (pure field task).
 */
interface SirFinding {
  value: string;
  confidence: "A" | "B" | "C";
  claimId: string;
}

function findSirFinding(
  templateItem: string,
  sirMarkdown: string,
  bcRows: BcRow[]
): SirFinding | null {
  // Build a simple keyword set from the template item
  const keywords = templateItem
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(" ")
    .filter((w) => w.length > 3);

  if (keywords.length === 0) return null;

  const lines = sirMarkdown.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) continue;

    const lineLower = line.toLowerCase();
    const matchCount = keywords.filter((kw) => lineLower.includes(kw)).length;

    // Require at least half the keywords to match (minimum 1)
    if (matchCount < Math.max(1, Math.ceil(keywords.length / 2))) continue;

    // Extract confidence from the row
    const confidenceMatch = line.match(/\|\s*([ABCD])\s*\|/);
    if (!confidenceMatch) continue;

    const conf = confidenceMatch[1] as "A" | "B" | "C" | "D";
    if (conf === "D") continue; // D means field-only, treat as no remote finding

    // Extract the finding value (second or third non-empty cell)
    const cells = line.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
    // cells[0] = item/field, cells[1] = finding, cells[2] = confidence (typically)
    const findingValue = cells[1] ?? cells[0] ?? "See SIR";

    // Find matching claim ID from bcRows if it's a B/C row
    const bcRow = bcRows.find((r) => r.lineIndex === i);
    const claimId = bcRow?.claimId ?? `SIR-${String(i).padStart(3, "0")}`;

    if (conf === "A") {
      return { value: findingValue, confidence: "A", claimId };
    }
    return { value: findingValue, confidence: conf as "B" | "C", claimId };
  }

  return null;
}

/**
 * Generate the Worksmith Pre-Filled Inspection Checklist markdown.
 */
function generateWorksмithChecklist(params: {
  sirMarkdown: string;
  sirAi: SirAi;
  siteMeta: SiteMeta;
  bcRows: BcRow[];
}): { markdown: string; totalItems: number; prefillCount: number; appendedTaskCount: number } {
  const { sirMarkdown, sirAi, siteMeta, bcRows } = params;

  const generatedAt = new Date().toISOString();
  const slug = addressSlug(siteMeta.address);
  void slug; // used only for filename externally

  // ── Cover Instructions ────────────────────────────────────────────────────
  const coverInstructions = `---
## How to Use This Checklist

This checklist is pre-filled with findings from AI research conducted on this property.
Your job as the field inspector:

1. **Answer the Deal-Killer Questions FIRST** — if any answer is No, call the Alpha
   contact immediately and stop the inspection.
2. **Work through each section** — the "AI Pre-Fill" column shows what we found
   remotely. Confirm it or write the correct finding in the "Finding" column.
3. **Fill in Source/Citation** for every item you personally verified.
4. **Complete the Site-Specific Tasks** at the end — these are items AI flagged as
   risks specific to this property and could not resolve remotely.
5. **Fill out the Cost Estimate table** for every deficiency you identify.
6. **Select your overall recommendation** at the bottom.

> Do not leave Source/Citation blank on any item you verified.

---

`;

  // ── Header Block ──────────────────────────────────────────────────────────
  const header = `# Worksmith Building Inspection Checklist
## ${siteMeta.address}, ${siteMeta.city}, ${siteMeta.state} ${siteMeta.zip}

| Field | Value |
|-------|-------|
| Property Address | ${siteMeta.address}, ${siteMeta.city}, ${siteMeta.state} ${siteMeta.zip} |
| Inspection Date | *(to be completed by inspector)* |
| Inspector Name / Firm | *(to be completed by inspector)* |
| Inspector Contact | *(to be completed by inspector)* |
| Target Occupancy | E — Private K-8 School |
| Planned Student Count | *(to be confirmed by Alpha)* |
| Planned Staff Count | *(to be confirmed by Alpha)* |
| Building Sq. Footage | *(to be measured on-site)* |
| Current Occupancy Type | ${sirAi.feasibility.occupancy_compatibility} |
| AI SIR Rating | ${sirAi.rating} (Score: ${sirAi.score}) |
| AI Cost Estimate | $${sirAi.cost_range_low.toLocaleString()} – $${sirAi.cost_range_high.toLocaleString()} |
| AI Timeline Estimate | ${sirAi.timeline_best_weeks}–${sirAi.timeline_worst_weeks} weeks |
| Generated | ${generatedAt} |

---

`;

  // ── Deal-Killer Questions ─────────────────────────────────────────────────
  const dealKillers = `## Deal-Killer Questions

> Answer these FIRST. If ANY answer is No, call the Alpha contact immediately and stop the inspection.

| # | Question | ☐ Yes | ☐ No | ☐ Needs Further Evaluation |
|---|----------|-------|------|----------------------------|
| 1 | Is there a safe parent drop-off/pick-up area? | ☐ | ☐ | ☐ |
| 2 | Are there at least 2 exits with adequate separation? | ☐ | ☐ | ☐ |
| 3 | Can all exit doors open outward with panic hardware? | ☐ | ☐ | ☐ |
| 4 | Is the building free from obvious structural deficiency? | ☐ | ☐ | ☐ |
| 5 | Is the building free from visible mold, water damage, or active leaks? | ☐ | ☐ | ☐ |

> **If ANY answer is No → call Alpha contact immediately. Stop inspection.**

---

`;

  // ── Template Sections ─────────────────────────────────────────────────────
  let totalItems = 0;
  let prefillCount = 0;
  let biClaimCounter = 1;

  const sectionBlocks: string[] = [];

  for (const section of INSPECTION_TEMPLATE) {
    const sectionLines: string[] = [`## ${section.title}\n`];
    sectionLines.push("| Item | AI Pre-Fill | Confirmed ☐ | Finding | Source/Citation | Notes |");
    sectionLines.push("|------|-------------|-------------|---------|-----------------|-------|");

    for (const item of section.items) {
      totalItems++;

      const finding = findSirFinding(item, sirMarkdown, bcRows);
      let preFill = "";
      let claimComment = "";

      if (finding) {
        prefillCount++;
        preFill = `${finding.value} *(${finding.confidence})*`;
        const biId = `BI-${String(biClaimCounter).padStart(3, "0")}`;
        claimComment = `\n<!-- claim-id: ${biId} -->`;
        biClaimCounter++;
      }

      sectionLines.push(`| ${item} | ${preFill} | ☐ |  |  |  |${claimComment}`);
    }

    if (section.note) {
      sectionLines.push(`\n> **Note:** ${section.note}`);
    }

    sectionLines.push("");
    sectionBlocks.push(sectionLines.join("\n"));
  }

  // ── Site-Specific Tasks ───────────────────────────────────────────────────
  // Gather D-confidence unknowns from sirAi and unknowns from SirUnknown list
  // that are field_only or that do not map to any template item.
  const fieldOnlyUnknowns: SirUnknown[] = sirAi.unknowns.filter((u) => u.field_only);

  // Also scan the SIR for D-confidence rows not already captured
  const dcRows = parseDRows(sirMarkdown);

  // Combine and deduplicate
  const siteSpecificTasks: Array<{ task: string; whyItMatters: string; whatToDocument: string }> =
    [];

  for (const unknown of fieldOnlyUnknowns) {
    siteSpecificTasks.push({
      task: unknown.item,
      whyItMatters: unknown.why_it_matters,
      whatToDocument: "Photograph, measure, and note condition. Record in Finding column.",
    });
  }

  for (const dcRow of dcRows) {
    // Only add if not already present
    const duplicate = siteSpecificTasks.some(
      (t) => t.task.toLowerCase().includes(dcRow.item.toLowerCase().slice(0, 20))
    );
    if (!duplicate) {
      siteSpecificTasks.push({
        task: dcRow.item,
        whyItMatters: dcRow.context,
        whatToDocument: "Photograph, measure, and note condition. Record in Finding column.",
      });
    }
  }

  const appendedTaskCount = siteSpecificTasks.length;

  let siteSpecificBlock = "";
  if (siteSpecificTasks.length > 0) {
    const rows = ["## Site-Specific Tasks\n"];
    rows.push(
      "These items were flagged by AI research as needing field verification for this specific property. They go beyond the standard checklist.\n"
    );
    rows.push("| # | Task | Why It Matters | What to Document |");
    rows.push("|---|------|----------------|------------------|");

    siteSpecificTasks.forEach((task, idx) => {
      rows.push(
        `| ${idx + 1} | ${task.task} | ${task.whyItMatters} | ${task.whatToDocument} |`
      );
    });

    rows.push("");
    siteSpecificBlock = rows.join("\n") + "\n";
    totalItems += appendedTaskCount;
  }

  // ── Occupant Load Verification ────────────────────────────────────────────
  const occupantLoadBlock = `## Occupant Load Verification

| Formula | Variable | AI Pre-Fill | Inspector Measurement |
|---------|----------|-------------|-----------------------|
| Total Occupant Load = Net Floor Area ÷ 100 | Net Floor Area (SF) |  | *(measure on-site)* |
| Total Occupant Load = Net Floor Area ÷ 100 | **Total Occupant Load** |  | *(calculate)* |
| Student Capacity = Net Learning Area ÷ 40 | Net Learning Area (SF) |  | *(measure on-site)* |
| Student Capacity = Net Learning Area ÷ 40 | **Student Capacity** |  | *(calculate)* |

> Occupant Load drives exit requirements, restroom fixture counts, and sprinkler triggers.

---

`;

  // ── Cost Estimate Table ───────────────────────────────────────────────────
  const costEstimateBlock = `## Cost Estimate

| Item | Description | Priority | Low Est. ($) | High Est. ($) | Notes |
|------|-------------|----------|--------------|---------------|-------|
| Fire Alarm | System upgrade/install |  |  |  |  |
| Egress | Exit hardware, doors, signage |  |  |  |  |
| ADA | Path-of-travel upgrades |  |  |  |  |
| Plumbing | Fixture additions/replacements |  |  |  |  |
| HVAC | Ventilation/system upgrades |  |  |  |  |
| Electrical | Panel, wiring, lighting |  |  |  |  |
| Structural | Repairs or engineer review |  |  |  |  |
| Sprinkler | System install/extension |  |  |  |  |
| Other |  |  |  |  |  |
| **TOTAL** |  |  |  |  |  |

---

`;

  // ── Overall Assessment ────────────────────────────────────────────────────
  const overallAssessmentBlock = `## Overall Assessment

| Recommendation | Select |
|----------------|--------|
| ☐ PROCEED | No critical issues identified — property is viable as-is or with minor work |
| ☐ PROCEED WITH CAUTION | Issues identified but remediation path is clear |
| ☐ REQUIRES JUSTIFICATION | Significant cost or timeline impact — escalate to Alpha |
| ☐ PASS | Critical issues — property not recommended |

**Inspector Signature:** _________________________________

**Date:** _________________________________

**Next Inspection Date (if applicable):** _________________________________

---
*End of Worksmith Inspection Checklist*
`;

  const fullMarkdown =
    coverInstructions +
    header +
    dealKillers +
    sectionBlocks.join("---\n\n") +
    "---\n\n" +
    siteSpecificBlock +
    "---\n\n" +
    occupantLoadBlock +
    costEstimateBlock +
    overallAssessmentBlock;

  return { markdown: fullMarkdown, totalItems, prefillCount, appendedTaskCount };
}

/**
 * Parse D-confidence rows from the SIR markdown for site-specific task extraction.
 */
interface DRow {
  item: string;
  context: string;
}

function parseDRows(markdown: string): DRow[] {
  const lines = markdown.split("\n");
  const results: DRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim().startsWith("|")) continue;
    if (!/\|\s*D\s*\|/.test(line)) continue;

    const cells = line.split("|").map((c) => c.trim()).filter((c) => c.length > 0);
    if (cells.length < 2) continue;

    const item = cells[0];
    const context = cells[1];

    if (item && item !== "Item" && item !== "---") {
      results.push({ item, context });
    }
  }

  return results;
}

/**
 * Compose the CDS dispatch email body.
 */
function composeCdsEmail(params: {
  siteMeta: SiteMeta;
  reportUrl: string;
  bcItemCount: number;
  sirAi: SirAi;
}): string {
  const { siteMeta, reportUrl, bcItemCount, sirAi } = params;
  return `Hi CDS team,

Please find attached the CDS Verification Report for:

  Property: ${siteMeta.address}, ${siteMeta.city}, ${siteMeta.state} ${siteMeta.zip}

This report contains ${bcItemCount} B/C-confidence findings that require phone or web verification.
The AI SIR rated this property: ${sirAi.rating} (${sirAi.recommendation}).

Report link: ${reportUrl}

Instructions are included at the top of the document. Each B/C row has a claim-id comment below it
(\`<!-- claim-id: SIR-XXX -->\`) — please do not remove these.

Please return the completed document to the same Drive folder when verification is complete.

Thank you,
Alpha DD Pipeline (automated)`;
}

/**
 * Compose the Worksmith dispatch email body.
 */
function composeWorksмithEmail(params: {
  siteMeta: SiteMeta;
  checklistUrl: string;
  totalItems: number;
  prefillCount: number;
  appendedTaskCount: number;
  sirAi: SirAi;
}): string {
  const { siteMeta, checklistUrl, totalItems, prefillCount, appendedTaskCount, sirAi } = params;
  return `Hi Worksmith team,

Please find the pre-filled inspection checklist for:

  Property: ${siteMeta.address}, ${siteMeta.city}, ${siteMeta.state} ${siteMeta.zip}

This checklist has been pre-populated with AI research findings:
  • Total checklist items: ${totalItems} (${prefillCount} pre-filled from AI research)
  • Site-specific tasks appended: ${appendedTaskCount}
  • AI SIR rating: ${sirAi.rating} (${sirAi.recommendation})
  • AI cost estimate: $${sirAi.cost_range_low.toLocaleString()} – $${sirAi.cost_range_high.toLocaleString()}

Checklist link: ${checklistUrl}

Please read the cover instructions at the top of the checklist before beginning.
Key reminder: answer the Deal-Killer Questions FIRST — if any answer is No, call us immediately.

Thank you,
Alpha DD Pipeline (automated)`;
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * WU-04: Dispatch vendor packets to CDS and Worksmith.
 *
 * Reads `site_meta` and `sir_ai` from Sindri, generates two markdown documents
 * (CDS Verification Report and Worksmith Pre-Filled Inspection Checklist), uploads
 * them to the M2/Permits Drive folder, emails each vendor, and writes
 * `vendor_packets_sent` to Sindri.
 *
 * @param siteId  Sindri site ID (from WU-01)
 * @param clients Injected service clients
 * @throws {UpstreamNotReady}   if site_meta or sir_ai are not yet in Sindri
 * @throws {ExternalApiError}   if Drive upload or email send fails after retries
 * @throws {PipelineError}      for other unrecoverable failures
 */
export async function dispatchVendorPackets(
  siteId: string,
  clients: WU04Clients
): Promise<VendorPacketsSent> {
  const { sindri, drive, email } = clients;

  // ── 1. Validate upstream data is ready ────────────────────────────────────
  const readiness = await sindri.existsMany(siteId, ["site_meta", "sir_ai"]);
  const missing: string[] = [];
  if (!readiness["site_meta"]) missing.push("site_meta");
  if (!readiness["sir_ai"]) missing.push("sir_ai");
  if (missing.length > 0) {
    throw new UpstreamNotReady(WU, siteId, missing);
  }

  // ── 2. Read upstream data ─────────────────────────────────────────────────
  const [siteMeta, sirAi] = await Promise.all([
    sindri.read(siteId, "site_meta"),
    sindri.read(siteId, "sir_ai"),
  ]);

  if (!siteMeta) throw new PipelineError(WU, siteId, "site_meta returned null after exists check");
  if (!sirAi) throw new PipelineError(WU, siteId, "sir_ai returned null after exists check");

  // ── 3. Read full AI SIR markdown from Drive ───────────────────────────────
  let sirMarkdown: string;
  try {
    sirMarkdown = await withRetry(() => drive.readFile(sirAi.report_url), {
      retryOn: (err) => err instanceof ExternalApiError,
    });
  } catch (err) {
    throw new ExternalApiError(
      WU,
      siteId,
      "Google Drive",
      null,
      `Failed to read SIR markdown from ${sirAi.report_url}: ${String(err)}`
    );
  }

  // ── 4. Parse B/C rows (used by both documents) ───────────────────────────
  const bcRows = parseBcRows(sirMarkdown);

  // ── 5. Generate CDS Verification Report ──────────────────────────────────
  const { markdown: cdsMarkdown, bcItemCount } = generateCdsReport({
    sirMarkdown,
    sirAi,
    siteMeta,
    bcRows,
  });

  const slug = addressSlug(siteMeta.address);
  const cdsFileName = `${slug}_cds-verification.md`;

  let cdsReportUrl: string;
  try {
    cdsReportUrl = await withRetry(
      () => drive.uploadFile(siteId, M2_FOLDER, cdsFileName, cdsMarkdown, "text/markdown"),
      {
        maxAttempts: 2,
        retryOn: (err) => err instanceof ExternalApiError,
      }
    );
  } catch (err) {
    throw new ExternalApiError(
      WU,
      siteId,
      "Google Drive",
      null,
      `Failed to upload CDS report: ${String(err)}`
    );
  }

  // ── 6. Generate Worksmith Inspection Checklist ────────────────────────────
  const {
    markdown: worksмithMarkdown,
    totalItems,
    prefillCount,
    appendedTaskCount,
  } = generateWorksмithChecklist({ sirMarkdown, sirAi, siteMeta, bcRows });

  const worksмithFileName = `${slug}_worksmith-checklist.md`;

  let worksмithChecklistUrl: string;
  try {
    worksмithChecklistUrl = await withRetry(
      () =>
        drive.uploadFile(
          siteId,
          M2_FOLDER,
          worksмithFileName,
          worksмithMarkdown,
          "text/markdown"
        ),
      {
        maxAttempts: 2,
        retryOn: (err) => err instanceof ExternalApiError,
      }
    );
  } catch (err) {
    throw new ExternalApiError(
      WU,
      siteId,
      "Google Drive",
      null,
      `Failed to upload Worksmith checklist: ${String(err)}`
    );
  }

  // ── 7. Send CDS email ─────────────────────────────────────────────────────
  const cdsEmailBody = composeCdsEmail({ siteMeta, reportUrl: cdsReportUrl, bcItemCount, sirAi });
  let cdsSentResult: { sentAt: string };
  try {
    cdsSentResult = await withRetry(
      () =>
        email.sendEmail({
          to: PIPELINE_CONFIG.CDS.DEFAULT_RECIPIENT,
          subject: `${PIPELINE_CONFIG.CDS.EMAIL_SUBJECT_PREFIX} ${siteMeta.address}, ${siteMeta.city}, ${siteMeta.state}`,
          body: cdsEmailBody,
        }),
      {
        retryOn: (err) => err instanceof ExternalApiError,
      }
    );
  } catch (err) {
    throw new ExternalApiError(
      WU,
      siteId,
      "Email (CDS)",
      null,
      `Failed to send CDS email: ${String(err)}`
    );
  }

  // ── 8. Send Worksmith email ───────────────────────────────────────────────
  const worksмithEmailBody = composeWorksмithEmail({
    siteMeta,
    checklistUrl: worksмithChecklistUrl,
    totalItems,
    prefillCount,
    appendedTaskCount,
    sirAi,
  });
  let worksмithSentResult: { sentAt: string };
  try {
    worksмithSentResult = await withRetry(
      () =>
        email.sendEmail({
          to: PIPELINE_CONFIG.WORKSMITH.DEFAULT_RECIPIENT,
          subject: `${PIPELINE_CONFIG.WORKSMITH.EMAIL_SUBJECT_PREFIX} ${siteMeta.address}, ${siteMeta.city}, ${siteMeta.state}`,
          body: worksмithEmailBody,
        }),
      {
        retryOn: (err) => err instanceof ExternalApiError,
      }
    );
  } catch (err) {
    throw new ExternalApiError(
      WU,
      siteId,
      "Email (Worksmith)",
      null,
      `Failed to send Worksmith email: ${String(err)}`
    );
  }

  // ── 9. Write vendor_packets_sent to Sindri ────────────────────────────────
  const vendorPacketsSent: VendorPacketsSent = {
    cds_email_sent_at: cdsSentResult.sentAt,
    cds_recipient: PIPELINE_CONFIG.CDS.DEFAULT_RECIPIENT,
    cds_report_url: cdsReportUrl,
    cds_bc_item_count: bcItemCount,
    worksmith_email_sent_at: worksмithSentResult.sentAt,
    worksmith_recipient: PIPELINE_CONFIG.WORKSMITH.DEFAULT_RECIPIENT,
    worksmith_checklist_url: worksмithChecklistUrl,
    worksmith_checklist_item_count: totalItems,
    worksmith_prefill_count: prefillCount,
    worksmith_appended_task_count: appendedTaskCount,
  };

  await sindri.write(siteId, "vendor_packets_sent", vendorPacketsSent);

  return vendorPacketsSent;
}
