/**
 * Retry utility with exponential backoff.
 * Used by scripts that call external APIs (Shovels, RayCon, Gmail).
 */

import { PIPELINE_CONFIG } from "./config";

interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  backoffMultiplier?: number;
  /** Optional: only retry on these error types */
  retryOn?: (error: unknown) => boolean;
}

/**
 * Retry an async function with exponential backoff.
 *
 * @example
 * const result = await withRetry(() => shovelsApi.getPermits(address), {
 *   maxAttempts: 3,
 *   retryOn: (err) => err instanceof ExternalApiError,
 * });
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = PIPELINE_CONFIG.RETRY.MAX_ATTEMPTS,
    initialDelayMs = PIPELINE_CONFIG.RETRY.INITIAL_DELAY_MS,
    backoffMultiplier = PIPELINE_CONFIG.RETRY.BACKOFF_MULTIPLIER,
    retryOn = () => true,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts || !retryOn(error)) {
        throw error;
      }

      const delay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Should never reach here, but TypeScript needs it
  throw lastError;
}
