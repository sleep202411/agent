"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useWorkspace } from "@/app/_components/workspace-context";
import { getStoryWorkbench, type StoryWorkbench } from "@/lib/story-projects-api";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

/**
 * The chapter projection (project, chapters, draft, script/video state) every
 * project-chrome surface reads: the rail's dock tenants, the header actions,
 * the storyboard board. One key, one fetch — they share a cache entry instead
 * of each re-reading the workbench.
 */
export function storyChapterWorkbenchQueryKey(
  workspaceId: string | null,
  projectId: string,
  chapterId: string | null
) {
  return ["story-studio", "chapter-workbench", workspaceId, projectId, chapterId] as const;
}

/** Invalidation prefix covering every chapter of every project. */
export const STORY_CHAPTER_WORKBENCH_QUERY_PREFIX = ["story-studio", "chapter-workbench"] as const;

export function useStoryChapterWorkbench(
  projectId: string,
  options?: { chapterId?: string | null }
): UseQueryResult<StoryWorkbench> & { workspaceId: string | null; chapterId: string | null } {
  const { activeWorkspace } = useWorkspace();
  const workspaceId = activeWorkspace?.id ?? null;
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const chapterId = options?.chapterId !== undefined ? options.chapterId : activeChapterId;
  const query = useQuery({
    queryKey: storyChapterWorkbenchQueryKey(workspaceId, projectId, chapterId),
    queryFn: () => getStoryWorkbench(workspaceId as string, projectId, chapterId as string),
    enabled: Boolean(workspaceId && chapterId),
    retry: false,
  });
  return Object.assign(query, { workspaceId, chapterId });
}
