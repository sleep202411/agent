/**
 * A draft play-test walks the chapter the author is editing, not the whole
 * story: a chapter owns its own entry scene, so without `chapterId` a
 * multi-chapter work could only ever be walked from its very first scene.
 * Omitting it still walks everything, which is what a single-chapter work wants.
 *
 * `revision` and `videoSnapshotHash` form the freshness token the canvas had
 * just saved when navigation started. The playtest keys its runtime query by
 * them, so unchanged round trips reuse the compiled preview while draft edits
 * or media re-picks compile afresh.
 */
export type StoryProjectPlaytestSource =
  | {
      kind: "draft";
      chapterId?: string;
      revision?: number;
      videoSnapshotHash?: string;
    }
  | {
      kind: "build";
      buildId: string;
      chapterId?: undefined;
      revision?: undefined;
      videoSnapshotHash?: undefined;
    };

export type StoryPlaytestSearchParams = {
  buildId?: string | string[];
  chapter?: string | string[];
  rev?: string | string[];
  vsh?: string | string[];
};

export function parseStoryPlaytestSource(
  query: StoryPlaytestSearchParams
): StoryProjectPlaytestSource {
  const buildId = firstQueryValue(query.buildId)?.trim();
  // A Build is already frozen to one scope, so a chapter hint could only
  // contradict it.
  if (buildId) return { kind: "build", buildId };
  const chapterId = firstQueryValue(query.chapter)?.trim();
  const revisionValue = firstQueryValue(query.rev)?.trim();
  const revision = revisionValue ? Number.parseInt(revisionValue, 10) : undefined;
  const videoSnapshotHash = firstQueryValue(query.vsh)?.trim();
  return {
    kind: "draft",
    ...(chapterId ? { chapterId } : {}),
    ...(Number.isFinite(revision) && revision !== undefined && revision > 0 ? { revision } : {}),
    ...(videoSnapshotHash ? { videoSnapshotHash } : {}),
  };
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
