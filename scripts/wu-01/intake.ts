/**
 * WU-01: New Site Intake
 *
 * Entry point for the DD pipeline. Triggered when the EmailAgentConnector
 * detects a "New Site" email with a Letter of Intent (LOI) attachment.
 *
 * Responsibilities:
 *   1. Parse the inbound email — extract sender, address, school type, LOI attachment.
 *   2. Validate and normalise the US street address (regex extraction + decomposition).
 *   3. Create the site record in RHODES so other teams have business-facing visibility.
 *   4. Stand up the standard six-stage Google Drive folder structure.
 *   5. Upload the LOI PDF into the M1 folder.
 *   6. Update RHODES with the Drive folder URL.
 *   7. Write `site_meta` to Sindri so every downstream work unit (WU-02 … WU-13) has a
 *      stable source of truth to read from.
 *
 * Error contract:
 *   - Address cannot be extracted → throws ExtractionError (non-retryable; needs human review).
 *   - RHODES or Drive calls fail → throws PipelineError with retryable=true.
 */

import {
  type SiteMeta,
  type SchoolType,
  type SindriClient,
  type RhodesClient,
  PIPELINE_CONFIG,
  ExtractionError,
  ExternalApiError,
  PipelineError,
  withRetry,
} from "../shared";

// ─── External Service Interfaces ────────────────────────────────────────────
// Declared here so the contracts are explicit before concrete implementations
// exist. The concrete clients will be injected at call-site (Convex action).

/** A binary attachment on an inbound email. */
export interface EmailAttachment {
  /** Original filename, e.g. "LOI_123_Main_St.pdf" */
  filename: string;
  /** MIME type, e.g. "application/pdf" */
  mimeType: string;
  /** Raw attachment bytes */
  data: Uint8Array;
}

/** Parsed representation of an inbound Gmail message. */
export interface ParsedEmail {
  /** RFC 5322 Message-ID */
  messageId: string;
  /** Sender's display name (may be empty string) */
  fromName: string;
  /** Sender's email address */
  fromEmail: string;
  /** Email subject line */
  subject: string;
  /** Plain-text body of the message */
  body: string;
  /** All attachments on the message */
  attachments: EmailAttachment[];
}

/** Slim read-only interface for fetching a raw Gmail message. */
export interface GmailClient {
  /**
   * Fetch a single message by Gmail message ID.
   * Throws on network / auth errors.
   */
  getMessage(messageId: string): Promise<ParsedEmail>;
}

/** Result of creating a folder in Google Drive. */
export interface DriveFolder {
  /** Google Drive folder ID */
  folderId: string;
  /** Human-readable web URL for the folder */
  webViewLink: string;
}

/** Result of uploading a file to Google Drive. */
export interface DriveFile {
  /** Google Drive file ID */
  fileId: string;
  /** Human-readable web URL for the file */
  webViewLink: string;
}

/** Subset of the Google Drive API needed by WU-01. */
export interface DriveClient {
  /**
   * Create a folder inside a given parent folder.
   * Pass `null` for `parentFolderId` to create at the root of "My Drive".
   */
  createFolder(name: string, parentFolderId: string | null): Promise<DriveFolder>;

  /**
   * Upload a binary file into a Drive folder.
   * Returns the Drive file metadata including a public/shared web link.
   */
  uploadFile(
    name: string,
    mimeType: string,
    data: Uint8Array,
    parentFolderId: string
  ): Promise<DriveFile>;
}

// ─── Clients Bag ─────────────────────────────────────────────────────────────

/** All external clients required by handleNewSiteIntake, injected by the caller. */
export interface IntakeClients {
  sindri: SindriClient;
  rhodes: RhodesClient;
  drive: DriveClient;
  gmail: GmailClient;
}

// ─── Internal Types ───────────────────────────────────────────────────────────

