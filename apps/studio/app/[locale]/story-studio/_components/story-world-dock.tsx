"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { uploadFileViaSignedUrl } from "@/lib/media-upload";
import {
  addStoryCandidateAsset,
  putStoryDraft,
  storyApiErrorMessage,
  updateStoryProject,
  type InteractiveStoryDraftContent,
  type StoryCandidateAsset,
  type StoryWorkbench,
} from "@/lib/story-projects-api";
import {
  storyChapterWorkbenchQueryKey,
  useStoryChapterWorkbench,
} from "../_lib/use-story-chapter-workbench";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";
import type { StoryCandidateAssetUploadState } from "./project-canvas/story-candidate-asset-picker-dialog";
import { StoryProjectWorldPanel } from "./project-canvas/story-project-world-panel";
import { useStoryCandidateAssets } from "./project-canvas/use-story-candidate-assets";

const FOUNDATION_SAVE_DEBOUNCE_MS = 900;
const FOUNDATION_SAVE_MAX_RETRIES = 3;

type StoryFoundationField = "logline" | "synopsis";
type BibleOverlay = Partial<Record<StoryFoundationField, string>>;

/**
 * Overview (story bible + project basics) as a layout-dock tenant — the one
 * editor for the bible fields on every production step. Edits keep a local
 * overlay for responsive typing and autosave through the draft head with
 * optimistic revisions (the same external-writer path the agent uses; the
 * canvas adopts the new revision like any other). A failed save keeps the
 * typed text and retries against a refetched head.
 */
