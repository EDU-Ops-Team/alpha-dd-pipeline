/**
 * WU-14: Report Distribution
 *
 * Final work unit in the DD pipeline. Triggered when WU-13 signals completion
 * by writing a `dd_report` record to Sindri.
 *
 * Responsibilities:
 *   1. Read `dd_report` (WU-13 output) and `site_meta` (WU-01 output) from Sindri.
 *   2. Compose a stakeholder email containing the report link and key findings
 *      (score, recommendation).
 *   3. Send the email to P1 + the configured stakeholder list via Gmail.
 *   4. Post a summary notification to the Google Chat DD channel.
 *   5. Write `distribution_log` to Sindri so the pipeline has an audit trail.
 *
 * Error contract:
 *   - Upstream data missing → throws UpstreamNotReady (pipeline should reschedule).
 *   - Email delivery fails → retried with exponential backoff; throws PipelineError
 *     after max attempts.
 *   - Chat notification fails → logged as a warning, does NOT block completion.
 *     The report has already been emailed; a Chat failure is non-critical.
 */

import {
  type DdReport,
  type SiteMeta,
  type DistributionLog,
  type SindriClient,
  PIPELINE_CONFIG,
  UpstreamNotReady,
  PipelineError,
  withRetry,
} from "../shared";

// ─── External Service Interfaces ────────────────────────────────────────────
// Concrete implementations are injected by the Convex action at call-site.

/** A single outbound email message. */
export interface OutboundEmail {
  to: string[];
  subject: string;
  /** Plain-text fallback body */
  body: string;
  /** Optional HTML body; mailer uses it when supported */
  htmlBody?: string;
}

/** Result returned after a successful email send. */
export interface EmailSendResult {
  /** Provider-assigned message ID (e.g. Gmail message ID) */
  messageId: string;
  /** ISO timestamp when the message was accepted by the provider */
  acceptedAt: string;
}

/** Minimal Gmail send interface needed by WU-14. */
export interface EmailClient {
  /**
   * Send an outbound email.
   * Resolves when the provider accepts the message; rejects on failure.
   */
  send(email: OutboundEmail): Promise<EmailSendResult>;
}

/** A card/message posted to a Google Chat space. */
export interface ChatMessage {
  /** Google Chat space name, e.g. "spaces/dd-reports" */
  space: string;
  /** Plain-text message body (Chat may also render basic markdown) */
  text: string;
}

/** Result returned after a successful Chat post. */
export interface ChatPostResult {
  /** Provider-assigned message name */
  messageName: string;
  /** ISO timestamp when the message was posted */
  postedAt: string;
}

/** Minimal Google Chat interface needed by WU-14. */
export interface ChatClient {
  /**
   * Post a message to a Chat space.
   * Resolves when the message is accepted; rejects on failure.
   */
  postMessage(message: ChatMessage): Promise<ChatPostResult>;
}

// ─── Clients Bag ─────────────────────────────────────────────────────────────

