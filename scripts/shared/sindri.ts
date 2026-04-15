/**
 * Sindri Client Interface
 *
 * Abstraction over the Sindri pipeline data layer.
 * Concrete implementation will depend on the Convex backend setup.
 *
 * Every script reads from and writes to Sindri through this interface.
 * The client is typed — read<"sir_ai">() returns SirAi, etc.
 */

import type { SindriKey, SindriDataMap } from "./types";

export interface SindriClient {
  /**
   * Read a work unit's output from Sindri.
   * Returns null if the data doesn't exist yet (upstream WU hasn't run).
   */
  read<K extends SindriKey>(
    siteId: string,
    key: K
  ): Promise<SindriDataMap[K] | null>;

  /**
   * Write a work unit's output to Sindri.
   * Overwrites any existing data for the same site + key.
   */
  write<K extends SindriKey>(
    siteId: string,
    key: K,
    data: SindriDataMap[K]
  ): Promise<void>;

  /**
   * Check whether a specific key exists for a site.
   * Cheaper than read() when you only need to know if upstream ran.
   */
  exists(siteId: string, key: SindriKey): Promise<boolean>;

  /**
   * Check multiple keys at once. Returns a map of key → exists.
   * Used for readiness checks (e.g., WU-13 needs 8 keys present).
   */
  existsMany(
    siteId: string,
    keys: SindriKey[]
  ): Promise<Record<SindriKey, boolean>>;
}
