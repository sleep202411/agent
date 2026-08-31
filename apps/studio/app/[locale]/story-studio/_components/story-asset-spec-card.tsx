"use client";

import { IconRefresh, IconUpload } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { uploadFileViaSignedUrl } from "@/lib/media-upload";
import {
  createStoryProductionIdempotencyKey,
  patchStoryAssetSpec,
  storyProductionKeys,
  type StoryAssetSpec,
} from "@/lib/story-production-api";
import {
  addStoryCandidateAsset,
  storyApiErrorMessage,
  type StoryCandidateAsset,
} from "@/lib/story-projects-api";
import {
  StoryCandidateAssetPickerDialog,
  type StoryCandidateAssetUploadState,
} from "./project-canvas/story-candidate-asset-picker-dialog";
import { useStoryCandidateAssets } from "./project-canvas/use-story-candidate-assets";
import { StoryAssetSpecDetailDialog } from "./story-asset-spec-detail-dialog";
import { StoryProductionConflictPanel } from "./story-production-conflict-panel";
import { StoryProductionGenerationControl } from "./story-production-generation-control";

const MEDIA_ASPECT = {
  character: "portrait",
  location: "landscape",
  prop: "square",
} as const;

/**
 * Minimal media-first Asset Spec card: one media slot (character portraits
 * 3:4, location stills 16:9, props square) with the generate action and the
 * upload/replace and detail entries stacked on it, then just the name and a
 * one-line description. The detail dialog carries the prompt and model choice.
 */
