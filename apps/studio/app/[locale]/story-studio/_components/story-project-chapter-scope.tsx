"use client";

import { useEffect, useMemo } from "react";
import { IconAlertTriangle, IconLoader2, IconRefresh } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { getStoryWorkbench, storyApiErrorMessage } from "@/lib/story-projects-api";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";
import { resolveStoryChapterId } from "./story-project-chapter-scope-state";

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
  const commonT = useTranslations("common");
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const setActiveChapterId = useStoryProjectUiStore((state) => state.setActiveChapterId);
  const requestedChapterId = searchParams.get("chapter");

  const workbenchQuery = useQuery({
    queryKey: ["story-studio", "chapter-scope", projectId],
    queryFn: () => getStoryWorkbench(projectId),
    retry: false,
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
    if (!resolvedChapterId) return;
    if (activeChapterId !== resolvedChapterId) {
      setActiveChapterId(resolvedChapterId);
    }
    if (requestedChapterId === resolvedChapterId) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set("chapter", resolvedChapterId);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [
    pathname,
    activeChapterId,
    requestedChapterId,
    resolvedChapterId,
    router,
    searchParams,
    setActiveChapterId,
  ]);

  useEffect(
    () => () => {
      setActiveChapterId(null);
    },
    [projectId, setActiveChapterId]
  );

  if (workbenchQuery.isError || (!workbenchQuery.isPending && !resolvedChapterId)) {
    return (
      <main className="grid h-dvh w-full place-items-center bg-[var(--canvas-background)] px-6 text-center">
        <div className="max-w-lg">
          <IconAlertTriangle className="mx-auto size-6 text-white/58" aria-hidden="true" />
          <p role="alert" className="mt-3 text-sm leading-6 text-white/72">
            {storyApiErrorMessage(workbenchQuery.error, commonT("error"))}
          </p>
          <Button
            type="button"
            variant="secondary"
            className="mt-5"
            onClick={() => void workbenchQuery.refetch()}
          >
            <IconRefresh aria-hidden="true" />
            {commonT("retry")}
          </Button>
        </div>
      </main>
    );
  }

  if (workbenchQuery.isPending || activeChapterId !== resolvedChapterId) {
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
