export type StoryProjectPlaytestSource = { kind: "draft" } | { kind: "build"; buildId: string };

export type StoryPlaytestSearchParams = {
  buildId?: string | string[];
};

export function parseStoryPlaytestSource(
  query: StoryPlaytestSearchParams
): StoryProjectPlaytestSource {
  const buildId = firstQueryValue(query.buildId)?.trim();
  if (buildId) return { kind: "build", buildId };
  return { kind: "draft" };
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