export function StoryAssetSpecCard({
  asset,
  projectId,
  chapterId,
  allowGeneration = true,
  workspaceId = null,
  allowMediaReplacement = true,
  eagerMedia = false,
}: {
  asset: StoryAssetSpec;
  projectId: string;
  chapterId: string;
  allowGeneration?: boolean;
  workspaceId?: string | null;
  allowMediaReplacement?: boolean;
  eagerMedia?: boolean;
}) {
  const t = useTranslations("storyStudio.assetsPage");
  const mediaT = useTranslations("storyStudio.assetsPage.mediaAction");
  const [detailOpen, setDetailOpen] = useState(false);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const canReplaceMedia = allowMediaReplacement && Boolean(workspaceId);

  return (
    <article className="relative rounded-2xl bg-white/[0.045] p-3 text-white shadow-sm">
      <StoryProductionGenerationControl
        scope={{ projectId, chapterId }}
        target={{
          kind: "asset_spec",
          id: asset.id,
          sequenceId: null,
          version: asset.version,
          status: asset.status,
          latestGeneration: asset.latestGeneration,
        }}
        label={asset.name}
        selectedMedia={asset.selectedMediaVersion}
        aspect={MEDIA_ASPECT[asset.kind]}
        allowGeneration={allowGeneration}
        mediaLoading={eagerMedia ? "eager" : "lazy"}
        secondaryAction={
          <div className="flex items-center gap-1.5">
            {canReplaceMedia ? (
              <button
                type="button"
                onClick={() => setAssetPickerOpen(true)}
                className="inline-flex items-center gap-1 rounded-md bg-black/45 px-2 py-1 text-[11px] font-medium text-white/72 backdrop-blur-sm transition hover:bg-black/60 hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
              >
                {asset.selectedMediaVersion ? (
                  <IconRefresh className="size-3" aria-hidden="true" />
                ) : (
                  <IconUpload className="size-3" aria-hidden="true" />
                )}
                {asset.selectedMediaVersion ? mediaT("replaceImage") : mediaT("uploadImage")}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setDetailOpen(true)}
              className="rounded-md bg-black/45 px-2 py-1 text-[11px] font-medium text-white/72 backdrop-blur-sm transition hover:bg-black/60 hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
            >
              {t("details")}
            </button>
          </div>
        }
      />
      <div className="mt-3 min-w-0">
        <h2 className="truncate text-sm font-semibold text-white/94">{asset.name}</h2>
        {asset.description ? (
          <p className="mt-1 truncate text-xs leading-5 text-white/70">{asset.description}</p>
        ) : null}
      </div>
      <StoryProductionConflictPanel
        scope={{ projectId, chapterId }}
        target={{ kind: "asset_spec", item: asset }}
      />
      {detailOpen ? (
        <StoryAssetSpecDetailDialog
          asset={asset}
          projectId={projectId}
          chapterId={chapterId}
          open
          onOpenChange={setDetailOpen}
          editable={allowGeneration}
        />
      ) : null}
      {assetPickerOpen && workspaceId ? (
        <StoryAssetSpecCardMediaPicker
          asset={asset}
          projectId={projectId}
          chapterId={chapterId}
          workspaceId={workspaceId}
          open
          onOpenChange={setAssetPickerOpen}
        />
      ) : null}
    </article>
  );
}

function StoryAssetSpecCardMediaPicker({
  asset,
  projectId,
  chapterId,
  workspaceId,
  open,
  onOpenChange,
}: {
  asset: StoryAssetSpec;
  projectId: string;
  chapterId: string;
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("storyStudio.assetsPage.mediaAction");
  const queryClient = useQueryClient();
  const candidateAssets = useStoryCandidateAssets({ projectId, canEdit: true });

  const replaceMutation = useMutation({
    retry: false,
    mutationFn: (candidate: StoryCandidateAsset) =>
      patchStoryAssetSpec(
        projectId,
        chapterId,
        asset.id,
        createStoryProductionIdempotencyKey("story-asset-media-replace"),
        {
          expectedVersion: asset.version,
          sourceMediaAssetId: candidate.asset.id,
        }
      ),
    onSuccess: async (updated) => {
      queryClient.setQueryData<StoryAssetSpec[]>(
        storyProductionKeys.assets(projectId, chapterId),
        (current) => current?.map((item) => (item.id === updated.id ? updated : item))
      );
      onOpenChange(false);
      toast.success(t("replaceSuccess"));
      await queryClient.invalidateQueries({
        queryKey: storyProductionKeys.storyboard(projectId, chapterId),
      });
    },
    onError: (error) => toast.error(storyApiErrorMessage(error, t("replaceError"))),
  });

  const uploadReplacement = async (
    file: File,
    onState: (state: StoryCandidateAssetUploadState) => void,
    signal: AbortSignal
  ) => {
    const uploaded = await uploadFileViaSignedUrl(file, {
      kind: "ai_reference_image",
      workspaceId,
      scope: { projectId },
      onProgress: (progress) => onState({ stage: "uploading", progress }),
      signal,
    });
    if (signal.aborted) throw new DOMException("Upload aborted", "AbortError");
    onState({ stage: "processing" });
    const candidate = await addStoryCandidateAsset(projectId, uploaded.mediaAssetId);
    await candidateAssets.refresh();
    if (signal.aborted) throw new DOMException("Upload aborted", "AbortError");
    await replaceMutation.mutateAsync(candidate);
  };

  return (
    <StoryCandidateAssetPickerDialog
      open={open}
      onOpenChange={(next) => {
        if (!replaceMutation.isPending) onOpenChange(next);
      }}
      items={candidateAssets.items}
      allowedKinds={["image"]}
      currentAssetId={asset.selectedMediaVersion?.mediaAssetId ?? null}
      loading={candidateAssets.loading}
      error={candidateAssets.failed ? candidateAssets.error : null}
      canSelect={!replaceMutation.isPending}
      disabledReason={replaceMutation.isPending ? t("replacing") : null}
      onRetry={() => void candidateAssets.refresh()}
      onSelect={async (candidate) => {
        await replaceMutation.mutateAsync(candidate);
      }}
      uploadAccept="image/*,.jpg,.jpeg,.png,.webp"
      onUpload={uploadReplacement}
    />
  );
}