export function StoryWorldDock({ projectId }: { projectId: string }) {
  const t = useTranslations("storyStudio.canvas");
  const queryClient = useQueryClient();
  const setSidePanel = useStoryProjectUiStore((state) => state.setSidePanel);
  const foundationWriter = useStoryProjectUiStore((state) => state.foundationWriter);

  const workbenchQuery = useStoryChapterWorkbench(projectId);
  const { workspaceId, chapterId: activeChapterId } = workbenchQuery;
  const workbenchQueryKey = useMemo(
    () => storyChapterWorkbenchQueryKey(projectId, activeChapterId),
    [projectId, activeChapterId]
  );
  const workbench = workbenchQuery.data ?? null;
  const canEdit = workbench?.project.capabilities.includes("story.edit") ?? false;

  // ---- Bible edits (draft content) --------------------------------------
  const [bibleOverlay, setBibleOverlay] = useState<BibleOverlay | null>(null);
  const overlayRef = useRef<BibleOverlay | null>(null);
  const draftHeadRef = useRef<{ revision: number; content: InteractiveStoryDraftContent } | null>(
    null
  );
  useEffect(() => {
    if (workbench) {
      draftHeadRef.current = {
        revision: workbench.draft.revision,
        content: workbench.draft.content,
      };
    }
  }, [workbench]);
  const sessionIdRef = useRef<string | null>(null);
  sessionIdRef.current ??= crypto.randomUUID();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const failedSavesRef = useRef(0);

  const scheduleBibleSave = () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void flushRef.current();
    }, FOUNDATION_SAVE_DEBOUNCE_MS);
  };

  const writerRef = useRef(foundationWriter);
  useEffect(() => {
    writerRef.current = foundationWriter;
  }, [foundationWriter]);

  const flushBibleOverlay = async () => {
    const head = draftHeadRef.current;
    const overlay = overlayRef.current;
    if (!head || !overlay || savingRef.current || !activeChapterId) return;
    // A canvas may have mounted since this flush was armed (the dock survives
    // step changes). It is the draft's writer while mounted, so hand the
    // pending text over instead of racing its autosave with our own PUT.
    const writer = writerRef.current;
    if (writer) {
      overlayRef.current = null;
      setBibleOverlay(null);
      for (const [field, value] of Object.entries(overlay)) {
        writer(field as StoryFoundationField, value);
      }
      return;
    }
    savingRef.current = true;
    const content: InteractiveStoryDraftContent = {
      ...head.content,
      storyBible: { ...head.content.storyBible, ...overlay },
    };
    try {
      const draft = await putStoryDraft(projectId, activeChapterId, {
        expectedRevision: head.revision,
        content,
        sessionId: sessionIdRef.current as string,
      });
      failedSavesRef.current = 0;
      draftHeadRef.current = { revision: draft.revision, content };
      // The overlay may have gained keystrokes while the PUT was in flight;
      // clear only what this save persisted.
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
      // Keep the typed text; refetch the head (fresh revision) and retry a
      // bounded number of times. The next keystroke re-arms the retry budget.
      failedSavesRef.current += 1;
      toast.error(storyApiErrorMessage(error, t("filmFoundation.saveError")));
      await workbenchQuery.refetch();
    } finally {
      savingRef.current = false;
      if (overlayRef.current && failedSavesRef.current < FOUNDATION_SAVE_MAX_RETRIES) {
        scheduleBibleSave();
      }
    }
  };
  const flushRef = useRef(flushBibleOverlay);
  useEffect(() => {
    flushRef.current = flushBibleOverlay;
  });

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      // Unmount with pending edits: fire the save now instead of dropping the
      // debounce window on the floor.
      if (overlayRef.current) void flushRef.current();
    },
    []
  );

  const updateFoundation = (field: StoryFoundationField, value: string) => {
    if (!canEdit) return;
    if (foundationWriter) {
      // The mounted canvas is the draft's writer: hand the edit to it and
      // mirror the value into the query cache so this panel keeps displaying
      // what was typed. The canvas autosaves it; no PUT from here.
      foundationWriter(field, value);
      queryClient.setQueryData<StoryWorkbench>(workbenchQueryKey, (current) =>
        current
          ? {
              ...current,
              draft: {
                ...current.draft,
                content: {
                  ...current.draft.content,
                  storyBible: { ...current.draft.content.storyBible, [field]: value },
                },
              },
            }
          : current
      );
      return;
    }
    failedSavesRef.current = 0;
    overlayRef.current = { ...overlayRef.current, [field]: value };
    setBibleOverlay(overlayRef.current);
    scheduleBibleSave();
  };

  // ---- Cover (project-level) --------------------------------------------
  const candidateAssets = useStoryCandidateAssets({ projectId, canEdit });
  const updateProjectCover = async (coverAssetId: string | null) => {
    if (!workspaceId || !workbench || !canEdit) {
      throw new Error(t("production.errors.action"));
    }
    try {
      const updatedProject = await updateStoryProject(projectId, {
        expectedProjectVersion: workbench.project.projectVersion,
        coverAssetId,
      });
      queryClient.setQueryData<StoryWorkbench>(workbenchQueryKey, (current) =>
        current ? { ...current, project: updatedProject } : current
      );
      void queryClient.invalidateQueries({ queryKey: ["story-studio", "workbench"] });
      void queryClient.invalidateQueries({ queryKey: ["story-studio", "projects"] });
    } catch (error) {
      await workbenchQuery.refetch();
      throw error;
    }
  };
  const uploadProjectCover = async (
    file: File,
    onState: (state: StoryCandidateAssetUploadState) => void,
    signal: AbortSignal
  ) => {
    if (!workspaceId || !canEdit) throw new Error(t("production.errors.action"));
    const uploaded = await uploadFileViaSignedUrl(file, {
      kind: "ai_reference_image",
      workspaceId,
      onProgress: (progress) => onState({ stage: "uploading", progress }),
      signal,
    });
    if (signal.aborted) throw new DOMException("Upload aborted", "AbortError");
    onState({ stage: "processing" });
    const candidate = await addStoryCandidateAsset(projectId, uploaded.mediaAssetId);
    await candidateAssets.refresh();
    if (signal.aborted) throw new DOMException("Upload aborted", "AbortError");
    await updateProjectCover(candidate.asset.id);
  };

  // Display truth for the bible fields: the pending overlay (unsaved
  // keystrokes) over the last persisted revision.
  const content = useMemo<InteractiveStoryDraftContent | null>(() => {
    const base = workbench?.draft.content ?? null;
    if (!base) return null;
    if (!bibleOverlay) return base;
    return { ...base, storyBible: { ...base.storyBible, ...bibleOverlay } };
  }, [workbench, bibleOverlay]);

  if (!workbench || !content) return null;
  return (
    <StoryProjectWorldPanel
      project={workbench.project}
      content={content}
      canEdit={canEdit}
      coverMedia={{
        cover: workbench.project.cover,
        candidateAssets: candidateAssets.items,
        candidateAssetsLoading: candidateAssets.loading,
        candidateAssetsError: candidateAssets.failed
          ? candidateAssets.error || t("filmFoundation.cover.candidateLoadError")
          : null,
        disabledReason: canEdit ? null : t("readOnly"),
        onRetryCandidates: () => void candidateAssets.refresh(),
        onSelectCandidate: (candidate: StoryCandidateAsset) =>
          updateProjectCover(candidate.asset.id),
        onClearSelection: () => updateProjectCover(null),
        onUpload: uploadProjectCover,
      }}
      onUpdateFoundation={updateFoundation}
      onClose={() => setSidePanel(null)}
    />
  );
}