/** A fully decomposed US street address. */
interface ParsedAddress {
  /** Full one-line address, e.g. "123 Main St, Springfield, IL 62701" */
  full: string;
  /** Street line only, e.g. "123 Main St" */
  street: string;
  city: string;
  state: string;
  zip: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WORK_UNIT = "WU-01";

/**
 * Matches a US street address of the form:
 *   <number> <street name>, <city>, <STATE> <zip>
 *
 * Intentionally permissive on street names (accepts unit/suite suffixes etc.).
 * Named capture groups map directly onto ParsedAddress fields.
 */
const US_ADDRESS_REGEX =
  /(?<street>\d+\s+[A-Za-z0-9\s.,#'-]+),\s*(?<city>[A-Za-z\s]+),\s*(?<state>[A-Z]{2})\s+(?<zip>\d{5}(?:-\d{4})?)/;

/**
 * Keywords used to infer school type from the email body.
 * First match wins; falls back to "micro".
 */
const SCHOOL_TYPE_PATTERNS: Array<{ pattern: RegExp; type: SchoolType }> = [
  { pattern: /\b1[,\s]?000[-\s]?student/i, type: "1000" },
  { pattern: /\b1000[-\s]?seat/i, type: "1000" },
  { pattern: /\b250[-\s]?student/i, type: "250" },
  { pattern: /\b250[-\s]?seat/i, type: "250" },
  { pattern: /\bmicro[-\s]?school/i, type: "micro" },
  { pattern: /\bsmall[-\s]?school/i, type: "micro" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract and decompose a US street address from a free-text string.
 * Returns null when no match is found (caller decides how to handle).
 */
function extractAddress(text: string): ParsedAddress | null {
  const match = US_ADDRESS_REGEX.exec(text);
  if (!match || !match.groups) return null;

  const { street, city, state, zip } = match.groups as Record<string, string>;
  const trimmedStreet = street.trim().replace(/,\s*$/, "");
  const trimmedCity = city.trim();

  return {
    full: `${trimmedStreet}, ${trimmedCity}, ${state} ${zip}`,
    street: trimmedStreet,
    city: trimmedCity,
    state,
    zip,
  };
}

/**
 * Infer the school type from email body text.
 * Defaults to "micro" when no explicit keyword is found.
 */
function extractSchoolType(text: string): SchoolType {
  for (const { pattern, type } of SCHOOL_TYPE_PATTERNS) {
    if (pattern.test(text)) return type;
  }
  return "micro";
}

/**
 * Pick the most likely LOI attachment from the email.
 * Prefers PDFs; falls back to the first attachment if none is a PDF.
 * Returns null when there are no attachments.
 */
function selectLoiAttachment(attachments: EmailAttachment[]): EmailAttachment | null {
  if (attachments.length === 0) return null;
  const pdf = attachments.find((a) => a.mimeType === "application/pdf");
  return pdf ?? attachments[0];
}

/**
 * Derive a human-friendly site name from the address, used as the root Drive
 * folder name. e.g. "123 Main St, Springfield IL"
 */
function siteNameFromAddress(parsed: ParsedAddress): string {
  return `${parsed.street}, ${parsed.city} ${parsed.state}`;
}

/**
 * Create the standard six M-stage sub-folders inside the given root folder.
 * Returns a map of folder-name → DriveFolder so callers can reference specific
 * stage folders (e.g., M1 for the LOI upload).
 */
async function createStageFolders(
  drive: DriveClient,
  rootFolderId: string
): Promise<Map<string, DriveFolder>> {
  const folders = new Map<string, DriveFolder>();

  for (const folderName of PIPELINE_CONFIG.DRIVE_FOLDER_STRUCTURE) {
    const folder = await drive.createFolder(folderName, rootFolderId);
    folders.set(folderName, folder);
  }

  return folders;
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * WU-01 handler: parse a New Site intake email and provision all downstream
 * resources (RHODES site record, Drive folder tree, Sindri site_meta).
 *
 * @param email       - The fully parsed inbound email from the EmailAgentConnector.
 * @param clients     - Injected external service clients (Sindri, RHODES, Drive, Gmail).
 * @returns           The written SiteMeta record (useful for testing / chaining).
 *
 * @throws {ExtractionError}  When a US address cannot be found in the email.
 * @throws {PipelineError}    When RHODES or Drive calls fail after retries.
 */
export async function handleNewSiteIntake(
  email: ParsedEmail,
  clients: IntakeClients
): Promise<SiteMeta> {
  const { sindri, rhodes, drive } = clients;

  // ── Step 1: Extract address ──────────────────────────────────────────────
  // Try the email body first; fall back to the subject line.
  const searchText = `${email.body}\n${email.subject}`;
  const parsed = extractAddress(searchText);

  if (!parsed) {
    throw new ExtractionError(
      WORK_UNIT,
      "unknown",
      "address",
      "No valid US address found in email body or subject — human review required."
    );
  }

  // ── Step 2: Extract school type ──────────────────────────────────────────
  const schoolType = extractSchoolType(searchText);

  // ── Step 3: Create RHODES site record ────────────────────────────────────
  // We don't have a Drive URL yet, so pass an empty string as a placeholder
  // and update it after folder creation (step 5).
  let siteId: string;
  try {
    siteId = await withRetry(
      () =>
        rhodes.createSite({
          address: parsed.street,
          city: parsed.city,
          state: parsed.state,
          zip: parsed.zip,
          school_type: schoolType,
          stage: "M1",
          drive_folder_url: "",
        }),
      { retryOn: () => true }
    );
  } catch (err) {
    throw new PipelineError(
      WORK_UNIT,
      parsed.full,
      `RHODES site creation failed: ${err instanceof Error ? err.message : String(err)}`,
      true
    );
  }

  // ── Step 4: Create root Drive folder + M-stage sub-folders ───────────────
  const siteName = siteNameFromAddress(parsed);
  let rootFolder: DriveFolder;
  let stageFolders: Map<string, DriveFolder>;

  try {
    rootFolder = await withRetry(() => drive.createFolder(siteName, null), {
      retryOn: () => true,
    });

    stageFolders = await withRetry(
      () => createStageFolders(drive, rootFolder.folderId),
      { retryOn: () => true }
    );
  } catch (err) {
    throw new PipelineError(
      WORK_UNIT,
      siteId,
      `Google Drive folder creation failed: ${err instanceof Error ? err.message : String(err)}`,
      true
    );
  }

  // ── Step 5: Upload LOI to M1 folder ──────────────────────────────────────
  const loiAttachment = selectLoiAttachment(email.attachments);
  const m1FolderName = PIPELINE_CONFIG.DRIVE_FOLDER_STRUCTURE[0]; // "M1 - Acquire Property"
  const m1Folder = stageFolders.get(m1FolderName);

  let loiDocUrl: string;

  if (loiAttachment && m1Folder) {
    try {
      const loiFile = await withRetry(
        () =>
          drive.uploadFile(
            loiAttachment.filename || "LOI.pdf",
            loiAttachment.mimeType,
            loiAttachment.data,
            m1Folder.folderId
          ),
        { retryOn: () => true }
      );
      loiDocUrl = loiFile.webViewLink;
    } catch (err) {
      // LOI upload failure is non-fatal: site can proceed without the file
      // as long as a human re-uploads later. Log and continue.
      console.warn(
        `[${WORK_UNIT}] ${siteId}: LOI upload failed (non-fatal) — ` +
          `${err instanceof Error ? err.message : String(err)}`
      );
      loiDocUrl = "";
    }
  } else {
    // No attachment on the email; pipeline can proceed but will need manual upload.
    console.warn(`[${WORK_UNIT}] ${siteId}: No LOI attachment found on intake email.`);
    loiDocUrl = "";
  }

  // ── Step 6: Update RHODES with the Drive folder URL ──────────────────────
  try {
    await withRetry(
      () => rhodes.updateSite(siteId, { drive_folder_url: rootFolder.webViewLink }),
      { retryOn: () => true }
    );
  } catch (err) {
    throw new PipelineError(
      WORK_UNIT,
      siteId,
      `RHODES drive_folder_url update failed: ${err instanceof Error ? err.message : String(err)}`,
      true
    );
  }

  // ── Step 7: Extract sender details (P1) ──────────────────────────────────
  const p1Name = email.fromName.length > 0 ? email.fromName : null;
  const p1Email = email.fromEmail.length > 0 ? email.fromEmail : null;

  // ── Step 8: Write site_meta to Sindri ────────────────────────────────────
  const siteMeta: SiteMeta = {
    site_id: siteId,
    address: parsed.full,
    city: parsed.city,
    state: parsed.state,
    zip: parsed.zip,
    school_type: schoolType,
    drive_folder_url: rootFolder.webViewLink,
    loi_doc_url: loiDocUrl,
    p1_name: p1Name,
    p1_email: p1Email,
    stage: "M1",
    created_at: new Date().toISOString(),
  };

  await sindri.write(siteId, "site_meta", siteMeta);

  // ── Step 9: Signal completion ─────────────────────────────────────────────
  console.info(
    `[${WORK_UNIT}] ${siteId}: Intake complete — ` +
      `address="${parsed.full}", school_type="${schoolType}", ` +
      `drive="${rootFolder.webViewLink}"`
  );

  return siteMeta;
}
