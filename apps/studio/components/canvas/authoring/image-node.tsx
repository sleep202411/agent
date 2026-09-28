"use client";

import { memo, useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import type { Node, NodeProps } from "@xyflow/react";
import { MEDIA_ASSET_READINESS_CAPABILITY } from "@repo/shared";
import {
  IconAlertTriangle,
  IconArrowsDiagonal,
  IconArrowsMaximize,
  IconBackground,
  IconBulb,
  IconDownload,
  IconLoader2,
  IconMaximize,
  IconPencil,
  IconRefresh,
  IconRotate3d,
  IconRoute,
  IconUpload,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useCanvasGraphContext } from "@/lib/canvas-core/canvas-graph-context";
import { canvasNodeGeometry } from "@/lib/canvas-core/node-geometry";
import { useCanvasMediaDownload } from "./use-canvas-media-download";
import { CanvasNodeToolbar, ToolbarButton } from "./node-toolbar";
import {
  EXPAND_OP,
  MOTION_OP,
  MULTI_ANGLE_OP,
  OperationConfirmBar,
  PANORAMA_OP,
  RELIGHT_OP,
  REMOVE_BG_OP,
  UPSCALE_OP,
  useSpawnComposedOperation,
  type OperationDef,
} from "./operation-confirm-bar";
import { MultiAngleEditor } from "./multi-angle-editor";
import { ExpandEditor } from "./expand-editor";
import { MotionEditor } from "./motion-editor";
import { Icon720 } from "./panorama-viewer";
import { PortPlus } from "./ports";
import { useCanvasDocumentId, withCanvasDocumentContext } from "./canvas-document-context";
import { useRetryUpload, useUploadEntry } from "./upload-state-context";
import { MediaAssetReadinessControlForAsset } from "./media-asset-readiness";
import { CanvasMediaViewer } from "./canvas-media-viewer";
import { CanvasMediaToolbarActions } from "./media-actions-context";

export type ImageNodeType = Node<
  { src: string; imageId?: string; mediaAssetId?: string; label?: string },
  "image"
>;

export const IMAGE_NODE_WIDTH = canvasNodeGeometry({ type: "image" }).width;

function ImageNodeComponent({ id, data, selected }: NodeProps<ImageNodeType>) {
  const downloadCanvasMedia = useCanvasMediaDownload();
  const t = useTranslations("canvasNodes");
  const tc = useTranslations("common");
  // Pending operation invoked from the toolbar (Upscale / 720°): shows a confirm
  // bar under THIS node; running it creates the result node.
  const [pendingOp, setPendingOp] = useState<OperationDef | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const spawnComposedOp = useSpawnComposedOperation();
  const upload = useUploadEntry(id);
  const retryUpload = useRetryUpload();
  const { patchNodeData, renameAssetsByMediaAssetId } = useCanvasGraphContext();
  const uploading = upload?.status === "uploading";
  const failed = upload?.status === "failed";
  const documentId = useCanvasDocumentId();
  // Show the local blob preview until the durable URL lands in data.src.
  const src = upload?.objectUrl ?? withCanvasDocumentContext(data.src, documentId);
  const title = data.label ?? t("image.title");

  const onDownload = useCallback(() => {
    // `src`, not `data.src`: the raw value drops the canvas document grant and
    // the local blob preview an in-flight upload is still showing.
    void downloadCanvasMedia(src, title, "image");
  }, [src, title, downloadCanvasMedia]);

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
    <div className="relative" style={{ width: canvasNodeGeometry({ type: "image" }).width }}>
      {/* Filename header above the card (imagine.art pattern): an uploaded image
          reads at a glance without a heavy title bar. */}
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
        <PortPlus type="source" id="output" side="right" dataType="image" />
        <CanvasNodeToolbar nodeId={id} visible={selected ?? false}>
          <CanvasMediaToolbarActions
            media={
              data.mediaAssetId && !upload
                ? {
                    nodeId: id,
                    mediaAssetId: data.mediaAssetId,
                    kind: "image",
                    url: data.src,
                    label: title,
                  }
                : null
            }
          />
          {/* While uploading/failed the durable image doesn't exist yet, so the
            image actions (panorama feeds the URL to a model; download) aren't
            offered — the toolbar still keeps Delete + Comment. */}
          {!upload && (
            <>
              <ToolbarButton label={t("image.upscale")} onClick={() => setPendingOp(UPSCALE_OP)}>
                <IconArrowsMaximize className="size-4" stroke={1.8} />
              </ToolbarButton>
              <ToolbarButton label={t("image.removeBg")} onClick={() => setPendingOp(REMOVE_BG_OP)}>
                <IconBackground className="size-4" stroke={1.8} />
              </ToolbarButton>
              <ToolbarButton
                label={t("image.relight")}
                onClick={() => spawnComposedOp(RELIGHT_OP, id, data.src)}
              >
                <IconBulb className="size-4" stroke={1.8} />
              </ToolbarButton>
              <ToolbarButton
                label={t("image.multiAngle")}
                onClick={() => setPendingOp(MULTI_ANGLE_OP)}
              >
                <IconRotate3d className="size-4" stroke={1.8} />
              </ToolbarButton>
              <ToolbarButton label={t("image.expand")} onClick={() => setPendingOp(EXPAND_OP)}>
                <IconArrowsDiagonal className="size-4" stroke={1.8} />
              </ToolbarButton>
              <ToolbarButton label={t("image.motion")} onClick={() => setPendingOp(MOTION_OP)}>
                <IconRoute className="size-4" stroke={1.8} />
              </ToolbarButton>
              <ToolbarButton
                label={t("image.generatePanorama")}
                onClick={() => setPendingOp(PANORAMA_OP)}
              >
                <Icon720 className="size-4" />
              </ToolbarButton>
              <ToolbarButton
                label={t("image.preview")}
                onClick={() => setViewerOpen(true)}
                iconOnly
              >
                <IconMaximize className="size-4" stroke={1.8} />
              </ToolbarButton>
              <ToolbarButton label={t("image.download")} onClick={onDownload} iconOnly>
                <IconDownload className="size-4" stroke={1.8} />
              </ToolbarButton>
            </>
          )}
          {upload && (
            <ToolbarButton label={t("image.preview")} onClick={() => setViewerOpen(true)} iconOnly>
              <IconMaximize className="size-4" stroke={1.8} />
            </ToolbarButton>
          )}
          <ToolbarButton label={t("image.rename")} onClick={() => setRenaming(true)}>
            <IconPencil className="size-4" stroke={1.8} />
          </ToolbarButton>
        </CanvasNodeToolbar>

        {/* Object URLs from local blobs can't go through next/image. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={title}
          draggable={false}
          onDoubleClick={(event) => {
            event.stopPropagation();
            setViewerOpen(true);
          }}
          className="block max-h-[520px] w-full rounded-xl object-cover select-none"
        />
        {!upload && (
          <MediaAssetReadinessControlForAsset
            mediaAssetId={data.mediaAssetId}
            capability={MEDIA_ASSET_READINESS_CAPABILITY.seedanceAigcReference}
            className="top-2 right-2 h-6 px-2 text-[10px]"
          />
        )}

        {uploading && (
          <>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-xl bg-black/45">
              <IconLoader2 className="size-7 animate-spin text-white/50" stroke={1.8} />
              <p className="text-sm text-white/55">
                {t("image.uploading", { progress: upload.progress })}
              </p>
            </div>
            <div
              className="absolute bottom-0 left-0 h-0.5 bg-white/70 transition-[width] duration-300"
              style={{ width: `${Math.min(100, Math.max(0, upload.progress))}%` }}
            />
          </>
        )}

        {failed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 rounded-xl bg-black/55 px-4 text-center">
            <IconAlertTriangle className="size-7 text-destructive" stroke={1.6} />
            <p className="text-sm text-white/55">{upload.error ?? t("image.uploadFailed")}</p>
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
        )}
      </div>

      {pendingOp?.editor === "multiAngle" ? (
        <MultiAngleEditor
          sourceNodeId={id}
          sourceUrl={data.src}
          onClose={() => setPendingOp(null)}
        />
      ) : pendingOp?.editor === "expand" ? (
        <ExpandEditor sourceNodeId={id} sourceUrl={data.src} onClose={() => setPendingOp(null)} />
      ) : pendingOp?.editor === "motion" ? (
        <MotionEditor sourceNodeId={id} sourceUrl={data.src} onClose={() => setPendingOp(null)} />
      ) : pendingOp ? (
        <OperationConfirmBar
          op={pendingOp}
          sourceNodeId={id}
          sourceUrl={data.src}
          onClose={() => setPendingOp(null)}
        />
      ) : null}

      {viewerOpen && (
        <CanvasMediaViewer
          type="image"
          src={src}
          title={title}
          alt={title}
          downloadName={title}
          onClose={() => setViewerOpen(false)}
        />
      )}
    </div>
  );
}

export const ImageNode = memo(ImageNodeComponent);
