"use client";

import { useAuth } from "@/app/_components/auth-provider";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { getStoryWorkbench, type StoryWorkbench } from "@/lib/story-projects-api";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";

/**
 * The chapter projection (project, chapters, draft, script/video state) every
 * project-chrome surface reads: the rail's dock tenants, the header actions,
 * the storyboard board. One key, one fetch — they share a cache entry instead
 * of each re-reading the workbench.
 */
export function storyChapterWorkbenchQueryKey(
  projectId: string,
  chapterId: string | null,
  userId?: string | number | null
) {
  return [
    "story-studio",
    "chapter-workbench",
    projectId,
    chapterId,
    ...(userId === undefined ? [] : [userId]),
  ] as const;
}

/** Invalidation prefix covering every chapter of every project. */
export const STORY_CHAPTER_WORKBENCH_QUERY_PREFIX = ["story-studio", "chapter-workbench"] as const;

export function useStoryChapterWorkbench(
  projectId: string,
  options?: { chapterId?: string | null }
): UseQueryResult<StoryWorkbench> & { workspaceId: string | null; chapterId: string | null } {
  const { user } = useAuth();
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const chapterId = options?.chapterId !== undefined ? options.chapterId : activeChapterId;
  const query = useQuery({
    queryKey: storyChapterWorkbenchQueryKey(projectId, chapterId, user?.id ?? null),
    queryFn: ({ signal }) => getStoryWorkbench(projectId, chapterId as string, signal),
    enabled: Boolean(projectId && chapterId && user),
    retry: false,
  });
  const workspaceId = query.data?.project.workspaceId ?? null;
  return Object.assign(query, { workspaceId, chapterId });
}
