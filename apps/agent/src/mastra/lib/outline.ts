/**
 * Story outline (skeleton) persistence.
 *
 * The story_outline workflow writes one of these per project on completion;
 * downstream phases (role_phase / episode_phase / script_phase / etc.) read
 * from here instead of re-analyzing raw text.
 *
 * Storage layers
 * ──────────────
 *   - **Redis** (`outline:<projectId>`, ~24-day TTL): hot cache, the read
 *     path most workers hit. Latest-wins semantics — re-running
 *     story_outline overwrites. Survives Redis restarts only because it's
 *     persistence-on (RDB/AOF); fundamentally transient.
 *   - **Artifact store** (LibSQL, see `artifact-store.ts`): durable home
 *     since this refactor landed. Every `putOutline` writes a new row
 *     versioned by `(projectId, "outline")`; `getOutline` falls through
 *     to it on Redis miss and rehydrates the cache. This means an old
 *     project whose Redis key TTL'd out is still recoverable, and a
 *     worker that comes up after a Redis flush keeps running.
 *
 * Latest-wins still holds at the API level: callers see whichever
 * version was last written. The artifact store keeps the history but
 * `getOutline` only returns the latest row.
 */
import { getRedis } from "./redis-client";
import { K, TTL } from "./redis-keys";
import { getLatestArtifact, putArtifact } from "./artifact-store";

/**
 * Minimal shape the persistence layer cares about. Kept loose so workflow
 * code can evolve without a cross-package rebuild; the actual validated
 * shape lives in `workflows/phases/script-breakdown.ts` (BreakdownShape).
 */
export interface StoryOutline {
  storySummary: string;
  genre: string;
  tone: string;
  structure: Array<{
    chapterId: string;
    title: string;
    summary: string;
    keyEvents: string[];
    emotion: string;
    hookToNext?: string;
  }>;
  threads: {
    main: string;
    subs: Array<{
      name: string;
      description: string;
      linkedChapterIds?: string[];
    }>;
  };
  cast: Array<{
    name: string;
    role: string;
    arc: string;
    firstAppearance?: string;
  }>;
  settings: Array<{
    name: string;
    typeHint: string;
    firstAppearance?: string;
  }>;
  props?: Array<{
    name: string;
    typeHint: string;
    firstAppearance?: string;
  }>;
}

export interface StoryOutlineRecord {
  projectId: string;
  outline: StoryOutline;
  /** runId of the workflow that produced this skeleton. */
  runId: string;
  /** Upstream source fingerprint so callers can detect stale skeletons. */
  sourceHash?: string;
  savedAt: number;
}

export async function putOutline(
  projectId: string,
  outline: StoryOutline,
  meta: { runId: string; sourceHash?: string }
): Promise<StoryOutlineRecord> {
  const record: StoryOutlineRecord = {
    projectId,
    outline,
    runId: meta.runId,
    sourceHash: meta.sourceHash,
    savedAt: Date.now(),
  };

  // Durable write first — if this throws, surface the error rather than
  // claim success when only the cache landed.
  await putArtifact<StoryOutlineRecord>({
    projectId,
    kind: "outline",
    source: "story_outline",
    content: record,
    meta: { runId: meta.runId, sourceHash: meta.sourceHash },
  });

  // Hot cache. Best-effort — a Redis failure here doesn't roll back the
  // durable write, since the read path falls through to the artifact
  // store on cache miss.
  try {
    const redis = getRedis();
    await redis.set(K.outline(projectId), JSON.stringify(record), "EX", TTL.OUTLINE);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[outline] redis cache write failed (durable write succeeded):", err);
  }

  return record;
}

export async function getOutline(projectId: string): Promise<StoryOutlineRecord | null> {
  // Hot path — Redis cache.
  try {
    const redis = getRedis();
    const raw = await redis.get(K.outline(projectId));
    if (raw) {
      try {
        return JSON.parse(raw) as StoryOutlineRecord;
      } catch {
        // Fall through to durable read on corrupt JSON.
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[outline] redis read failed, falling back to artifact store:", err);
  }

  // Cold path — durable artifact store. This is what saves projects
  // whose Redis key TTL'd out, or runs that come up after a flush.
  const artifact = await getLatestArtifact<StoryOutlineRecord>(projectId, "outline");
  if (!artifact) return null;
  const record = artifact.content;

  // Best-effort rehydrate the hot cache so subsequent reads stay fast.
  try {
    const redis = getRedis();
    await redis.set(K.outline(projectId), JSON.stringify(record), "EX", TTL.OUTLINE);
  } catch {
    // Non-fatal — caller still gets the record.
  }

  return record;
}

export async function deleteOutline(projectId: string): Promise<void> {
  // Caches only — the artifact-store row stays as history. We never delete
  // durable workflow products: callers who want a fresh outline write a
  // new version via putOutline, and getOutline returns the latest one.
  const redis = getRedis();
  await redis.del(K.outline(projectId));
}
