import { useLocalSearchParams } from "expo-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { isAgentOsId } from "@/features/agent/lib/ids";
import { storyProjectsApi, type StoryCapability } from "@/features/agent/api/studio-projects-api";

type StoryChapterContextValue = {
  projectId: string;
  projectTitle: string;
  chapterId: string;
  capabilities: StoryCapability[];
  draftRevision: number | null;
  videoSnapshotHash: string | null;
  loading: boolean;
  error: string | undefined;
  refresh: () => void;
};

const StoryChapterContext = createContext<StoryChapterContextValue | null>(null);

export function StoryChapterProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const { chapterId: chapterIdParam } = useLocalSearchParams<{ chapterId?: string }>();
  const chapterIdFromQuery = chapterIdParam?.trim() ?? "";
  const [chapterId, setChapterId] = useState(
    isAgentOsId(chapterIdFromQuery) ? chapterIdFromQuery : ""
  );
  const [projectTitle, setProjectTitle] = useState("");
  const [capabilities, setCapabilities] = useState<StoryCapability[]>([]);
  const [draftRevision, setDraftRevision] = useState<number | null>(null);
  const [videoSnapshotHash, setVideoSnapshotHash] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => {
    setRefreshKey((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);

    void (async () => {
      try {
        const chapterHint = isAgentOsId(chapterIdFromQuery) ? chapterIdFromQuery : undefined;
        const workbench = await storyProjectsApi.getWorkbench(projectId, chapterHint);
        if (cancelled) return;
        const resolvedChapter =
          (chapterHint &&
            workbench.chapters?.some((chapter) => chapter.id === chapterHint) &&
            chapterHint) ||
          workbench.chapter?.id?.trim() ||
          workbench.chapters?.[0]?.id?.trim() ||
          "";
        if (!resolvedChapter) {
          throw new Error("Story project has no chapter for Agent OS story mode");
        }
        setChapterId(resolvedChapter);
        setProjectTitle(workbench.project?.title?.trim() ?? "");
        setCapabilities(workbench.project?.capabilities ?? []);
        setDraftRevision(
          typeof workbench.draft?.revision === "number" ? workbench.draft.revision : null
        );
        setVideoSnapshotHash(workbench.video?.snapshotHash?.trim() || null);
      } catch (err) {
        if (cancelled) return;
        setChapterId("");
        setProjectTitle("");
        setCapabilities([]);
        setDraftRevision(null);
        setVideoSnapshotHash(null);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chapterIdFromQuery, projectId, refreshKey]);

  const value = useMemo(
    () => ({
      projectId,
      projectTitle,
      chapterId,
      capabilities,
      draftRevision,
      videoSnapshotHash,
      loading,
      error,
      refresh,
    }),
    [
      capabilities,
      chapterId,
      draftRevision,
      error,
      loading,
      projectId,
      projectTitle,
      refresh,
      videoSnapshotHash,
    ]
  );

  return <StoryChapterContext.Provider value={value}>{children}</StoryChapterContext.Provider>;
}

export function useStoryChapterContext(): StoryChapterContextValue {
  const context = useContext(StoryChapterContext);
  if (!context) {
    throw new Error("useStoryChapterContext must be used within StoryChapterProvider");
  }
  return context;
}
