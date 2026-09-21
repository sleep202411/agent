import type { QueryClient, QueryKey } from "@tanstack/react-query";

import type { StoryWorkbench } from "@/lib/story-projects-api";

/** Keep the canvas projection and shared project docks on the same saved draft. */
export function cacheStoryWorkbenchDraft(
  queryClient: QueryClient,
  queryKeys: readonly QueryKey[],
  saved: StoryWorkbench["draft"]
) {
  const adoptSavedDraft = (current: StoryWorkbench | undefined) =>
    current && saved.revision >= current.draft.revision ? { ...current, draft: saved } : current;

  for (const queryKey of queryKeys) {
    queryClient.setQueryData<StoryWorkbench>(queryKey, adoptSavedDraft);
  }
}
