"use client";

import { STORY_AUTHORING_PROMPT_MAX } from "@repo/shared/story-production";

import { useStoryOperationScope } from "../_lib/use-story-operation-scope";
import { useAuth } from "@/app/_components/auth-provider";

import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconFolderPlus,
  IconId,
  IconLoader2,
  IconPhotoOff,
  IconPlus,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Image from "next/image";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { uploadFileViaSignedUrl } from "@/lib/media-upload";
import {
  archiveStoryAssetSpec,
  createStoryProductionIdempotencyKey,
  patchStoryAssetSpec,
  storyProductionKeys,
  type StoryAssetSpec,
  type StoryCreativeMediaVersion,
} from "@/lib/story-production-api";
import {
  addStoryCandidateAsset,
  storyApiErrorMessage,
  type StoryCandidateAsset,
} from "@/lib/story-projects-api";
import { cn } from "@/lib/utils";
import {
  StoryCandidateAssetPickerDialog,
  type StoryCandidateAssetUploadState,
} from "./project-canvas/story-candidate-asset-picker-dialog";
import { useStoryCandidateAssets } from "./project-canvas/use-story-candidate-assets";
import { StoryPromptComposer, useStoryAssetMentions } from "./story-prompt-composer";
import { StoryAssetGenerationToolbar } from "./story-asset-generation-toolbar";
import { StoryProductionGenerationControl } from "./story-production-generation-control";
import { useStoryProductionAutosave } from "./use-story-production-autosave";

/**
 * One Asset Spec workbench row. Primary media history stays with the editable
 * spec; characters alone add a dedicated three-view pane.
 */
