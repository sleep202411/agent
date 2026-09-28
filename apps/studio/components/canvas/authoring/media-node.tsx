"use client";

import { memo, useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import type { Node, NodeProps } from "@xyflow/react";
import { MEDIA_ASSET_READINESS_CAPABILITY } from "@repo/shared";
import {
  IconAlertTriangle,
  IconDownload,
  IconLoader2,
  IconMaximize,
  IconPencil,
  IconRefresh,
  IconUpload,
} from "@tabler/icons-react";
import { IconAudioWaveform } from "@/components/icons/icon-audio-waveform";
import { cn } from "@/lib/utils";
import { canvasNodeGeometry } from "@/lib/canvas-core/node-geometry";
import { CanvasVideo } from "@/components/media/canvas-video";
import { useCanvasGraphContext } from "@/lib/canvas-core/canvas-graph-context";
import { useCanvasMediaDownload } from "./use-canvas-media-download";
import { CanvasNodeToolbar, ToolbarButton } from "./node-toolbar";
import { PortPlus } from "./ports";
import { CanvasMediaViewer } from "./canvas-media-viewer";
import { useCanvasDocumentId, withCanvasDocumentContext } from "./canvas-document-context";
import { useRetryUpload, useUploadEntry } from "./upload-state-context";
import { CanvasMediaToolbarActions } from "./media-actions-context";
import { MediaAssetReadinessControlForAsset } from "./media-asset-readiness";

export type MediaAssetNodeData = {
  src: string;
  mediaAssetId?: string;
  label?: string;
};

export type VideoAssetNodeType = Node<MediaAssetNodeData, "videoAsset">;
export type AudioAssetNodeType = Node<MediaAssetNodeData, "audioAsset">;

function MediaAssetNodeComponent({
  id,
  data,
  selected,
  kind,
}: NodeProps<VideoAssetNodeType | AudioAssetNodeType> & { kind: "video" | "audio" }) {
  const downloadCanvasMedia = useCanvasMediaDownload();
  const t = useTranslations("canvasNodes");
  const tc = useTranslations("common");
  const [viewerOpen, setViewerOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const upload = useUploadEntry(id);
  const retryUpload = useRetryUpload();
  const documentId = useCanvasDocumentId();
  const src = upload?.objectUrl ?? withCanvasDocumentContext(data.src, documentId);
  const uploading = upload?.status === "uploading";
  const failed = upload?.status === "failed";
  const { patchNodeData, renameAssetsByMediaAssetId } = useCanvasGraphContext();
  const title = data.label ?? t(`media.${kind}.title`);
  const nodeType = kind === "video" ? "videoAsset" : "audioAsset";
  const geometry = canvasNodeGeometry({ type: nodeType });

  const onDownload = useCallback(() => {
    void downloadCanvasMedia(src, title, kind);
  }, [src, title, kind, downloadCanvasMedia]);

  const commitName = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      patchNodeData(id, { label: trimmed || undefined });
      if (data.mediaAssetId) renameAssetsByMediaAssetId(data.mediaAssetId, trimmed);
      setRenaming(false);
    },
    [data.mediaAssetId, id, patchNodeData, renameAssetsByMediaAssetId]
  );

  return (
    <div className="relative" style={{ width: geometry.width }}>
      <div className="mb-1.5 flex max-w-full items-center gap-1.5 rounded px-0.5 text-xs text-white/50">
        <IconUpload className="size-3.5 shrink-0" stroke={1.8} />
        {renaming ? (
          <input
            autoFocus
            defaultValue={title}
            onBlur={(event) => commitName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              else if (event.key === "Escape") setRenaming(false);
            }}
            className="nodrag w-full min-w-0 bg-transparent text-white/80 outline-none"
          />
        ) : (
          <span className="truncate">{title}</span>
        )}
      </div>
      <div className={cn("relative rounded-xl bg-card", selected && "ring-2 ring-ring")}>
        {upload ? null : <PortPlus type="source" id="output" side="right" dataType={kind} />}
        <CanvasNodeToolbar nodeId={id} visible={selected ?? false}>
          <CanvasMediaToolbarActions
            media={
              data.mediaAssetId && !upload
                ? {
                    nodeId: id,
                    mediaAssetId: data.mediaAssetId,
                    kind,
                    url: data.src,
                    label: title,
                  }
                : null
            }
          />
          {kind === "video" ? (
            <ToolbarButton label={t("media.preview")} onClick={() => setViewerOpen(true)} iconOnly>
              <IconMaximize className="size-4" stroke={1.8} />
            </ToolbarButton>
          ) : null}
          {!upload ? (
            <ToolbarButton label={t("media.download")} onClick={onDownload} iconOnly>
              <IconDownload className="size-4" stroke={1.8} />
            </ToolbarButton>
          ) : null}
          <ToolbarButton label={t("media.rename")} onClick={() => setRenaming(true)}>
            <IconPencil className="size-4" stroke={1.8} />
          </ToolbarButton>
        </CanvasNodeToolbar>

        {kind === "video" ? (
          <CanvasVideo
            src={src}
            assetId={data.mediaAssetId}
            documentId={documentId}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setViewerOpen(true);
            }}
            // No container-level `nodrag`: the media surface must move the
            // node (same as image nodes). Interactive children — the play
            // button and the active <video> — opt out on their own.
            className="nowheel block aspect-video w-full rounded-xl select-none"
          />
        ) : (
          <div
            className="flex w-full flex-col justify-center gap-3 rounded-xl bg-card px-4"
            style={{ minHeight: geometry.minHeight - 26 }}
          >
            <div className="flex min-w-0 items-center gap-2 text-white/70">
              <IconAudioWaveform className="size-5 shrink-0" stroke={1.7} />
              <span className="truncate text-sm">{title}</span>
            </div>
            {uploading || failed ? null : (
              <audio src={src} controls className="nodrag h-8 w-full [color-scheme:dark]" />
            )}
          </div>
        )}
        {kind === "video" && !upload ? (
          <MediaAssetReadinessControlForAsset
            mediaAssetId={data.mediaAssetId}
            capability={MEDIA_ASSET_READINESS_CAPABILITY.seedanceAigcReference}
            className="top-2 right-2 h-6 px-2 text-[10px]"
          />
        ) : null}
        {uploading ? (
          <>
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl bg-black/80">
              <IconLoader2 className="size-6 animate-spin text-white/55" stroke={1.8} />
              <p className="text-xs text-white/70">
                {t("image.uploading", { progress: upload.progress })}
              </p>
            </div>
            <div
              className="absolute bottom-0 left-0 z-10 h-0.5 bg-white/70 transition-[width] duration-300"
              style={{ width: `${Math.min(100, Math.max(0, upload.progress))}%` }}
            />
          </>
        ) : null}
        {failed ? (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl bg-black/80 px-4 text-center">
            <IconAlertTriangle className="size-6 text-destructive" stroke={1.6} />
            <p className="line-clamp-2 text-xs text-white/58">{upload.error}</p>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                retryUpload(id);
              }}
              className="flex items-center gap-1.5 rounded-full bg-white/[0.1] px-3 py-1 text-xs font-medium text-white/80 transition-colors hover:bg-white/[0.16] hover:text-white"
            >
              <IconRefresh className="size-3.5" stroke={1.8} />
              {tc("retry")}
            </button>
          </div>
        ) : null}
      </div>

      {viewerOpen && kind === "video" ? (
        <CanvasMediaViewer
          type="video"
          src={src}
          assetId={data.mediaAssetId}
          title={title}
          alt={title}
          downloadName={title}
          onClose={() => setViewerOpen(false)}
        />
      ) : null}
    </div>
  );
}

export const VideoAssetNode = memo((props: NodeProps<VideoAssetNodeType>) => (
  <MediaAssetNodeComponent {...props} kind="video" />
));
VideoAssetNode.displayName = "VideoAssetNode";

export const AudioAssetNode = memo((props: NodeProps<AudioAssetNodeType>) => (
  <MediaAssetNodeComponent {...props} kind="audio" />
));
AudioAssetNode.displayName = "AudioAssetNode";
