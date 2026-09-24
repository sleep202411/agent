"use client";

import { useQuery } from "@tanstack/react-query";
import {
  getStoryWorkingPreview,
  type StoryApiIssue,
  type StoryBuildDiagnostic,
} from "@/lib/story-projects-api";

/**
 * The canvas's view of what blocks publishing. There is no manual "check"
 * action: publish failures that carry issues populate the cache, and the
 * canvas paints them as per-scene badges. The shape matches a working-preview
 * compile's diagnostics so both sources agree on what a blocker looks like.
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

/**
 * The query is deliberately never auto-run: mounting only reads whatever a
 * failed publish left in the cache, because compiling is a full server
 * round-trip and publish failures already paid it.
 */
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

/** Publish-failure issues recast into the diagnostic shape the canvas groups. */
export function storyDraftCheckFromPublishIssues(
  draftRevision: number,
  issues: readonly StoryApiIssue[]
): StoryDraftCheckResult {
  return {
    draftRevision,
    diagnostics: issues.map((issue) => ({
      severity: "error" as const,
      code: issue.code ?? "STORY_PUBLISH_BLOCKED",
      message: issue.message,
      entityType: null,
      entityId: issue.nodeId,
    })),
  };
}
