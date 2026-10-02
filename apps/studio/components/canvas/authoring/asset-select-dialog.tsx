"use client";

import { useAuth } from "@/app/_components/auth-provider";
import { Button } from "@/components/ui/button";
import { CanvasVideo } from "@/components/media/canvas-video";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  IconCheck,
  IconLoader2,
  IconPhoto,
  IconSearch,
  IconUpload,
  IconVideo,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { useProjectPayerWorkspace } from "@/app/[locale]/project/_components/project-context";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  canvasAcceptedFileTypes,
  canvasUploadMediaKind,
  type UploadMediaKind,
} from "@/components/canvas/authoring/use-media-authoring-canvas";
import { probeMediaDurationSeconds } from "@/lib/canvas-authoring/probe-media-duration";
import { useCanvasGraphContext } from "@/lib/canvas-core/canvas-graph-context";
import {
  projectAssetToMentionItem,
  useProjectAssets,
  type AssetFilter,
} from "@/lib/canvas-authoring/use-project-assets";
import { isUploadAbort, uploadFileViaSignedUrl } from "@/lib/media-upload";
import type { FizzAiReferenceKind } from "@/lib/canvas-authoring/generation-api";
import type { MentionItem } from "@/lib/prompt-mentions";
import { cn } from "@/lib/utils";
import { IconAudioWaveform } from "@/components/icons/icon-audio-waveform";

/**
 * The asset source filters — All / AI-generated / Uploaded / Crew / Character /
 * Scene. Driven by `useProjectAssets` so the grid and chips share one source.
 */
const SOURCE_FILTERS: readonly AssetFilter[] = [
  "all",
  "aiGenerated",
  "uploaded",
  "crew",
  "character",
  "scene",
];

const UPLOAD_KIND: Record<UploadMediaKind, string> = {
  image: "ai_reference_image",
  video: "ai_reference_video",
  audio: "ai_reference_audio",
};

const KIND_ICON = {
  image: IconPhoto,
  video: IconVideo,
  audio: IconAudioWaveform,
} as const;

/**
 * Shared project-asset picker for prompt mentions and generation references.
 * It presents the unified canvas + crew inventory and accepts new uploads via
 * the same signed-URL pipeline, so every entry point observes one inventory.
 * Requires a CanvasGraphProvider in scope.
 */