/** All external clients required by distributeReport, injected by the caller. */
export interface DistributionClients {
  sindri: SindriClient;
  email: EmailClient;
  chat: ChatClient;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const WORK_UNIT = "WU-14";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build the list of recipient email addresses for the DD report distribution.
 *
 * Always includes P1 (the site contact) when available, plus the configured
 * stakeholder list from PIPELINE_CONFIG. Deduplicates so P1 isn't emailed twice
 * if they happen to be on the stakeholder list.
 */
function buildRecipientList(siteMeta: SiteMeta): string[] {
  const stakeholders = [...PIPELINE_CONFIG.DISTRIBUTION.STAKEHOLDER_EMAILS];
  const recipients = new Set<string>(stakeholders);

  if (siteMeta.p1_email) {
    recipients.add(siteMeta.p1_email);
  }

  return Array.from(recipients);
}

/**
 * Compose the plain-text email body for the DD report notification.
 * Includes the report link, site details, and key findings.
 */
function composeEmailBody(
  siteMeta: SiteMeta,
  report: DdReport
): string {
  const p1Greeting =
    siteMeta.p1_name ? `Hi ${siteMeta.p1_name},\n\n` : "Hello,\n\n";

  const scoreSection =
    report.score !== null
      ? `Score:          ${report.score}\n`
      : "";

  return [
    p1Greeting,
    "The Due Diligence report for the site below has been completed and is ready for review.\n",
    "\n",
    "─── Site Details ───────────────────────────────────────────\n",
    `Address:        ${siteMeta.address}\n`,
    `School Type:    ${siteMeta.school_type}\n`,
    `Pipeline Stage: ${siteMeta.stage}\n`,
    "\n",
    "─── Report Summary ─────────────────────────────────────────\n",
    scoreSection,
    `Recommendation: ${report.recommendation}\n`,
    `Report Version: ${report.version}\n`,
    "\n",
    "─── Report Link ────────────────────────────────────────────\n",
    `${report.doc_url}\n`,
    "\n",
    "This message was sent automatically by the Alpha DD Pipeline.\n",
    "Reply to this email if you have questions.\n",
  ].join("");
}

/**
 * Compose the HTML variant of the email body.
 * Used when the email provider supports HTML rendering.
 */
function composeEmailHtml(
  siteMeta: SiteMeta,
  report: DdReport
): string {
  const scoreRow =
    report.score !== null
      ? `<tr><td><strong>Score</strong></td><td>${report.score}</td></tr>`
      : "";

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /></head>
<body style="font-family: sans-serif; color: #111; max-width: 600px; margin: 0 auto;">
  <h2 style="border-bottom: 2px solid #333; padding-bottom: 8px;">
    DD Report Ready: ${siteMeta.address}
  </h2>
  <p>The Due Diligence report for the site below has been completed and is ready for review.</p>

  <h3>Site Details</h3>
  <table style="border-collapse: collapse; width: 100%;">
    <tr><td><strong>Address</strong></td><td>${siteMeta.address}</td></tr>
    <tr><td><strong>School Type</strong></td><td>${siteMeta.school_type}</td></tr>
    <tr><td><strong>Pipeline Stage</strong></td><td>${siteMeta.stage}</td></tr>
  </table>

  <h3>Report Summary</h3>
  <table style="border-collapse: collapse; width: 100%;">
    ${scoreRow}
    <tr><td><strong>Recommendation</strong></td><td>${report.recommendation}</td></tr>
    <tr><td><strong>Version</strong></td><td>${report.version}</td></tr>
  </table>

  <h3>Report Link</h3>
  <p><a href="${report.doc_url}" style="color: #1a73e8;">${report.doc_url}</a></p>

  <hr style="margin-top: 32px;" />
  <p style="font-size: 12px; color: #666;">
    Sent automatically by the Alpha DD Pipeline. Reply to this email with questions.
  </p>
</body>
</html>`.trim();
}

/**
 * Compose the Google Chat card text for the distribution notification.
 */
function composeChatMessage(siteMeta: SiteMeta, report: DdReport): string {
  const scoreText =
    report.score !== null ? ` | Score: *${report.score}*` : "";

  return (
    `*DD Report Ready* — ${siteMeta.address}\n` +
    `Recommendation: *${report.recommendation}*${scoreText}\n` +
    `Report: ${report.doc_url}`
  );
}

// ─── Main Export ─────────────────────────────────────────────────────────────

/**
 * WU-14 handler: distribute the completed DD report to stakeholders via email
 * and post a Google Chat notification.
 *
 * @param siteId   - The pipeline site ID (RHODES / Sindri key).
 * @param clients  - Injected external service clients (Sindri, EmailClient, ChatClient).
 * @returns        The written DistributionLog record.
 *
 * @throws {UpstreamNotReady}  When `dd_report` or `site_meta` are not yet in Sindri.
 * @throws {PipelineError}     When email delivery fails after all retry attempts.
 */
export async function distributeReport(
  siteId: string,
  clients: DistributionClients
): Promise<DistributionLog> {
  if (!siteId || siteId.trim() === "") {
    throw new PipelineError(WORK_UNIT, siteId, "siteId must be a non-empty string.", false);
  }

  const { sindri, email, chat } = clients;

  // ── Step 1: Read upstream data from Sindri ───────────────────────────────
  const [ddReport, siteMeta] = await Promise.all([
    sindri.read(siteId, "dd_report"),
    sindri.read(siteId, "site_meta"),
  ]);

  const missingKeys: string[] = [];
  if (!ddReport) missingKeys.push("dd_report");
  if (!siteMeta) missingKeys.push("site_meta");

  if (missingKeys.length > 0) {
    throw new UpstreamNotReady(WORK_UNIT, siteId, missingKeys);
  }

  // TypeScript narrowing: both are non-null after the check above.
  const report = ddReport as DdReport;
  const meta = siteMeta as SiteMeta;

  // Validate that the report actually has a document URL before distributing.
  if (!report.doc_url || report.doc_url.trim() === "") {
    throw new PipelineError(
      WORK_UNIT,
      siteId,
      "dd_report.doc_url is empty — cannot distribute a report without a link.",
      false
    );
  }

  // ── Step 2 + 3: Compose and send the email ───────────────────────────────
  const recipients = buildRecipientList(meta);

  if (recipients.length === 0) {
    // No P1 and no stakeholder list configured — warn but don't hard-fail.
    // The Chat notification can still go out.
    console.warn(
      `[${WORK_UNIT}] ${siteId}: Recipient list is empty — no email will be sent. ` +
        "Check PIPELINE_CONFIG.DISTRIBUTION.STAKEHOLDER_EMAILS and site_meta.p1_email."
    );
  }

  const subject =
    `${PIPELINE_CONFIG.DISTRIBUTION.EMAIL_SUBJECT_PREFIX} ` +
    `${meta.address}`;

  let emailSentAt = "";
  if (recipients.length > 0) {
    const outbound: OutboundEmail = {
      to: recipients,
      subject,
      body: composeEmailBody(meta, report),
      htmlBody: composeEmailHtml(meta, report),
    };

    const sendResult = await withRetry(
      () => email.send(outbound),
      {
        retryOn: (err) => {
          // Retry on any error; let withRetry respect maxAttempts from config.
          return err instanceof Error;
        },
      }
    ).catch((err) => {
      throw new PipelineError(
        WORK_UNIT,
        siteId,
        `Email delivery failed after ${PIPELINE_CONFIG.RETRY.MAX_ATTEMPTS} attempts: ` +
          `${err instanceof Error ? err.message : String(err)}`,
        true
      );
    });

    emailSentAt = sendResult.acceptedAt;
    console.info(
      `[${WORK_UNIT}] ${siteId}: Email sent to ${recipients.length} recipient(s) ` +
        `(messageId=${sendResult.messageId})`
    );
  }

  // ── Step 4: Post Google Chat notification ────────────────────────────────
  // A Chat failure is non-critical — log a warning but do not throw.
  let chatNotifiedAt = "";
  const chatSpace = PIPELINE_CONFIG.DISTRIBUTION.CHAT_SPACE;

  try {
    const chatResult = await chat.postMessage({
      space: chatSpace,
      text: composeChatMessage(meta, report),
    });
    chatNotifiedAt = chatResult.postedAt;
    console.info(
      `[${WORK_UNIT}] ${siteId}: Chat notification posted ` +
        `(message=${chatResult.messageName})`
    );
  } catch (chatErr) {
    console.warn(
      `[${WORK_UNIT}] ${siteId}: Google Chat notification failed (non-fatal) — ` +
        `${chatErr instanceof Error ? chatErr.message : String(chatErr)}`
    );
    // chatNotifiedAt remains "" — logged in distribution_log so operators can see it failed.
  }

  // ── Step 5: Write distribution_log to Sindri ─────────────────────────────
  const distributionLog: DistributionLog = {
    email_sent_at: emailSentAt,
    recipients,
    chat_notified_at: chatNotifiedAt,
    chat_space: chatSpace,
  };

  await sindri.write(siteId, "distribution_log", distributionLog);

  // ── Step 6: Signal completion ─────────────────────────────────────────────
  console.info(
    `[${WORK_UNIT}] ${siteId}: Distribution complete — ` +
      `email_sent_at="${emailSentAt}", chat_notified_at="${chatNotifiedAt}"`
  );

  return distributionLog;
}
