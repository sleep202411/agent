"use client";

import { useEffect, useMemo, useRef } from "react";
import { IconLoader2 } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useAuth } from "@/app/_components/auth-provider";
import { getStoryWorkbench } from "@/lib/story-projects-api";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";
import {
  shouldRetryStoryProjectAccess,
  storyProjectAccessFailure,
} from "./story-project-access-error";
import { StoryProjectLoadState } from "./story-project-load-state";
import { nextChapterUrlSync, resolveStoryChapterId } from "./story-project-chapter-scope-state";

/** Prefix for the shell's chapter catalogue. Chapter mutations must invalidate it. */
export const STORY_CHAPTER_SCOPE_QUERY_KEY = ["story-studio", "chapter-scope"] as const;

/**
 * Makes the active chapter a route-level invariant for the whole project shell.
 * Overview is project-scoped; every production surface and FizzAgent consume
 * this same chapter identity. No child may silently invent a different default.
 */
export function StoryProjectChapterScope({
  projectId,
  children,
}: {
  projectId: string;
  children: React.ReactNode;
}) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const { signIn, user } = useAuth();
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const setActiveChapterId = useStoryProjectUiStore((state) => state.setActiveChapterId);
  const requestedChapterId = searchParams.get("chapter");
  const chapterUrlSync = useRef<string | null>(null);

  const workbenchQuery = useQuery({
    queryKey: [...STORY_CHAPTER_SCOPE_QUERY_KEY, projectId, user?.id ?? null],
    queryFn: ({ signal }) => getStoryWorkbench(projectId, undefined, signal),
    retry: shouldRetryStoryProjectAccess,
  });
  const chapterIds = useMemo(
    () => new Set(workbenchQuery.data?.chapters.map((chapter) => chapter.id) ?? []),
    [workbenchQuery.data?.chapters]
  );
  const resolvedChapterId = resolveStoryChapterId({
    requestedChapterId,
    activeChapterId,
    chapterIds,
    fallbackChapterId: workbenchQuery.data?.chapter.id ?? null,
  });

  useEffect(() => {
    if (!resolvedChapterId || activeChapterId === resolvedChapterId) return;
    setActiveChapterId(resolvedChapterId);
  }, [activeChapterId, resolvedChapterId, setActiveChapterId]);

  useEffect(() => {
    const decision = nextChapterUrlSync({
      pendingHref: chapterUrlSync.current,
      pathname,
      search: searchParams.toString(),
      requestedChapterId,
      resolvedChapterId,
    });
    chapterUrlSync.current = decision.pendingHref;
    if (decision.replaceHref) router.replace(decision.replaceHref, { scroll: false });
  }, [pathname, requestedChapterId, resolvedChapterId, router, searchParams]);

  useEffect(
    () => () => {
      setActiveChapterId(null);
    },
    [projectId, user?.id, setActiveChapterId]
  );

  const abandonedRead =
    workbenchQuery.isError &&
    isAbandonedChapterRead(workbenchQuery.error) &&
    workbenchQuery.isFetching;
  if (workbenchQuery.isError && !abandonedRead) {
    return (
      <StoryProjectLoadState
        kind={storyProjectAccessFailure(workbenchQuery.error) ?? "unexpected"}
        onRetry={() => void workbenchQuery.refetch()}
        onSignIn={signIn}
      />
    );
  }

  if (!resolvedChapterId || activeChapterId !== resolvedChapterId) {
    return (
      <main
        aria-busy="true"
        className="grid h-dvh w-full place-items-center bg-[var(--canvas-background)] text-white/54"
      >
        <IconLoader2 className="size-5 animate-spin" aria-hidden="true" />
      </main>
    );
  }
  return <>{children}</>;
}

function isAbandonedChapterRead(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error ? error.name : null;
  return name === "AbortError" || name === "CancelledError";
}
