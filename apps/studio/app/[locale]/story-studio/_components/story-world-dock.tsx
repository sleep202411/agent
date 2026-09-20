"use client";

import { useTranslations } from "next-intl";
import { uploadFileViaSignedUrl } from "@/lib/media-upload";
import {
  addStoryCandidateAsset,
  updateStoryProject,
  type StoryCandidateAsset,
  type StoryWorkbench,
} from "@/lib/story-projects-api";
import { useStoryProjectUiStore } from "../_stores/story-project-ui-store";
import type { StoryCandidateAssetUploadState } from "./project-canvas/story-candidate-asset-picker-dialog";
import { StoryProjectWorldPanel } from "./project-canvas/story-project-world-panel";
import { useStoryCandidateAssets } from "./project-canvas/use-story-candidate-assets";
import { useStoryBiblePatch } from "./use-story-bible-patch";

/**
 * Overview (story premise + cover) as a layout-dock tenant. Bible field
 * edits share `useStoryBiblePatch` with the Stats dock so the mounted canvas
 * stays the draft's only writer.
 */
export function StoryWorldDock({ projectId }: { projectId: string }) {
  const t = useTranslations("storyStudio.canvas");
  const setSidePanel = useStoryProjectUiStore((state) => state.setSidePanel);
  const {
    workbench,
    workbenchQuery,
    workbenchQueryKey,
    queryClient,
    content,
    canEdit,
    patchBible,
  } = useStoryBiblePatch(projectId);
  const updateFoundation = (field: "logline" | "synopsis", value: string) => {
    patchBible({ [field]: value });
  };

  // ---- Cover (project-level) --------------------------------------------
  const candidateAssets = useStoryCandidateAssets({ projectId, canEdit });
  const updateProjectCover = async (coverAssetId: string | null) => {
    if (!workbench || !canEdit) {
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
    if (!canEdit) throw new Error(t("production.errors.action"));
    const uploaded = await uploadFileViaSignedUrl(file, {
      kind: "ai_reference_image",
      scope: { storyProjectId: projectId },
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
