/**
 * WU-11: Shovels Permit History
 *
 * Pulls the full permit history for the site address from the Shovels API
 * and writes structured results to both Sindri and RHODES.
 *
 * A result with zero permits is valid and is written as an empty list —
 * the absence of permits is itself meaningful for construction planning.
 *
 * Invoking event: UpstreamCompleted from WU-01 — `site_meta` (with address)
 * exists in Sindri.
 *
 * Connectors: Shovels API (https://api.shovels.ai/v2)
 *
 * Sindri data in:  site_meta
 * Sindri data out: permit_history
 * RHODES write:    writePermitHistory
 */

import type { SindriClient } from "../shared/sindri";
import type { RhodesClient } from "../shared/rhodes";
import type { Permit, PermitHistory } from "../shared/types";
import { PIPELINE_CONFIG } from "../shared/config";
import { UpstreamNotReady, ExternalApiError } from "../shared/errors";
import { withRetry } from "../shared/retry";

// ─── Shovels Client Interface ─────────────────────────────────────────────────

/** Request parameters for the Shovels get_permits endpoint */
export interface ShovelsGetPermitsRequest {
  /** Full street address including city and state */
  address: string;
}

/** A single permit record returned by the Shovels API */
export interface ShovelsPermit {
  permit_number: string;
  type: string;
  status: string;
  issued_date: string;
  description: string;
  /** Raw extra fields — captured but not forwarded to canonical type */
  [key: string]: unknown;
}

/** The response from the Shovels get_permits endpoint */
export interface ShovelsGetPermitsResponse {
  address: string;
  permits: ShovelsPermit[];
  total: number;
  query_timestamp: string;
}

/** Interface for the Shovels API client */
export interface ShovelsClient {
  /**
   * Fetch all permit records associated with an address.
   * Returns an empty permits array (not an error) when no records exist.
   * @throws on non-2xx HTTP responses or network failures
   */
  getPermits(
    request: ShovelsGetPermitsRequest
  ): Promise<ShovelsGetPermitsResponse>;
}

// ─── Injected Dependencies ───────────────────────────────────────────────────

/** Injected dependencies for testability */
export interface GetPermitHistoryDeps {
  sindri: SindriClient;
  rhodes: RhodesClient;
  shovels: ShovelsClient;
}

// ─── Response Parser ──────────────────────────────────────────────────────────

/**
 * Normalise a raw ShovelsPermit into the canonical Permit shape.
 * Coerces any unexpected nullish values to empty strings to maintain
 * a fully populated record.
 */
function parsePermit(raw: ShovelsPermit): Permit {
  return {
    permit_number: raw.permit_number ?? "",
    type: raw.type ?? "",
    status: raw.status ?? "",
    issued_date: raw.issued_date ?? "",
    description: raw.description ?? "",
  };
}

/**
 * Build the canonical PermitHistory document from a Shovels API response.
 */
function parsePermitHistory(
  response: ShovelsGetPermitsResponse
): PermitHistory {
  const permits: Permit[] = (response.permits ?? []).map(parsePermit);

  return {
    queried_at: new Date().toISOString(),
    address: response.address,
    permits,
    total_permits: permits.length,
  };
}

// ─── Address Formatter ────────────────────────────────────────────────────────

/**
 * Compose a full address string suitable for the Shovels API query.
 * The Shovels API expects "street, city, state zip" format.
 */
function formatAddress(
  address: string,
  city: string,
  state: string,
  zip: string
): string {
  const parts = [address.trim()];
  const cityState = [city.trim(), state.trim()].filter(Boolean).join(", ");
  if (cityState) parts.push(cityState);
  if (zip.trim()) parts.push(zip.trim());
  return parts.join(", ");
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Pull the permit history for the site address from the Shovels API,
 * then persist the result to Sindri and RHODES.
 *
 * An empty permit list is written as a valid result — callers should not
 * treat zero permits as an error condition.
 *
 * @param siteId - The Sindri site identifier
 * @param deps   - Injected clients (sindri, rhodes, shovels)
 *
 * @throws {UpstreamNotReady} if `site_meta` is not yet available
 * @throws {ExternalApiError} if the Shovels API fails after all retries
 */
export async function getPermitHistory(
  siteId: string,
  deps: GetPermitHistoryDeps
): Promise<void> {
  const { sindri, rhodes, shovels } = deps;

  // 1. Read site_meta to get address
  const siteMeta = await sindri.read(siteId, "site_meta");
  if (!siteMeta) {
    throw new UpstreamNotReady("WU-11", siteId, ["site_meta"]);
  }

  // 2. Validate that we have a non-empty address before calling the API
  if (!siteMeta.address || siteMeta.address.trim() === "") {
    throw new UpstreamNotReady("WU-11", siteId, [
      "site_meta.address (address field is empty)",
    ]);
  }

  // 3. Build full address string for the Shovels query
  const fullAddress = formatAddress(
    siteMeta.address,
    siteMeta.city,
    siteMeta.state,
    siteMeta.zip
  );

  // 4. Call Shovels API with retry + exponential backoff
  let shovelsResponse: ShovelsGetPermitsResponse;
  try {
    shovelsResponse = await withRetry(
      () => shovels.getPermits({ address: fullAddress }),
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
      "WU-11",
      siteId,
      "Shovels",
      null,
      err instanceof Error ? err.message : String(err)
    );
  }

  // 5. Parse response — zero permits is valid, not an error
  const permitHistory = parsePermitHistory(shovelsResponse);

  // 6. Persist to Sindri and RHODES in parallel
  await Promise.all([
    sindri.write(siteId, "permit_history", permitHistory),
    rhodes.writePermitHistory(siteId, permitHistory),
  ]);
}
