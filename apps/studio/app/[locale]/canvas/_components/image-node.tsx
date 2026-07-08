"use client";

import { memo, useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import type { Node, NodeProps } from "@xyflow/react";
import {
  IconAlertTriangle,
  IconArrowsDiagonal,
  IconArrowsMaximize,
  IconBackground,
  IconBulb,
  IconDownload,
  IconLoader2,
  IconRefresh,
  IconRotate3d,
  IconRoute,
  IconUpload,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
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
import { useRetryUpload, useUploadEntry } from "./upload-state-context";
import { MediaProviderStatusChipForAsset } from "./media-provider-status-chip";

export type ImageNodeType = Node<
  { src: string; imageId?: string; mediaAssetId?: string; label?: string },
  "image"
>;

export const IMAGE_NODE_WIDTH = 280;

function ImageNodeComponent({ id, data, selected }: NodeProps<ImageNodeType>) {
  const t = useTranslations("canvasNodes");
  const tc = useTranslations("common");
  // Pending operation invoked from the toolbar (Upscale / 720°): shows a confirm
  // bar under THIS node; running it creates the result node.
  const [pendingOp, setPendingOp] = useState<OperationDef | null>(null);
  const spawnComposedOp = useSpawnComposedOperation();
  const upload = useUploadEntry(id);
  const retryUpload = useRetryUpload();
  const uploading = upload?.status === "uploading";
  const failed = upload?.status === "failed";
  // Show the local blob preview until the durable URL lands in data.src.
  const src = upload?.objectUrl ?? data.src;

  const onDownload = useCallback(() => {
    const anchor = document.createElement("a");
    anchor.href = data.src;
    anchor.download = data.label ?? "image";
    anchor.click();
  }, [data.label, data.src]);

  return (
    <div className="relative">
      {/* Filename header above the card (imagine.art pattern): an uploaded image
          reads at a glance without a heavy title bar. */}
      <div className="mb-1.5 flex max-w-[280px] items-center gap-1.5 px-0.5 text-xs text-white/50">
        <IconUpload className="size-3.5 shrink-0" stroke={1.8} />
        <span className="truncate">{data.label ?? t("image.title")}</span>
      </div>
      <div className={cn("relative rounded-xl bg-card", selected && "ring-2 ring-ring")}>
        <PortPlus type="source" id="output" side="right" dataType="image" />
        <CanvasNodeToolbar nodeId={id} visible={selected ?? false}>
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
              <ToolbarButton label={t("image.download")} onClick={onDownload} iconOnly>
                <IconDownload className="size-4" stroke={1.8} />
              </ToolbarButton>
            </>
          )}
        </CanvasNodeToolbar>

        {/* Object URLs from local blobs can't go through next/image. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={data.label ?? t("image.alt")}
          draggable={false}
          className="block max-h-[480px] w-[280px] rounded-xl object-cover select-none"
        />
        {!upload && (
          <MediaProviderStatusChipForAsset
            mediaAssetId={data.mediaAssetId}
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
    </div>
  );
}

export const ImageNode = memo(ImageNodeComponent);
