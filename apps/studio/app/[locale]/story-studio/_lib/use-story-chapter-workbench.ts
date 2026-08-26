"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getStoryWorkbench, type StoryWorkbench } from "@/lib/story-projects-api";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

/**
 * The chapter projection (project, chapters, draft, script/video state) every
 * project-chrome surface reads: the rail's dock tenants, the header actions,
 * the storyboard board. One key, one fetch — they share a cache entry instead
 * of each re-reading the workbench.
 */
export function storyChapterWorkbenchQueryKey(projectId: string, chapterId: string | null) {
  return ["story-studio", "chapter-workbench", projectId, chapterId] as const;
}

/** Invalidation prefix covering every chapter of every project. */
export const STORY_CHAPTER_WORKBENCH_QUERY_PREFIX = ["story-studio", "chapter-workbench"] as const;

export function useStoryChapterWorkbench(
  projectId: string,
  options?: { chapterId?: string | null }
): UseQueryResult<StoryWorkbench> & { workspaceId: string | null; chapterId: string | null } {
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const chapterId = options?.chapterId !== undefined ? options.chapterId : activeChapterId;
  const query = useQuery({
    queryKey: storyChapterWorkbenchQueryKey(projectId, chapterId),
    queryFn: () => getStoryWorkbench(projectId, chapterId as string),
    enabled: Boolean(chapterId),
    retry: false,
  });
  const workspaceId = query.data?.project.workspaceId ?? null;
  return Object.assign(query, { workspaceId, chapterId });
}
