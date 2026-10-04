import { useGlobalSearchParams } from "expo-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  getInteractiveFilmPublication,
  type InteractiveFilmPublication,
} from "@/features/agent/api/interactive-film-publication-api";
import { isAgentOsId } from "@/features/agent/lib/ids";
import {
  storyProjectsApi,
  type StoryBillingBalance,
  type StoryCapability,
} from "@/features/agent/api/studio-projects-api";
import { isAppActive, subscribeAppActive } from "@/hooks/app-active";

/** Header remote reads — same cadence as H5 credits / publication badges. */
const REMOTE_POLL_MS = 30_000;

type StoryChapterContextValue = {
  projectId: string;
  projectTitle: string;
  chapterId: string;
  capabilities: StoryCapability[];
  draftRevision: number | null;
  videoSnapshotHash: string | null;
  billingBalance: StoryBillingBalance | null;
  publication: InteractiveFilmPublication | null;
  publicationLoading: boolean;
  publicationFailed: boolean;
  publicationError: string | undefined;
  refreshPublication: () => void;
  loading: boolean;
  error: string | undefined;
  refresh: () => void;
  setPublication: (next: InteractiveFilmPublication | null) => void;
};

const StoryChapterContext = createContext<StoryChapterContextValue | null>(null);

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0]?.trim() ?? "";
  return value?.trim() ?? "";
}

export function StoryChapterProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const route = useGlobalSearchParams<{
    projectId?: string | string[];
    chapterId?: string | string[];
    title?: string | string[];
  }>();
  // This provider belongs to the parent tab layout; its local params omit
  // the focused child route's query. Ignore global updates for other projects.
  const [selection, setSelection] = useState({ chapterId: "", title: "" });
  const focusedProject = firstParam(route.projectId) === projectId;
  const chapterIdFromQuery = focusedProject ? firstParam(route.chapterId) : selection.chapterId;
  const previewTitle = focusedProject ? firstParam(route.title) : selection.title;
  if (selection.chapterId !== chapterIdFromQuery || selection.title !== previewTitle)
    setSelection({ chapterId: chapterIdFromQuery, title: previewTitle });
  const [chapterId, setChapterId] = useState(
    isAgentOsId(chapterIdFromQuery) ? chapterIdFromQuery : ""
  );
  const [projectTitle, setProjectTitle] = useState(previewTitle);
  const [capabilities, setCapabilities] = useState<StoryCapability[]>([]);
  const [draftRevision, setDraftRevision] = useState<number | null>(null);
  const [videoSnapshotHash, setVideoSnapshotHash] = useState<string | null>(null);
  const [billingBalance, setBillingBalance] = useState<StoryBillingBalance | null>(null);
  const [publication, setPublication] = useState<InteractiveFilmPublication | null>(null);
  const [publicationLoading, setPublicationLoading] = useState(true);
  const [publicationFailed, setPublicationFailed] = useState(false);
  const [publicationError, setPublicationError] = useState<string>();
  const [publicationRefreshKey, setPublicationRefreshKey] = useState(0);
  const refreshPublication = useCallback(() => setPublicationRefreshKey((value) => value + 1), []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [refreshKey, setRefreshKey] = useState(0);

  const workbenchKey = `${projectId}:${chapterIdFromQuery}:${previewTitle}:${refreshKey}`;
  const [previousWorkbenchKey, setPreviousWorkbenchKey] = useState(workbenchKey);
  if (previousWorkbenchKey !== workbenchKey) {
    setPreviousWorkbenchKey(workbenchKey);
    setLoading(true);
    setError(undefined);
  }

  const refresh = useCallback(() => {
    setRefreshKey((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;

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
        setProjectTitle(workbench.project?.title?.trim() || previewTitle);
        setCapabilities(workbench.project?.capabilities ?? []);
        setDraftRevision(
          typeof workbench.draft?.revision === "number" ? workbench.draft.revision : null
        );
        setVideoSnapshotHash(workbench.video?.snapshotHash?.trim() || null);
      } catch (err) {
        if (cancelled) return;
        setChapterId("");
        if (!previewTitle) setProjectTitle("");
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
  }, [chapterIdFromQuery, previewTitle, projectId, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const load = async () => {
      try {
        const next = await storyProjectsApi.getBillingBalance(projectId, controller.signal);
        if (cancelled || controller.signal.aborted) return;
        setBillingBalance(next);
      } catch {
        // Keep the last known balance — a blip must not flash "—" while generating.
      }
    };

    void load();
    const timer = setInterval(() => {
      if (!isAppActive()) return;
      void load();
    }, REMOTE_POLL_MS);
    const unsubscribe = subscribeAppActive((active) => {
      if (active) void load();
    });

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
      unsubscribe();
    };
  }, [projectId, refreshKey]);

  const canRelease = capabilities.includes("story.release");

  useEffect(() => {
    if (!canRelease) return;

    let cancelled = false;
    const controller = new AbortController();
    let pending = false;
    const load = async (silent: boolean) => {
      if (pending) return;
      pending = true;
      if (!silent) setPublicationLoading(true);
      try {
        const next = await getInteractiveFilmPublication(projectId, controller.signal);
        if (cancelled || controller.signal.aborted) return;
        setPublication(next);
        setPublicationFailed(false);
        setPublicationError(undefined);
      } catch (error) {
        if (cancelled || controller.signal.aborted) return;
        setPublicationFailed(true);
        setPublicationError(error instanceof Error ? error.message : String(error));
      } finally {
        pending = false;
        if (!cancelled && !controller.signal.aborted && !silent) setPublicationLoading(false);
      }
    };

    void load(false);
    const timer = setInterval(() => {
      if (!isAppActive()) return;
      void load(true);
    }, REMOTE_POLL_MS);

    return () => {
      cancelled = true;
      controller.abort();
      clearInterval(timer);
    };
  }, [canRelease, projectId, publicationRefreshKey]);

  const value = useMemo(
    () => ({
      projectId,
      projectTitle,
      chapterId,
      capabilities,
      draftRevision,
      videoSnapshotHash,
      billingBalance,
      publication: canRelease ? publication : null,
      publicationLoading: loading || (canRelease && publicationLoading),
      publicationFailed: canRelease && publicationFailed,
      publicationError: canRelease ? publicationError : undefined,
      refreshPublication,
      loading,
      error,
      refresh,
      setPublication,
    }),
    [
      billingBalance,
      canRelease,
      capabilities,
      chapterId,
      draftRevision,
      error,
      loading,
      projectId,
      projectTitle,
      publication,
      publicationFailed,
      publicationError,
      refreshPublication,
      publicationLoading,
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
