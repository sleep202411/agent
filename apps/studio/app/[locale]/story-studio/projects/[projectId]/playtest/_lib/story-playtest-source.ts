/**
 * A draft play-test walks the chapter the author is editing, not the whole
 * story: a chapter owns its own entry scene, so without `chapterId` a
 * multi-chapter work could only ever be walked from its very first scene.
 * Omitting it still walks everything, which is what a single-chapter work wants.
 *
 * `sceneId` names the scene the walk should enter at — a purely client-side
 * pick; the whole chapter still compiles.
 */
export type StoryProjectPlaytestSource =
  | { kind: "draft"; chapterId?: string; sceneId?: string }
  | { kind: "build"; buildId: string; chapterId?: undefined; sceneId?: undefined };

export type StoryPlaytestSearchParams = {
  buildId?: string | string[];
  chapter?: string | string[];
  scene?: string | string[];
};

export function parseStoryPlaytestSource(
  query: StoryPlaytestSearchParams
): StoryProjectPlaytestSource {
  const buildId = firstQueryValue(query.buildId)?.trim();
  // A Build is already frozen to one scope, so a chapter hint could only
  // contradict it.
  if (buildId) return { kind: "build", buildId };
  const chapterId = firstQueryValue(query.chapter)?.trim();
  const sceneId = firstQueryValue(query.scene)?.trim();
  return {
    kind: "draft",
    ...(chapterId ? { chapterId } : {}),
    ...(sceneId ? { sceneId } : {}),
  };
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