export function AssetSelectDialog({
  open,
  projectId,
  onClose,
  onSelect,
  acceptedKinds = ["image", "video", "audio"],
  maxSelection = 1,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onSelect: (item: MentionItem) => void;
  acceptedKinds?: readonly FizzAiReferenceKind[];
  maxSelection?: number;
}) {
  const t = useTranslations("storyboard");
  const common = useTranslations("common");
  const workspaceId = useProjectPayerWorkspace()?.id ?? null;
  const { addAssets, canEdit } = useCanvasGraphContext();
  const { assets, filtered, filter, setFilter, isLoading, error, isRetrying, retry } =
    useProjectAssets(projectId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const uploadRun = useRef<AbortController | null>(null);
  const { user } = useAuth();
  const userId = user?.id == null ? null : String(user.id);
  useLayoutEffect(
    () => () => {
      uploadRun.current?.abort();
      uploadRun.current = null;
      setUploading(false);
    },
    [open, projectId, workspaceId, canEdit, userId]
  );
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const acceptedKindSet = useMemo(() => new Set(acceptedKinds), [acceptedKinds]);
  const acceptedFileTypes = useMemo(
    () => canvasAcceptedFileTypes([...acceptedKinds]),
    [acceptedKinds]
  );
  const visibleAssets = filtered.filter((asset) => {
    if (!acceptedKindSet.has(asset.kind)) return false;
    const normalizedQuery = query.trim().toLowerCase();
    return (
      !normalizedQuery ||
      (asset.name ?? "").toLowerCase().includes(normalizedQuery) ||
      (asset.prompt ?? "").toLowerCase().includes(normalizedQuery)
    );
  });
  const closeDialog = useCallback(() => {
    uploadRun.current?.abort();
    uploadRun.current = null;
    setUploading(false);
    setQuery("");
    setSelectedIds([]);
    onClose();
  }, [onClose]);

  const uploadFiles = useCallback(
    async (list: FileList | null) => {
      if (!list?.length || !open || !canEdit || uploadRun.current) return;
      const run = new AbortController();
      uploadRun.current = run;
      const files = Array.from(list);
      if (fileInputRef.current) fileInputRef.current.value = "";

      setUploading(true);
      let uploadedAny = false;
      try {
        for (const file of files) {
          if (run.signal.aborted) return;
          const kind = canvasUploadMediaKind(file, acceptedKindSet);
          if (!kind) {
            toast.error(t("assetDialog.unsupportedType"));
            continue;
          }
          const fileRun = new AbortController();
          const abortFile = () => fileRun.abort();
          run.signal.addEventListener("abort", abortFile, { once: true });
          try {
            const [uploaded, durationSeconds] = await Promise.all([
              uploadFileViaSignedUrl(file, {
                kind: UPLOAD_KIND[kind],
                signal: fileRun.signal,
                ...(workspaceId ? { workspaceId } : {}),
              }),
              kind === "video" || kind === "audio"
                ? probeMediaDurationSeconds(file, kind, fileRun.signal)
                : Promise.resolve(null),
            ]);
            if (run.signal.aborted) return;
            addAssets([
              {
                id: uploaded.mediaAssetId,
                mediaAssetId: uploaded.mediaAssetId,
                kind,
                source: "uploaded",
                url: uploaded.url,
                name: file.name,
                ...(durationSeconds != null ? { durationSeconds } : {}),
                bytes: file.size,
                createdAt: Date.now(),
                category: "general",
              },
            ]);
            uploadedAny = true;
          } catch (error) {
            if (run.signal.aborted || isUploadAbort(error)) return;
            // Surface the upstream message so the user can act on it (quota,
            // type policy, storage, …) — never replace with a generic string
            // when the server already said why.
            toast.error(error instanceof Error ? error.message : t("assetDialog.uploadFailed"));
          } finally {
            run.signal.removeEventListener("abort", abortFile);
            fileRun.abort();
          }
        }
        if (!run.signal.aborted && uploadedAny) setFilter("uploaded");
      } finally {
        if (uploadRun.current === run) {
          uploadRun.current = null;
          setUploading(false);
        }
      }
    },
    [acceptedKindSet, addAssets, canEdit, open, setFilter, t, workspaceId]
  );

  const selectableIds = new Set(
    assets.filter((asset) => acceptedKindSet.has(asset.kind)).map((asset) => asset.id)
  );
  const validSelectedIds = selectedIds.filter((id) => selectableIds.has(id));
  const chooseAsset = (assetId: string) => {
    const asset = assets.find((candidate) => candidate.id === assetId);
    if (!asset || !acceptedKindSet.has(asset.kind)) return;
    if (maxSelection === 1) {
      onSelect(projectAssetToMentionItem(asset, assets));
      closeDialog();
      return;
    }
    setSelectedIds((current) => {
      const valid = current.filter((id) => selectableIds.has(id));
      return valid.includes(assetId)
        ? valid.filter((id) => id !== assetId)
        : valid.length < maxSelection
          ? [...valid, assetId]
          : valid;
    });
  };

  const confirmSelection = () => {
    for (const selectedId of validSelectedIds) {
      const asset = assets.find((candidate) => candidate.id === selectedId);
      if (asset && acceptedKindSet.has(asset.kind)) {
        onSelect(projectAssetToMentionItem(asset, assets));
      }
    }
    closeDialog();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && closeDialog()}>
      <DialogContent
        showCloseButton={false}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        overlayClassName="z-[210] bg-black/60 backdrop-blur-sm"
        className="nodrag nowheel z-[220] grid h-[70vh] w-full max-w-[860px] grid-rows-[auto_1fr] gap-0 overflow-hidden rounded-2xl border-none bg-background p-0 text-foreground shadow-sm ring-1 ring-border sm:max-w-[860px]"
      >
        <DialogTitle className="sr-only">{t("assetDialog.title")}</DialogTitle>
        <DialogDescription className="sr-only">{t("assetDialog.description")}</DialogDescription>

        {/* Header — border-b p-4, title + close */}
        <div className="flex shrink-0 items-center justify-between self-stretch border-b border-border p-4">
          <h2 className="text-base font-semibold text-foreground">{t("assetDialog.title")}</h2>
          <button
            type="button"
            onClick={closeDialog}
            aria-label={t("assetDialog.close")}
            className="flex size-8 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40"
          >
            <IconX className="size-4" stroke={1.5} />
          </button>
        </div>

        {/* Body — p-4 flex flex-col gap-4, min-h-0 overflow-hidden */}
        <div className="flex min-h-0 flex-1 flex-col gap-3 self-stretch overflow-hidden p-4">
          {/* Toolbar — source-filter chips (left) + upload button (right) */}
          <div className="flex shrink-0 items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {SOURCE_FILTERS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setFilter(key)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    filter === key
                      ? "bg-foreground text-background"
                      : "text-foreground/60 hover:bg-muted hover:text-foreground"
                  )}
                >
                  {t(`assetDialog.filter.${key}`)}
                </button>
              ))}
            </div>
            {canEdit ? (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={acceptedFileTypes}
                  multiple
                  className="sr-only"
                  onChange={(event) => void uploadFiles(event.target.files)}
                />
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {uploading ? (
                    <IconLoader2 className="size-3.5 animate-spin" stroke={2} />
                  ) : (
                    <IconUpload className="size-3.5" stroke={2} />
                  )}
                  {uploading ? t("assetDialog.uploading") : t("assetDialog.upload")}
                </button>
              </>
            ) : null}
          </div>

          <label className="flex h-10 shrink-0 items-center gap-2 rounded-xl bg-input/20 px-3 text-muted-foreground focus-within:ring-2 focus-within:ring-ring/30">
            <IconSearch className="size-4 shrink-0" stroke={1.7} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("assetDialog.search")}
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>

          {error && (
            <div
              role="alert"
              className="flex shrink-0 items-center gap-3 text-sm text-muted-foreground"
            >
              <p className="min-w-0 flex-1 break-words">{error.message}</p>
              <Button
                size="sm"
                variant="secondary"
                disabled={isRetrying}
                onClick={() => void retry()}
              >
                {common("retry")}
              </Button>
            </div>
          )}
          {/* Asset grid */}
          {isLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <IconLoader2 className="size-5 animate-spin text-muted-foreground" stroke={1.5} />
            </div>
          ) : visibleAssets.length > 0 ? (
            <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-4 content-start items-start gap-2 overflow-y-auto overscroll-contain pr-1 sm:grid-cols-5">
              {visibleAssets.map((asset) => {
                const label = projectAssetToMentionItem(asset, assets).label;
                const selected = selectedIds.includes(asset.id);
                const KindIcon = KIND_ICON[asset.kind];
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => chooseAsset(asset.id)}
                    className={cn(
                      "group relative aspect-square w-full self-start overflow-hidden rounded-xl bg-card text-left transition-all",
                      selected ? "ring-2 ring-primary" : "hover:ring-2 hover:ring-ring/40"
                    )}
                  >
                    {asset.kind === "image" && asset.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={asset.url}
                        alt={asset.name ?? label}
                        className="size-full object-cover"
                      />
                    ) : asset.kind === "video" && asset.url ? (
                      <CanvasVideo
                        src={asset.url}
                        assetId={asset.mediaAssetId}
                        thumbnail
                        className="size-full"
                      />
                    ) : (
                      <span className="flex size-full items-center justify-center text-muted-foreground">
                        <KindIcon className="size-7" stroke={1.5} />
                      </span>
                    )}
                    {selected ? (
                      <span className="absolute top-2 right-2 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground">
                        <IconCheck className="size-4" stroke={2.2} />
                      </span>
                    ) : null}
                    <span
                      title={asset.name ?? label}
                      className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5 text-xs font-medium text-white/85"
                    >
                      {asset.name ?? label}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
              {t("assetDialog.empty")}
            </div>
          )}

          {maxSelection > 1 ? (
            <div className="flex shrink-0 items-center justify-between border-t border-border pt-3">
              <span className="text-xs text-muted-foreground">
                {t("assetDialog.selected", { count: validSelectedIds.length, max: maxSelection })}
              </span>
              <button
                type="button"
                disabled={validSelectedIds.length === 0}
                onClick={confirmSelection}
                className="h-9 rounded-xl bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-40"
              >
                {t("assetDialog.confirm")}
              </button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
