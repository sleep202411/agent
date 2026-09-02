"use client";

import {
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconDownload,
  IconFolderPlus,
  IconId,
  IconLoader2,
  IconPhoto,
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
import {
  StoryCandidateAssetPickerDialog,
  type StoryCandidateAssetUploadState,
} from "./project-canvas/story-candidate-asset-picker-dialog";
import { useStoryCandidateAssets } from "./project-canvas/use-story-candidate-assets";
import { StoryPromptComposer, useStoryAssetMentions } from "./story-prompt-composer";
import { StoryAssetGenerationToolbar } from "./story-asset-generation-toolbar";
import { StoryProductionConflictPanel } from "./story-production-conflict-panel";
import { StoryProductionGenerationControl } from "./story-production-generation-control";

/**
 * One Asset Spec workbench row: the durable spec edits in the left pane and
 * its current media plus real version history in the right pane. This keeps
 * the manual authoring path visible without hiding it behind a card dialog.
 */
export function StoryAssetSpecCard({
  asset,
  projectId,
  chapterId,
  allowEditing = true,
  allowGeneration = true,
  workspaceId = null,
  allowMediaReplacement = true,
  eagerMedia = false,
}: {
  asset: StoryAssetSpec;
  projectId: string;
  chapterId: string;
  allowEditing?: boolean;
  allowGeneration?: boolean;
  workspaceId?: string | null;
  allowMediaReplacement?: boolean;
  eagerMedia?: boolean;
}) {
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
  const [name, setName] = useState(asset.name);
  const [prompt, setPrompt] = useState(asset.imagePrompt);
  const canReplaceMedia = allowMediaReplacement && Boolean(workspaceId);
  const formDirty = name.trim() !== asset.name || prompt.trim() !== asset.imagePrompt;
  const formValid = name.trim().length > 0 && prompt.trim().length > 0;
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

  const updateCachedAsset = (updated: StoryAssetSpec) => {
    queryClient.setQueryData<StoryAssetSpec[]>(
      storyProductionKeys.assets(projectId, chapterId),
      (current) => current?.map((item) => (item.id === updated.id ? updated : item))
    );
  };

  const saveMutation = useMutation({
    retry: false,
    mutationFn: () =>
      patchStoryAssetSpec(
        projectId,
        chapterId,
        asset.id,
        createStoryProductionIdempotencyKey("story-asset-patch"),
        {
          expectedVersion: asset.version,
          name: name.trim(),
          imagePrompt: prompt.trim(),
        }
      ),
    onSuccess: (updated) => {
      updateCachedAsset(updated);
      toast.success(detailT("saved"));
    },
    onError: (error) => toast.error(storyApiErrorMessage(error, detailT("saveError"))),
  });

  const selectVersionMutation = useMutation({
    retry: false,
    mutationFn: (mediaVersion: StoryCreativeMediaVersion) =>
      patchStoryAssetSpec(
        projectId,
        chapterId,
        asset.id,
        createStoryProductionIdempotencyKey("story-asset-media-select"),
        {
          expectedVersion: asset.version,
          selectedMediaVersionId: mediaVersion.id,
        }
      ),
    onSuccess: (updated) => {
      updateCachedAsset(updated);
      toast.success(workbenchT("versionSelected"));
    },
    onError: (error) => toast.error(storyApiErrorMessage(error, workbenchT("versionSelectError"))),
  });

  const archiveMutation = useMutation({
    retry: false,
    mutationFn: () =>
      archiveStoryAssetSpec(
        projectId,
        chapterId,
        asset.id,
        createStoryProductionIdempotencyKey("story-asset-archive"),
        { expectedVersion: asset.version }
      ),
    onSuccess: async () => {
      queryClient.setQueryData<StoryAssetSpec[]>(
        storyProductionKeys.assets(projectId, chapterId),
        (current) => current?.filter((item) => item.id !== asset.id)
      );
      toast.success(detailT("deleted"));
      await queryClient.invalidateQueries({
        queryKey: storyProductionKeys.state(projectId, chapterId),
      });
    },
    onError: (error) => toast.error(storyApiErrorMessage(error, detailT("deleteError"))),
  });

  const busy =
    saveMutation.isPending || selectVersionMutation.isPending || archiveMutation.isPending;

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
    <article className="grid min-w-0 items-stretch gap-3 py-3 text-white first:pt-0 last:pb-0 lg:grid-cols-2">
      <section
        className="flex min-w-0 flex-col overflow-visible rounded-2xl border border-white/[0.09] bg-white/[0.045]"
        aria-label={asset.name}
      >
        <div className="p-3">
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
              onChange={(event) => setName(event.target.value)}
            />
            {allowEditing && formDirty ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={detailT("save")}
                disabled={!formValid || busy}
                loading={saveMutation.isPending}
                onClick={() => saveMutation.mutate()}
              >
                <IconCheck />
              </Button>
            ) : null}
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
            maxLength={12_000}
            onChange={setPrompt}
            mentions={mentions}
            excludeMentionId={asset.id}
          />
          <div className="mt-1 flex justify-end">
            <span className="shrink-0 text-xs tabular-nums text-white/45">
              {prompt.length.toLocaleString()}/12,000
            </span>
          </div>

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
                  allowGeneration={allowGeneration && !formDirty}
                  allowConcurrent
                  onPendingPreviewCountChange={setPrimaryPendingPreviewCount}
                />
              )}
            </StoryAssetGenerationToolbar>
          </div>

          <StoryProductionConflictPanel
            scope={{ projectId, chapterId }}
            target={{ kind: "asset_spec", item: asset }}
          />
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
                    allowGeneration={
                      allowGeneration && !formDirty && Boolean(asset.selectedMediaVersion)
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
      ) : (
        <section className="min-w-0 overflow-visible rounded-2xl border border-white/[0.09] bg-white/[0.035]">
          <div className="p-4 pb-3">
            <div className="min-w-0">
              <h3 className="flex items-center gap-2 text-base font-semibold text-white">
                <IconPhoto className="size-4 text-white/72" stroke={1.7} aria-hidden="true" />
                {workbenchT("mediaTitle")}
              </h3>
              <p className="mt-1 text-xs leading-5 text-white/58">
                {workbenchT("mediaDescription")}
              </p>
            </div>
            <AssetMediaStage
              media={asset.selectedMediaVersion}
              label={asset.name}
              fit={asset.kind === "location" ? "cover" : "contain"}
              eager={eagerMedia}
              emptyLabel={workbenchT("noVersions")}
            />
          </div>
        </section>
      )}

      {assetPickerOpen && workspaceId ? (
        <StoryAssetSpecCardMediaPicker
          asset={asset}
          projectId={projectId}
          chapterId={chapterId}
          workspaceId={workspaceId}
          open
          purpose="primary"
          onOpenChange={setAssetPickerOpen}
        />
      ) : null}
      {turnaroundPickerOpen && workspaceId ? (
        <StoryAssetSpecCardMediaPicker
          asset={asset}
          projectId={projectId}
          chapterId={chapterId}
          workspaceId={workspaceId}
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
            className="grid size-24 shrink-0 place-items-center rounded-xl bg-white/[0.055] text-white/56 transition hover:bg-white/[0.09] hover:text-white focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none"
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
            className="grid size-24 shrink-0 place-items-center rounded-xl border border-white/[0.1] bg-white/[0.055] text-white/58"
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
              className="group relative size-24 shrink-0 overflow-hidden rounded-xl border border-white/[0.1] bg-black/30 transition-colors hover:border-white/35 disabled:opacity-100"
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

function AssetMediaStage({
  media,
  label,
  fit,
  eager,
  emptyLabel,
}: {
  media: StoryCreativeMediaVersion | null;
  label: string;
  fit: "cover" | "contain";
  eager: boolean;
  emptyLabel: string;
}) {
  const source = media?.previewUrl ?? media?.thumbnailUrl ?? null;
  return (
    <div className="relative mt-3 aspect-video overflow-hidden rounded-xl bg-black/28">
      {source ? (
        <Image
          src={source}
          alt={label}
          fill
          unoptimized
          loading={eager ? "eager" : "lazy"}
          sizes="(max-width: 1024px) 100vw, 54vw"
          className={fit === "cover" ? "object-cover" : "object-contain"}
        />
      ) : (
        <div className="grid size-full place-items-center text-center">
          <div>
            <IconPhotoOff className="mx-auto size-7 text-white/32" stroke={1.5} />
            <p className="mt-2 text-sm text-white/42">{emptyLabel}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function StoryAssetSpecCardMediaPicker({
  asset,
  projectId,
  chapterId,
  workspaceId,
  open,
  purpose,
  onOpenChange,
}: {
  asset: StoryAssetSpec;
  projectId: string;
  chapterId: string;
  workspaceId: string;
  open: boolean;
  purpose: "primary" | "turnaround";
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
          sourceMediaPurpose: purpose,
        }
      ),
    onSuccess: async (updated) => {
      queryClient.setQueryData<StoryAssetSpec[]>(
        storyProductionKeys.assets(projectId, chapterId),
        (current) => current?.map((item) => (item.id === updated.id ? updated : item))
      );
      onOpenChange(false);
      toast.success(purpose === "turnaround" ? t("turnaroundReplaceSuccess") : t("replaceSuccess"));
      await queryClient.invalidateQueries({
        queryKey: storyProductionKeys.storyboard(projectId, chapterId),
      });
    },
    onError: (error) =>
      toast.error(
        storyApiErrorMessage(
          error,
          purpose === "turnaround" ? t("turnaroundReplaceError") : t("replaceError")
        )
      ),
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
