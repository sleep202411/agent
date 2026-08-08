"use client";

import { useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { IconLoader2, IconUpload, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { useActiveWorkspaceId } from "@/app/_components/workspace-context";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import {
  canvasAcceptedFileTypes,
  canvasUploadMediaKind,
  type UploadMediaKind,
} from "@/components/canvas/authoring/use-media-authoring-canvas";
import { useCanvasGraphContext } from "@/lib/canvas-core/canvas-graph-context";
import {
  projectAssetToMentionItem,
  useProjectAssets,
  type AssetFilter,
} from "@/lib/canvas-authoring/use-project-assets";
import { isUploadAbort, uploadFileViaSignedUrl } from "@/lib/media-upload";
import type { MentionItem } from "@/lib/prompt-mentions";
import { cn } from "@/lib/utils";

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

const ACCEPTED_KINDS = new Set<UploadMediaKind>(["image", "video", "audio"]);
const ACCEPT_ATTR = canvasAcceptedFileTypes(["image", "video", "audio"]);

const UPLOAD_KIND: Record<UploadMediaKind, string> = {
  image: "ai_reference_image",
  video: "ai_reference_video",
  audio: "ai_reference_audio",
};

/**
 * Asset selection dialog — 1:1 replica of imagine.art's "Select Image" dialog.
 * Opened by typing `@` in a PromptTextarea.
 *
 * Loads the unified project inventory via `useProjectAssets(projectId)` (canvas
 * graph + flat crew files). Upload uses the shared signed-URL pipeline and
 * lands in `graph.assets` so the grid and AssetLibrary stay in sync.
 * Requires a CanvasGraphProvider in scope.
 *
 * Anatomy:
 *   Dialog: bg-background, ring-1, rounded-2xl, h-[70vh] max-w-[860px],
 *           grid grid-rows-[auto_1fr]
 *   Header: border-b p-4, title + close(size-8 rounded-lg)
 *   Toolbar: source-filter chips (left) + upload button (right)
 *   Body:   asset grid, scrolls
 */
export function AssetSelectDialog({
  open,
  projectId,
  onClose,
  onSelect,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onSelect: (item: MentionItem) => void;
}) {
  const t = useTranslations("storyboard");
  const workspaceId = useActiveWorkspaceId();
  const { addAssets, canEdit } = useCanvasGraphContext();
  const { assets, filtered, filter, setFilter, isLoading } = useProjectAssets(projectId);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const uploadFiles = useCallback(
    async (list: FileList | null) => {
      if (!list?.length || !canEdit || uploading) return;
      const files = Array.from(list);
      if (fileInputRef.current) fileInputRef.current.value = "";

      setUploading(true);
      let uploadedAny = false;
      try {
        for (const file of files) {
          const kind = canvasUploadMediaKind(file, ACCEPTED_KINDS);
          if (!kind) {
            toast.error(t("assetDialog.unsupportedType"));
            continue;
          }
          try {
            const uploaded = await uploadFileViaSignedUrl(file, {
              kind: UPLOAD_KIND[kind],
              ...(workspaceId ? { workspaceId } : {}),
            });
            addAssets([
              {
                id: uploaded.mediaAssetId,
                mediaAssetId: uploaded.mediaAssetId,
                kind,
                source: "uploaded",
                url: uploaded.url,
                name: file.name,
                createdAt: Date.now(),
                category: "general",
              },
            ]);
            uploadedAny = true;
          } catch (error) {
            if (isUploadAbort(error)) return;
            // Surface the upstream message so the user can act on it (quota,
            // type policy, storage, …) — never replace with a generic string
            // when the server already said why.
            toast.error(error instanceof Error ? error.message : t("assetDialog.uploadFailed"));
          }
        }
        if (uploadedAny) setFilter("uploaded");
      } finally {
        setUploading(false);
      }
    },
    [addAssets, canEdit, setFilter, t, uploading, workspaceId]
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && !uploading && onClose()}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/60 backdrop-blur-sm"
        className="grid h-[70vh] w-full max-w-[860px] grid-rows-[auto_1fr] gap-0 overflow-hidden rounded-2xl border-none bg-background p-0 text-foreground shadow-sm ring-1 ring-border sm:max-w-[860px]"
      >
        <DialogTitle className="sr-only">{t("assetDialog.title")}</DialogTitle>
        <DialogDescription className="sr-only">{t("assetDialog.description")}</DialogDescription>

        {/* Header — border-b p-4, title + close */}
        <div className="flex shrink-0 items-center justify-between self-stretch border-b border-border p-4">
          <h2 className="text-base font-semibold text-foreground">{t("assetDialog.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={uploading}
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
                  accept={ACCEPT_ATTR}
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

          {/* Asset grid */}
          {isLoading ? (
            <div className="flex flex-1 items-center justify-center">
              <IconLoader2 className="size-5 animate-spin text-muted-foreground" stroke={1.5} />
            </div>
          ) : filtered.length > 0 ? (
            <div className="grid flex-1 grid-cols-4 content-start gap-2 overflow-y-auto sm:grid-cols-5">
              {filtered.map((asset) => {
                const label = projectAssetToMentionItem(asset, assets).label;
                return (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => {
                      onSelect(projectAssetToMentionItem(asset, assets));
                      onClose();
                    }}
                    className="group relative aspect-square overflow-hidden rounded-lg bg-card transition-all hover:ring-2 hover:ring-primary/50"
                  >
                    {asset.url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={asset.url}
                        alt={asset.name ?? label}
                        className="size-full object-cover"
                      />
                    )}
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1 text-[0.625rem] font-medium text-white/80">
                      {label}
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
