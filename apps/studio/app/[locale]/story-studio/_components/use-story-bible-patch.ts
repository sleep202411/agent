"use client";

import { useAuth } from "@/app/_components/auth-provider";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  putStoryDraft,
  storyApiErrorMessage,
  type InteractiveStoryDraftContent,
  type StoryBibleWriterPatch,
  type StoryWorkbench,
} from "@/lib/story-projects-api";
import {
  storyChapterWorkbenchQueryKey,
  useStoryChapterWorkbench,
} from "../_lib/use-story-chapter-workbench";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";
import { applyStoryBiblePatch } from "./project-canvas/story-project-canvas-mutations";

const FOUNDATION_SAVE_DEBOUNCE_MS = 900;
const FOUNDATION_SAVE_MAX_RETRIES = 3;

/**
 * Shared bible-patch writer for layout docks (Overview, Stats). While the
 * canvas is mounted it is the draft's only writer; otherwise the dock PUTs
 * the overlay against the draft head with the same CAS path the agent uses.
 */
export function useStoryBiblePatch(projectId: string) {
  const { user } = useAuth();
  const t = useTranslations("storyStudio.canvas");
  const queryClient = useQueryClient();
  const foundationWriter = useStoryProjectUiStore((state) => state.foundationWriter);
  const workbenchQuery = useStoryChapterWorkbench(projectId);
  const { chapterId: activeChapterId } = workbenchQuery;
  const workbenchQueryKey = useMemo(
    () => storyChapterWorkbenchQueryKey(projectId, activeChapterId, user?.id ?? null),
    [projectId, activeChapterId, user?.id]
  );
  const workbench = workbenchQuery.data ?? null;
  const canEdit = workbench?.project.capabilities.includes("story.edit") ?? false;

  // The dock survives chapter changes. Keep queued edits, revisions and retry
  // callbacks together so a delayed save can only write its original chapter.
  const save = useMemo(
    () => ({
      key: JSON.stringify(workbenchQueryKey),
      overlayRef: { current: null as StoryBibleWriterPatch | null },
      draftHeadRef: {
        current: null as { revision: number; content: InteractiveStoryDraftContent } | null,
      },
      sessionIdRef: { current: crypto.randomUUID() },
      saveTimerRef: { current: null as ReturnType<typeof setTimeout> | null },
      savingRef: { current: false },
      failedSavesRef: { current: 0 },
      writerRef: { current: null as typeof foundationWriter },
      flushRef: { current: async () => {} },
    }),
    [workbenchQueryKey]
  );
  const {
    overlayRef,
    draftHeadRef,
    sessionIdRef,
    saveTimerRef,
    savingRef,
    failedSavesRef,
    writerRef,
    flushRef,
  } = save;
  const [bibleOverlays, setBibleOverlays] = useState<Map<typeof save, StoryBibleWriterPatch>>(
    () => new Map()
  );
  const setBibleOverlay = (value: StoryBibleWriterPatch | null) =>
    setBibleOverlays((previous) => {
      const next = new Map(previous);
      if (value) next.set(save, value);
      else next.delete(save);
      return next;
    });
  const bibleOverlay = bibleOverlays.get(save) ?? null;
  const currentUserRef = useRef(user?.id);
  useLayoutEffect(() => {
    currentUserRef.current = user?.id;
  }, [user?.id]);
  const ownerUserId = user?.id;
  useEffect(() => {
    draftHeadRef.current = workbench
      ? {
          revision: workbench.draft.revision,
          content: workbench.draft.content,
        }
      : null;
  }, [workbench, draftHeadRef]);

  const scheduleBibleSave = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void flushRef.current();
    }, FOUNDATION_SAVE_DEBOUNCE_MS);
  };

  useEffect(() => {
    writerRef.current = foundationWriter;
  }, [foundationWriter, writerRef]);

  const flushBibleOverlay = async () => {
    const head = draftHeadRef.current;
    const overlay = overlayRef.current;
    if (
      !head ||
      !overlay ||
      savingRef.current ||
      !activeChapterId ||
      currentUserRef.current !== ownerUserId
    )
      return;
    const writer = writerRef.current;
    if (writer) {
      overlayRef.current = null;
      setBibleOverlay(null);
      writer(overlay);
      return;
    }
    savingRef.current = true;
    const content = applyStoryBiblePatch(head.content, overlay);
    try {
      const draft = await putStoryDraft(projectId, activeChapterId, {
        expectedRevision: head.revision,
        content,
        sessionId: sessionIdRef.current as string,
      });
      failedSavesRef.current = 0;
      draftHeadRef.current = { revision: draft.revision, content };
      if (overlayRef.current === overlay) {
        overlayRef.current = null;
        setBibleOverlay(null);
      }
      queryClient.setQueryData<StoryWorkbench>(workbenchQueryKey, (current) =>
        current
          ? { ...current, draft: { ...current.draft, revision: draft.revision, content } }
          : current
      );
    } catch (error) {
      failedSavesRef.current += 1;
      if (currentUserRef.current !== ownerUserId) return;
      toast.error(storyApiErrorMessage(error, t("filmFoundation.saveError")));
      const refreshed = await workbenchQuery.refetch();
      // A departed chapter no longer rerenders this hook. Carry its refreshed
      // head into its own retry instead of relying on the active chapter effect.
      if (!refreshed.isError && refreshed.data) {
        draftHeadRef.current = {
          revision: refreshed.data.draft.revision,
          content: refreshed.data.draft.content,
        };
      }
    } finally {
      savingRef.current = false;
      if (
        currentUserRef.current === ownerUserId &&
        overlayRef.current &&
        failedSavesRef.current < FOUNDATION_SAVE_MAX_RETRIES
      ) {
        scheduleBibleSave();
      }
    }
  };
  useEffect(() => {
    flushRef.current = flushBibleOverlay;
  });

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (overlayRef.current) void flushRef.current();
    },
    [flushRef, overlayRef, saveTimerRef]
  );

  const patchBible = (patch: StoryBibleWriterPatch) => {
    if (!canEdit) return;
    if (foundationWriter) {
      foundationWriter(patch);
      queryClient.setQueryData<StoryWorkbench>(workbenchQueryKey, (current) =>
        current
          ? {
              ...current,
              draft: {
                ...current.draft,
                content: {
                  ...current.draft.content,
                  storyBible: applyStoryBiblePatch(current.draft.content, patch).storyBible,
                },
              },
            }
          : current
      );
      return;
    }
    failedSavesRef.current = 0;
    overlayRef.current = { ...overlayRef.current, ...patch };
    setBibleOverlay(overlayRef.current);
    scheduleBibleSave();
  };

  const content = useMemo<InteractiveStoryDraftContent | null>(() => {
    const base = workbench?.draft.content ?? null;
    if (!base) return null;
    if (!bibleOverlay) return base;
    return { ...base, storyBible: { ...base.storyBible, ...bibleOverlay } };
  }, [workbench, bibleOverlay]);

  return {
    workbench,
    workbenchQuery,
    workbenchQueryKey,
    queryClient,
    content,
    canEdit,
    patchBible,
  };
}
