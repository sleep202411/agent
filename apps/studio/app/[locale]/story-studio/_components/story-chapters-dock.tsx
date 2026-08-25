"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useSelectedLayoutSegment } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import {
  archiveStoryChapter,
  createStoryChapter,
  reorderStoryChapters,
  storyApiErrorMessage,
  updateStoryChapter,
  type StoryChapter,
} from "@/lib/story-projects-api";
import {
  STORY_CHAPTER_WORKBENCH_QUERY_PREFIX,
  useStoryChapterWorkbench,
} from "../_lib/use-story-chapter-workbench";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";
import { StoryChaptersPanel } from "./project-canvas/story-chapters-panel";

/**
 * Chapter manager as a layout-dock tenant: usable from every production step
 * without leaving it. Chapter data comes from the shared chapter-workbench
 * query; selection stays on the current step (only the ?chapter scope
 * changes) and runs through the canvas's leave guard when one is registered,
 * so unsaved-draft protection is identical to navigating from the canvas.
 */
export function StoryChaptersDock({ projectId }: { projectId: string }) {
  const t = useTranslations("storyStudio.canvas");
  const router = useRouter();
  const segment = useSelectedLayoutSegment() ?? "canvas";
  const queryClient = useQueryClient();
  const activeChapterId = useStoryProjectUiStore((state) => state.activeChapterId);
  const guardedNavigate = useStoryProjectUiStore((state) => state.guardedNavigate);
  const liveDraft = useStoryProjectUiStore((state) => state.liveDraft);
  const [creating, setCreating] = useState(false);
  const [pendingChapterId, setPendingChapterId] = useState<string | null>(null);

  const workbenchQuery = useStoryChapterWorkbench(projectId);
  const { workspaceId } = workbenchQuery;
  const workbench = workbenchQuery.data ?? null;
  const canEdit = workbench?.project.capabilities.includes("story.edit") ?? false;

  const refreshChapterProjections = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: STORY_CHAPTER_WORKBENCH_QUERY_PREFIX }),
      queryClient.invalidateQueries({ queryKey: ["story-studio", "workbench"] }),
      queryClient.invalidateQueries({ queryKey: ["story-studio", "projects"] }),
    ]);
  };

  const chapterHref = (chapterId: string) =>
    `/story-studio/projects/${encodeURIComponent(projectId)}/${segment}?chapter=${encodeURIComponent(chapterId)}`;
  const selectChapter = (chapterId: string) => {
    if (chapterId === activeChapterId) return;
    const go = () => router.push(chapterHref(chapterId));
    (guardedNavigate ?? ((proceed: () => void) => proceed()))(go);
  };

  const createChapter = async (title: string): Promise<boolean> => {
    if (!workspaceId || creating || !canEdit) return false;
    setCreating(true);
    try {
      const chapter = await createStoryChapter(workspaceId, projectId, { title });
      await refreshChapterProjections();
      selectChapter(chapter.id);
      return true;
    } catch (error) {
      toast.error(storyApiErrorMessage(error, t("chapters.createError")));
      return false;
    } finally {
      setCreating(false);
    }
  };

  const renameChapter = async (chapter: StoryChapter, title: string): Promise<boolean> => {
    if (!workspaceId || pendingChapterId || !canEdit) return false;
    setPendingChapterId(chapter.id);
    try {
      await updateStoryChapter(workspaceId, projectId, chapter.id, { title });
      await refreshChapterProjections();
      return true;
    } catch (error) {
      toast.error(storyApiErrorMessage(error, t("chapters.updateError")));
      return false;
    } finally {
      setPendingChapterId(null);
    }
  };

  const moveChapter = async (chapter: StoryChapter, direction: -1 | 1): Promise<boolean> => {
    if (!workspaceId || !workbench || pendingChapterId || !canEdit) return false;
    const currentIndex = workbench.chapters.findIndex((candidate) => candidate.id === chapter.id);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= workbench.chapters.length) {
      return false;
    }
    const chapterIds = workbench.chapters.map((candidate) => candidate.id);
    [chapterIds[currentIndex], chapterIds[targetIndex]] = [
      chapterIds[targetIndex] as string,
      chapterIds[currentIndex] as string,
    ];
    setPendingChapterId(chapter.id);
    try {
      await reorderStoryChapters(workspaceId, projectId, {
        expectedProjectVersion: workbench.project.projectVersion,
        chapterIds,
      });
      await refreshChapterProjections();
      return true;
    } catch (error) {
      toast.error(storyApiErrorMessage(error, t("chapters.reorderError")));
      return false;
    } finally {
      setPendingChapterId(null);
    }
  };

  const archiveChapter = async (chapter: StoryChapter): Promise<boolean> => {
    if (!workspaceId || !workbench || pendingChapterId || !canEdit) return false;
    // Archiving the chapter that is open in an unsettled canvas would discard
    // its unsaved edits — the canvas publishes that risk via liveDraft.
    if (
      chapter.id === activeChapterId &&
      liveDraft &&
      (!liveDraft.settled || liveDraft.conflicted)
    ) {
      toast.error(t("chapters.saveBeforeArchive"));
      return false;
    }
    const nextChapter = workbench.chapters.find((candidate) => candidate.id !== chapter.id);
    setPendingChapterId(chapter.id);
    try {
      await archiveStoryChapter(workspaceId, projectId, chapter.id);
      await refreshChapterProjections();
      if (chapter.id === activeChapterId && nextChapter) {
        router.push(chapterHref(nextChapter.id));
      }
      return true;
    } catch (error) {
      toast.error(storyApiErrorMessage(error, t("chapters.archiveError")));
      return false;
    } finally {
      setPendingChapterId(null);
    }
  };

  if (!workbench || !activeChapterId) return null;
  return (
    <StoryChaptersPanel
      chapters={workbench.chapters}
      activeChapterId={activeChapterId}
      canEdit={canEdit}
      creating={creating}
      pendingChapterId={pendingChapterId}
      onSelect={selectChapter}
      onCreate={createChapter}
      onRename={renameChapter}
      onMove={moveChapter}
      onArchive={archiveChapter}
    />
  );
}
