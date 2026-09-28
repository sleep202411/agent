/**
 * A draft play-test stays inside the chapter being edited.
 *
 * `sceneId` is the node whose play button was pressed. The server compiles
 * from that node; the chapter entry is not consulted for this start.
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
