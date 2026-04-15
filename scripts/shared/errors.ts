/**
 * Pipeline Error Types
 *
 * Structured errors for consistent handling across work units.
 */

/** Base error for all pipeline errors */
export class PipelineError extends Error {
  constructor(
    public readonly workUnit: string,
    public readonly siteId: string,
    message: string,
    public readonly retryable: boolean = false
  ) {
    super(`[${workUnit}] ${siteId}: ${message}`);
    this.name = "PipelineError";
  }
}

/** Upstream data not yet available — not an error, just not ready */
export class UpstreamNotReady extends PipelineError {
  public readonly missingKeys: string[];

  constructor(workUnit: string, siteId: string, missingKeys: string[]) {
    super(
      workUnit,
      siteId,
      `Upstream data not ready: ${missingKeys.join(", ")}`,
      false
    );
    this.name = "UpstreamNotReady";
    this.missingKeys = missingKeys;
  }
}

/** External API call failed */
export class ExternalApiError extends PipelineError {
  constructor(
    workUnit: string,
    siteId: string,
    public readonly service: string,
    public readonly statusCode: number | null,
    message: string
  ) {
    super(workUnit, siteId, `${service} API error: ${message}`, true);
    this.name = "ExternalApiError";
  }
}

/** Data extraction or parsing failed */
export class ExtractionError extends PipelineError {
  constructor(
    workUnit: string,
    siteId: string,
    public readonly field: string,
    message: string
  ) {
    super(workUnit, siteId, `Extraction failed for ${field}: ${message}`, false);
    this.name = "ExtractionError";
  }
}

/** Validation failed — data doesn't match expected schema */
export class ValidationError extends PipelineError {
  constructor(
    workUnit: string,
    siteId: string,
    public readonly violations: string[]
  ) {
    super(
      workUnit,
      siteId,
      `Validation failed: ${violations.join("; ")}`,
      false
    );
    this.name = "ValidationError";
  }
}
