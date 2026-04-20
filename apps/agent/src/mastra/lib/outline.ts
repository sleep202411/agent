/**
 * Story outline (skeleton) persistence.
 *
 * The story_outline workflow writes one of these per project on completion;
 * downstream phases (role_phase / episode_phase / script_phase / etc.) read
 * from here instead of re-analyzing raw text.
 *
 * Latest-wins semantics: re-running story_outline for the same project
 * overwrites the previous skeleton. This is intentional — if the user
 * uploads a new draft we want the freshest skeleton. TTL is 30 days.
 */
import { getRedis } from "./redis-client";
import { K, TTL } from "./redis-keys";

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
  const redis = getRedis();
  await redis.set(K.outline(projectId), JSON.stringify(record), "EX", TTL.OUTLINE);
  return record;
}

export async function getOutline(projectId: string): Promise<StoryOutlineRecord | null> {
  const redis = getRedis();
  const raw = await redis.get(K.outline(projectId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoryOutlineRecord;
  } catch {
    return null;
  }
}

export async function deleteOutline(projectId: string): Promise<void> {
  const redis = getRedis();
  await redis.del(K.outline(projectId));
}