export function StoryAssetSpecCard({
  asset,
  projectId,
  chapterId,
  allowEditing = true,
  allowGeneration = true,
  allowMediaReplacement = true,
  eagerMedia = false,
}: {
  asset: StoryAssetSpec;
  projectId: string;
  chapterId: string;
  allowEditing?: boolean;
  allowGeneration?: boolean;
  allowMediaReplacement?: boolean;
  eagerMedia?: boolean;
}) {
  const { user, isCurrentAccount } = useAuth();
  const isCurrent = useStoryOperationScope(
    JSON.stringify([projectId, chapterId, user?.id, asset.id, allowEditing, allowMediaReplacement])
  );
  const detailT = useTranslations("storyStudio.assetsPage.detailDialog");
  const workbenchT = useTranslations("storyStudio.assetsPage.workbench");
  const mediaT = useTranslations("storyStudio.assetsPage.mediaAction");
  const queryClient = useQueryClient();
  const mentions = useStoryAssetMentions(projectId, chapterId);
  const generationT = useTranslations("storyStudio.productionGeneration");
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [turnaroundPickerOpen, setTurnaroundPickerOpen] = useState(false);
  const [primaryPendingPreviewCount, setPrimaryPendingPreviewCount] = useState(0);
  const [turnaroundPendingPreviewCount, setTurnaroundPendingPreviewCount] = useState(0);
  const canReplaceMedia = allowMediaReplacement;
  const mediaVersions = [...asset.mediaVersions].sort(
    (left, right) => right.versionNumber - left.versionNumber
  );
  const primaryVersions = mediaVersions.filter((version) => version.purpose !== "turnaround");
  const turnaroundVersions = mediaVersions.filter((version) => version.purpose === "turnaround");
  const selectedTurnaround = turnaroundVersions[0] ?? null;
  const selectedTurnaroundSource =
    selectedTurnaround?.previewUrl ?? selectedTurnaround?.thumbnailUrl ?? null;
  const latestPrimary =
    asset.latestGenerations?.primary ??
    (asset.latestGeneration?.purpose !== "turnaround" ? asset.latestGeneration : null);
  const latestTurnaround =
    asset.latestGenerations?.turnaround ??
    (asset.latestGeneration?.purpose === "turnaround" ? asset.latestGeneration : null);
  const isSingleImageAsset = asset.kind !== "character";

  const updateCachedAsset = (updated: StoryAssetSpec) => {
    queryClient.setQueryData<StoryAssetSpec[]>(
      storyProductionKeys.assets(projectId, chapterId, user?.id ?? null),
      (current) => current?.map((item) => (item.id === updated.id ? updated : item))
    );
  };

  const { values, changeValues, runWithSavedValues } = useStoryProductionAutosave({
    initialValues: { name: asset.name, imagePrompt: asset.imagePrompt },
    canPersist: () => user?.id != null && isCurrentAccount(user.id),
    scopeKey: JSON.stringify([projectId, chapterId, asset.id, user?.id, allowEditing]),
    persist: async ({ name, imagePrompt }) => {
      const current =
        queryClient
          .getQueryData<
            StoryAssetSpec[]
          >(storyProductionKeys.assets(projectId, chapterId, user?.id ?? null))
          ?.find((item) => item.id === asset.id) ?? asset;
      if (
        !name.trim() ||
        !imagePrompt.trim() ||
        (name.trim() === current.name && imagePrompt.trim() === current.imagePrompt)
      ) {
        return current.version;
      }
      const updated = await patchStoryAssetSpec(
        projectId,
        chapterId,
        asset.id,
        createStoryProductionIdempotencyKey("story-asset-patch"),
        {
          expectedVersion: current.version,
          name: name.trim(),
          imagePrompt: imagePrompt.trim(),
        }
      );
      updateCachedAsset(updated);
      return updated.version;
    },
    onError: (error) => {
      if (isCurrent()) toast.error(storyApiErrorMessage(error, detailT("saveError")));
    },
  });
  const { name, imagePrompt: prompt } = values;
  const formValid = name.trim().length > 0 && prompt.trim().length > 0;

  const selectVersionMutation = useMutation({
    retry: false,
    onMutate: () => ({ isCurrent }),
    mutationFn: (mediaVersion: StoryCreativeMediaVersion) =>
      runWithSavedValues(async (version) => {
        const updated = await patchStoryAssetSpec(
          projectId,
          chapterId,
          asset.id,
          createStoryProductionIdempotencyKey("story-asset-media-select"),
          {
            expectedVersion: version,
            selectedMediaVersionId: mediaVersion.id,
          }
        );
        updateCachedAsset(updated);
        return updated;
      }),
    onSuccess: (_result, _input, context) => {
      if (!context?.isCurrent()) return;
      toast.success(workbenchT("versionSelected"));
    },
    onError: (error, _input, context) => {
      if (context?.isCurrent())
        toast.error(storyApiErrorMessage(error, workbenchT("versionSelectError")));
    },
  });

  const archiveMutation = useMutation({
    retry: false,
    onMutate: () => ({
      isCurrent,
      cacheKey: storyProductionKeys.assets(projectId, chapterId, user?.id ?? null),
      assetId: asset.id,
    }),
    mutationFn: () =>
      runWithSavedValues((version) =>
        archiveStoryAssetSpec(
          projectId,
          chapterId,
          asset.id,
          createStoryProductionIdempotencyKey("story-asset-archive"),
          { expectedVersion: version }
        )
      ),
    onSuccess: async (_result, _input, context) => {
      if (!context) return;
      queryClient.setQueryData<StoryAssetSpec[]>(context.cacheKey, (current) =>
        current?.filter((item) => item.id !== context.assetId)
      );
      if (!context.isCurrent()) return;
      toast.success(detailT("deleted"));
      await queryClient.invalidateQueries({
        queryKey: storyProductionKeys.state(projectId, chapterId),
      });
    },
    onError: (error, _input, context) => {
      if (context?.isCurrent()) toast.error(storyApiErrorMessage(error, detailT("deleteError")));
    },
  });

  const busy = selectVersionMutation.isPending || archiveMutation.isPending;
  const generationDisabledReason = !formValid ? workbenchT("completeDetails") : undefined;

  const primaryTarget = {
    kind: "asset_spec" as const,
    id: asset.id,
    sequenceId: null,
    version: asset.version,
    status: asset.status,
    latestGeneration: latestPrimary,
  };
  const turnaroundTarget = { ...primaryTarget, latestGeneration: latestTurnaround };

  return (
    <article
      className={cn(
        "grid min-w-0 items-stretch gap-3 text-white",
        isSingleImageAsset ? "h-full" : "py-3 first:pt-0 last:pb-0 lg:grid-cols-2"
      )}
    >
      <section
        className={cn(
          "flex min-w-0 flex-col overflow-visible rounded-2xl border border-white/[0.09] bg-white/[0.045]",
          isSingleImageAsset && "h-full"
        )}
        aria-label={asset.name}
      >
        <div className={cn("p-3", isSingleImageAsset && "flex-1")}>
          <div className="flex min-w-0 items-start gap-2">
            <label className="sr-only" htmlFor={`asset-name-${asset.id}`}>
              {detailT("name")}
            </label>
            <Input
              id={`asset-name-${asset.id}`}
              className="h-7 min-w-0 flex-1 rounded-none border-0 border-b border-b-transparent !bg-transparent px-0 py-0 text-base/6 font-semibold text-white shadow-none hover:border-b-white/16 focus-visible:border-b-white/35 focus-visible:ring-0 md:text-base/6"
              value={name}
              maxLength={240}
              disabled={busy || !allowEditing}
              aria-required="true"
              onChange={(event) => changeValues({ ...values, name: event.target.value })}
            />
            {allowEditing ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                    aria-label={detailT("delete")}
                    disabled={busy}
                  >
                    <IconTrash />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent size="sm" className="ring-0">
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {detailT("deleteTitle", { name: asset.name })}
                    </AlertDialogTitle>
                    <AlertDialogDescription>{detailT("deleteDescription")}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={archiveMutation.isPending}>
                      {detailT("deleteCancel")}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      disabled={archiveMutation.isPending}
                      onClick={() => archiveMutation.mutate()}
                    >
                      {detailT("deleteConfirm")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : null}
          </div>

          <label className="sr-only" htmlFor={`asset-prompt-${asset.id}`}>
            {detailT("imagePrompt")}
          </label>
          <StoryPromptComposer
            id={`asset-prompt-${asset.id}`}
            value={prompt}
            disabled={busy || !allowEditing}
            required
            maxLength={STORY_AUTHORING_PROMPT_MAX}
            placeholder={detailT(`imagePromptPlaceholder.${asset.kind}`)}
            onChange={(imagePrompt) => changeValues({ ...values, imagePrompt })}
            mentions={mentions}
            excludeMentionId={asset.id}
          />

          <div className="mt-2">
            <StoryAssetGenerationToolbar projectId={projectId} prompt={prompt}>
              {({ selection, options }) => (
                <StoryProductionGenerationControl
                  scope={{ projectId, chapterId }}
                  target={primaryTarget}
                  label={asset.name}
                  selectedMedia={asset.selectedMediaVersion}
                  layout="inline"
                  purpose="primary"
                  modelSelection={selection}
                  generationOptions={options}
                  allowGeneration={allowGeneration}
                  submitGeneration={runWithSavedValues}
                  generationDisabledReason={generationDisabledReason}
                  allowConcurrent
                  onPendingPreviewCountChange={setPrimaryPendingPreviewCount}
                />
              )}
            </StoryAssetGenerationToolbar>
          </div>
        </div>

        <MediaVersionStrip
          versions={primaryVersions}
          selectedId={asset.selectedMediaVersionId}
          allowSelection={allowEditing}
          busy={busy}
          eager={eagerMedia}
          emptyLabel={workbenchT("noVersions")}
          addLabel={asset.selectedMediaVersion ? mediaT("replaceImage") : mediaT("uploadImage")}
          canAdd={canReplaceMedia}
          pendingPreviewCount={primaryPendingPreviewCount}
          pendingPreviewLabel={generationT("status.inProgress")}
          landscape={isSingleImageAsset}
          onAdd={() => setAssetPickerOpen(true)}
          onSelect={(version) => selectVersionMutation.mutate(version)}
        />
      </section>

      {asset.kind === "character" ? (
        <section className="flex min-w-0 flex-col overflow-visible rounded-2xl border border-white/[0.09] bg-white/[0.035]">
          <div className="relative aspect-video min-h-52 lg:aspect-auto lg:flex-1">
            <div className="absolute inset-0 overflow-hidden rounded-t-2xl bg-black/32">
              {selectedTurnaroundSource ? (
                <Image
                  src={selectedTurnaroundSource}
                  alt={workbenchT("turnaroundFor", { name: asset.name })}
                  fill
                  unoptimized
                  loading={eagerMedia ? "eager" : "lazy"}
                  sizes="(max-width: 1024px) 100vw, 50vw"
                  className="object-cover"
                />
              ) : (
                <div className="grid size-full place-items-center text-center">
                  <div className="px-6">
                    <IconPhotoOff className="mx-auto size-7 text-white/32" stroke={1.5} />
                    <p className="mt-2 text-sm text-white/42">{workbenchT("turnaroundEmpty")}</p>
                    {!asset.selectedMediaVersion ? (
                      <p className="mt-1 text-xs text-white/38">
                        {workbenchT("turnaroundNeedsPrimary")}
                      </p>
                    ) : null}
                  </div>
                </div>
              )}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/80 via-black/45 to-transparent" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/80 via-black/45 to-transparent" />
            </div>

            <div className="absolute inset-x-0 top-0 z-10 flex items-start gap-3 p-3">
              <div className="min-w-0 flex-1">
                <h3 className="flex items-center gap-2 text-base font-semibold text-white">
                  <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-black/60 text-sm font-medium">
                    <IconId className="size-4" stroke={1.7} aria-hidden="true" />
                  </span>
                  {workbenchT("turnaroundTitle")}
                </h3>
                <p className="mt-1 truncate text-xs text-white/58">
                  {workbenchT("turnaroundDescription")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {canReplaceMedia ? (
                  <Button
                    type="button"
                    variant="quiet"
                    size="icon-sm"
                    aria-label={workbenchT("turnaroundUpload")}
                    title={workbenchT("turnaroundUpload")}
                    onClick={() => setTurnaroundPickerOpen(true)}
                  >
                    <IconFolderPlus />
                  </Button>
                ) : null}
                {selectedTurnaroundSource ? (
                  <Button asChild variant="quiet" size="icon-sm">
                    <a
                      href={selectedTurnaroundSource}
                      target="_blank"
                      rel="noreferrer"
                      download
                      aria-label={workbenchT("turnaroundDownload")}
                      title={workbenchT("turnaroundDownload")}
                    >
                      <IconDownload />
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="absolute inset-x-3 bottom-3 z-20">
              <StoryAssetGenerationToolbar
                projectId={projectId}
                prompt={prompt}
                requireImageReference
                align="right"
              >
                {({ selection, options }) => (
                  <StoryProductionGenerationControl
                    scope={{ projectId, chapterId }}
                    target={turnaroundTarget}
                    label={workbenchT("turnaroundFor", { name: asset.name })}
                    selectedMedia={selectedTurnaround}
                    layout="inline"
                    purpose="turnaround"
                    modelSelection={selection}
                    generationOptions={options}
                    allowGeneration={allowGeneration}
                    submitGeneration={runWithSavedValues}
                    generationDisabledReason={
                      generationDisabledReason ??
                      (!asset.selectedMediaVersion
                        ? workbenchT("turnaroundNeedsPrimary")
                        : undefined)
                    }
                    allowConcurrent
                    onPendingPreviewCountChange={setTurnaroundPendingPreviewCount}
                  />
                )}
              </StoryAssetGenerationToolbar>
            </div>
          </div>

          <MediaVersionStrip
            versions={turnaroundVersions}
            selectedId={selectedTurnaround?.id ?? null}
            allowSelection={false}
            busy={busy}
            eager={eagerMedia}
            emptyLabel={workbenchT("turnaroundEmpty")}
            addLabel={workbenchT("turnaroundUpload")}
            canAdd={canReplaceMedia}
            pendingPreviewCount={turnaroundPendingPreviewCount}
            pendingPreviewLabel={generationT("status.inProgress")}
            showScrollControls
            previousLabel={workbenchT("previousVersion")}
            nextLabel={workbenchT("nextVersion")}
            onAdd={() => setTurnaroundPickerOpen(true)}
          />
        </section>
      ) : null}

      {assetPickerOpen ? (
        <StoryAssetSpecCardMediaPicker
          asset={asset}
          projectId={projectId}
          chapterId={chapterId}
          open
          purpose="primary"
          onOpenChange={setAssetPickerOpen}
        />
      ) : null}
      {turnaroundPickerOpen ? (
        <StoryAssetSpecCardMediaPicker
          asset={asset}
          projectId={projectId}
          chapterId={chapterId}
          open
          purpose="turnaround"
          onOpenChange={setTurnaroundPickerOpen}
        />
      ) : null}
    </article>
  );
}

function MediaVersionStrip({
  versions,
  selectedId,
  allowSelection,
  busy,
  eager,
  emptyLabel,
  addLabel,
  canAdd,
  pendingPreviewCount = 0,
  pendingPreviewLabel,
  landscape = false,
  showScrollControls = false,
  previousLabel,
  nextLabel,
  onAdd,
  onSelect,
}: {
  versions: StoryCreativeMediaVersion[];
  selectedId: string | null;
  allowSelection: boolean;
  busy: boolean;
  eager: boolean;
  emptyLabel: string;
  addLabel?: string;
  canAdd: boolean;
  pendingPreviewCount?: number;
  pendingPreviewLabel?: string;
  landscape?: boolean;
  showScrollControls?: boolean;
  previousLabel?: string;
  nextLabel?: string;
  onAdd?: () => void;
  onSelect?: (version: StoryCreativeMediaVersion) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const scroll = (direction: -1 | 1) => {
    scrollerRef.current?.scrollBy({ left: direction * 216, behavior: "smooth" });
  };
  const itemClassName = landscape ? "h-24 aspect-video" : "size-24";

  return (
    <div className="relative rounded-b-2xl border-t border-white/[0.08] bg-black/18">
      <div
        ref={scrollerRef}
        className="flex min-h-32 min-w-0 gap-3 overflow-x-auto p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {canAdd ? (
          <button
            type="button"
            onClick={onAdd}
            className={cn(
              "grid shrink-0 place-items-center rounded-xl bg-white/[0.055] text-white/56 transition hover:bg-white/[0.09] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none",
              itemClassName
            )}
            aria-label={addLabel}
            title={addLabel}
          >
            <IconPlus className="size-6" stroke={1.5} />
          </button>
        ) : null}
        {Array.from({ length: pendingPreviewCount }, (_, index) => (
          <div
            key={index}
            role="status"
            aria-label={pendingPreviewLabel}
            className={cn(
              "grid shrink-0 place-items-center rounded-xl border border-white/[0.1] bg-white/[0.055] text-white/58",
              itemClassName
            )}
          >
            <IconLoader2 className="size-5 animate-spin" stroke={1.7} aria-hidden="true" />
          </div>
        ))}
        {versions.map((version) => {
          const source = version.thumbnailUrl ?? version.previewUrl;
          const selected = version.id === selectedId;
          return (
            <button
              key={version.id}
              type="button"
              aria-pressed={selected}
              disabled={!allowSelection || busy || selected || !source}
              onClick={() => onSelect?.(version)}
              className={cn(
                "group relative shrink-0 overflow-hidden rounded-xl border border-white/[0.1] bg-black/30 transition-colors hover:border-white/35 disabled:opacity-100",
                itemClassName
              )}
            >
              {source ? (
                <Image
                  src={source}
                  alt=""
                  fill
                  unoptimized
                  loading={eager ? "eager" : "lazy"}
                  sizes="96px"
                  className="object-cover"
                />
              ) : null}
              {selected ? (
                <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-white text-black">
                  <IconCheck className="size-3.5" stroke={2} aria-hidden="true" />
                </span>
              ) : null}
            </button>
          );
        })}
        {versions.length === 0 && !canAdd ? (
          <div className="grid min-w-52 flex-1 place-items-center text-sm text-white/42">
            {emptyLabel}
          </div>
        ) : null}
      </div>
      {showScrollControls ? (
        <>
          <button
            type="button"
            onClick={() => scroll(-1)}
            className="absolute left-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg bg-black/45 text-white/42 transition hover:bg-black/70 hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
            aria-label={previousLabel}
          >
            <IconChevronLeft className="size-4" stroke={1.8} />
          </button>
          <button
            type="button"
            onClick={() => scroll(1)}
            className="absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg bg-black/45 text-white/42 transition hover:bg-black/70 hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
            aria-label={nextLabel}
          >
            <IconChevronRight className="size-4" stroke={1.8} />
          </button>
        </>
      ) : null}
    </div>
  );
}

function StoryAssetSpecCardMediaPicker({
  asset,
  projectId,
  chapterId,
  open,
  purpose,
  onOpenChange,
}: {
  asset: StoryAssetSpec;
  projectId: string;
  chapterId: string;
  open: boolean;
  purpose: "primary" | "turnaround";
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const isCurrent = useStoryOperationScope(
    JSON.stringify([projectId, chapterId, user?.id, asset.id, open, purpose])
  );
  const t = useTranslations("storyStudio.assetsPage.mediaAction");
  const queryClient = useQueryClient();
  const candidateAssets = useStoryCandidateAssets({ projectId, canEdit: true });

  const replaceMutation = useMutation({
    retry: false,
    onMutate: () => ({
      isCurrent,
      cacheKey: storyProductionKeys.assets(projectId, chapterId, user?.id ?? null),
    }),
    mutationFn: (candidate: StoryCandidateAsset) =>
      patchStoryAssetSpec(
        projectId,
        chapterId,
        asset.id,
        createStoryProductionIdempotencyKey("story-asset-media-replace"),
        {
          expectedVersion: asset.version,
          sourceMediaAssetId: candidate.asset.id,
          sourceMediaPurpose: purpose,
        }
      ),
    onSuccess: async (updated, _input, context) => {
      if (!context) return;
      queryClient.setQueryData<StoryAssetSpec[]>(context.cacheKey, (current) =>
        current?.map((item) => (item.id === updated.id ? updated : item))
      );
      if (!context.isCurrent()) return;
      onOpenChange(false);
      toast.success(purpose === "turnaround" ? t("turnaroundReplaceSuccess") : t("replaceSuccess"));
      await queryClient.invalidateQueries({
        queryKey: storyProductionKeys.storyboard(projectId, chapterId),
      });
    },
    onError: (error, _input, context) => {
      if (!context?.isCurrent()) return;
      toast.error(
        storyApiErrorMessage(
          error,
          purpose === "turnaround" ? t("turnaroundReplaceError") : t("replaceError")
        )
      );
    },
  });

  const uploadReplacement = async (
    file: File,
    onState: (state: StoryCandidateAssetUploadState) => void,
    signal: AbortSignal
  ) => {
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
    await replaceMutation.mutateAsync(candidate);
  };

  return (
    <StoryCandidateAssetPickerDialog
      projectId={projectId}
      open={open}
      onOpenChange={(next) => {
        if (!replaceMutation.isPending) onOpenChange(next);
      }}
      items={candidateAssets.items}
      allowedKinds={["image"]}
      currentAssetId={
        purpose === "turnaround"
          ? (asset.mediaVersions.find((version) => version.purpose === "turnaround")
              ?.mediaAssetId ?? null)
          : (asset.selectedMediaVersion?.mediaAssetId ?? null)
      }
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
