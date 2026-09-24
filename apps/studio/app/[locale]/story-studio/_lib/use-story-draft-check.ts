"use client";

import { useQuery, type QueryClient } from "@tanstack/react-query";
import { getStoryWorkingPreview, type StoryBuildDiagnostic } from "@/lib/story-projects-api";

/**
 * A publish-readiness check over the saved draft. It reuses the working
 * preview compile — the same pipeline the playtest and release run — so the
 * canvas badges and the playtest failure screen always agree on what blocks.
 *
 * The query is deliberately never auto-run: mounting only reads whatever a
 * previous check left in the cache, because compiling is a full server
 * round-trip. The header check button (and publish failures) populate it.
 */
export interface StoryDraftCheckResult {
  draftRevision: number;
  diagnostics: StoryBuildDiagnostic[];
}

export function storyDraftCheckQueryKey(
  projectId: string,
  chapterId: string | null
): [string, string, string, string | null] {
  return ["story-studio", "story-draft-check", projectId, chapterId];
}

export function useStoryDraftCheck(projectId: string, chapterId: string | null) {
  return useQuery({
    queryKey: storyDraftCheckQueryKey(projectId, chapterId),
    queryFn: async ({ signal }) => {
      const preview = await getStoryWorkingPreview(
        projectId,
        chapterId ?? undefined,
        undefined,
        signal
      );
      return {
        draftRevision: preview.draftRevision,
        diagnostics: preview.diagnostics,
      } satisfies StoryDraftCheckResult;
    },
    enabled: false,
    staleTime: Infinity,
    retry: false,
  });
}

export async function runStoryDraftCheck(
  queryClient: QueryClient,
  projectId: string,
  chapterId: string | null,
  signal?: AbortSignal
): Promise<StoryDraftCheckResult> {
  return queryClient.fetchQuery({
    queryKey: storyDraftCheckQueryKey(projectId, chapterId),
    queryFn: async ({ signal: fetchSignal }) => {
      const preview = await getStoryWorkingPreview(
        projectId,
        chapterId ?? undefined,
        undefined,
        fetchSignal ?? signal
      );
      return {
        draftRevision: preview.draftRevision,
        diagnostics: preview.diagnostics,
      } satisfies StoryDraftCheckResult;
    },
    staleTime: Infinity,
  });
}
