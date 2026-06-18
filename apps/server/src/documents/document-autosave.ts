/**
 * Autosave retention planner (pure, side-effect free).
 *
 * Autosave checkpoints are stamped as a document settles, so they accumulate.
 * This thins them "near-dense, far-sparse" (Time-Machine style): keep everything
 * recent, then one per hour for the last day, then one per day — bounded by a
 * hard cap. Manual / system versions are never passed in here (kept forever).
 */

export interface AutosaveRetentionConfig {
  /** Age (ms) under which every autosave is kept. */
  denseWindowMs: number;
  /** Age (ms) under which autosaves thin to one per hour (above the dense window). */
  hourlyWindowMs: number;
  /** Hard cap on retained autosaves (oldest survivors beyond this are dropped). */
  maxKeep: number;
}

export interface RetainableVersion {
  id: string;
  createdAtMs: number;
}

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Given a document's autosave versions, return the ids to DELETE so the
 * survivors are dense-recent / sparse-old and within the cap. Deterministic.
 */
export function planAutosaveRetention(
  autosaves: readonly RetainableVersion[],
  nowMs: number,
  config: AutosaveRetentionConfig,
): string[] {
  const newestFirst = [...autosaves].sort(
    (a, b) => b.createdAtMs - a.createdAtMs,
  );
  const keep = new Set<string>();
  const hourBuckets = new Set<number>();
  const dayBuckets = new Set<number>();

  for (const version of newestFirst) {
    const age = nowMs - version.createdAtMs;
    if (age <= config.denseWindowMs) {
      keep.add(version.id); // tier 1 — keep all recent
    } else if (age <= config.hourlyWindowMs) {
      const bucket = Math.floor(version.createdAtMs / HOUR_MS);
      if (!hourBuckets.has(bucket)) {
        hourBuckets.add(bucket); // tier 2 — newest per hour
        keep.add(version.id);
      }
    } else {
      const bucket = Math.floor(version.createdAtMs / DAY_MS);
      if (!dayBuckets.has(bucket)) {
        dayBuckets.add(bucket); // tier 3 — newest per day
        keep.add(version.id);
      }
    }
  }

  // Hard cap: among the survivors, keep only the newest `maxKeep`.
  const survivors = newestFirst.filter((v) => keep.has(v.id));
  const capped = new Set(survivors.slice(0, config.maxKeep).map((v) => v.id));
  return newestFirst.filter((v) => !capped.has(v.id)).map((v) => v.id);
}
