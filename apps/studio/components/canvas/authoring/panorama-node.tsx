"use client";

import { memo, useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import type { Node, NodeProps } from "@xyflow/react";
import { MEDIA_ASSET_READINESS_CAPABILITY } from "@repo/shared";
import { IconDownload, IconPencil, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { CANVAS_NODE_DRAG_HANDLE_CLASS } from "@/components/canvas/canvas-interaction-policy";
import { useCanvasGraphContext } from "@/lib/canvas-core/canvas-graph-context";
import { CanvasNodeToolbar, ToolbarButton } from "./node-toolbar";
import { Icon720, PanoramaCanvas, PanoramaViewer } from "./panorama-viewer";
import { PortPlus } from "./ports";
import { MediaAssetReadinessControlForAsset } from "./media-asset-readiness";

export type PanoramaNodeType = Node<
  { src: string; imageId?: string; mediaAssetId?: string; label?: string },
  "panorama"
>;

/** A panorama asset on the canvas — renders the equirectangular image as a live
 *  inline 360 view (drag to look around), with a fullscreen 720° viewer. The
 *  header is the drag handle; the canvas body is `nodrag` so dragging looks
 *  around instead of moving the node. */
function PanoramaNodeComponent({ id, data, selected }: NodeProps<PanoramaNodeType>) {
  const t = useTranslations("canvasNodes");
  const [full, setFull] = useState(false);
  const [renaming, setRenaming] = useState(false);
  // Default to a STATIC preview — the live 360 canvas captures drag/scroll, so
  // entering it must be opt-in (else hovering the card hijacks the canvas).
  const [entered, setEntered] = useState(false);
  const { patchNodeData, renameAssetsByMediaAssetId } = useCanvasGraphContext();
  const title = data.label ?? t("panorama.title");

  const onDownload = () => {
    const anchor = document.createElement("a");
    anchor.href = data.src;
    anchor.download = title;
    anchor.click();
  };

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
    <div className="relative w-[360px]">
      <CanvasNodeToolbar nodeId={id} visible={selected ?? false}>
        <ToolbarButton label={t("panorama.view720")} onClick={() => setFull(true)}>
          <Icon720 className="size-4" />
        </ToolbarButton>
        <ToolbarButton label={t("panorama.download")} onClick={onDownload} iconOnly>
          <IconDownload className="size-4" stroke={1.8} />
        </ToolbarButton>
        <ToolbarButton label={t("panorama.rename")} onClick={() => setRenaming(true)}>
          <IconPencil className="size-4" stroke={1.8} />
        </ToolbarButton>
      </CanvasNodeToolbar>

      {/* Header = drag handle */}
      <div
        className={cn(
          CANVAS_NODE_DRAG_HANDLE_CLASS,
          "flex items-center gap-1.5 rounded px-1 pb-1.5 text-xs text-white/80"
        )}
      >
        <Icon720 className="size-3.5" />
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

      {/* Input port: keeps the wire from the source image (provenance). */}
      <PortPlus type="target" id="input" side="left" />
      <PortPlus type="source" id="output" side="right" dataType="image" />
      <div className={cn("overflow-hidden rounded-xl bg-card", selected && "ring-2 ring-ring")}>
        <div
          className={cn(
            "relative aspect-[2/1] w-full bg-black",
            // Only the LIVE view captures drag/scroll (look around / zoom); the
            // static preview leaves the node draggable like any other.
            entered && "nodrag nowheel"
          )}
        >
          {entered ? (
            <>
              <PanoramaCanvas src={data.src} className="absolute inset-0" />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setEntered(false);
                }}
                className="nodrag absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white/90 transition-colors hover:bg-black/80"
              >
                <IconX className="size-3.5" stroke={2} />
                {t("panorama.exit")}
              </button>
            </>
          ) : (
            <>
              {/* Static equirectangular preview — no capture. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={data.src}
                alt={title}
                draggable={false}
                className="absolute inset-0 size-full object-cover select-none"
              />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setEntered(true);
                }}
                className="nodrag absolute inset-0 m-auto flex h-9 w-fit items-center gap-1.5 rounded-full bg-black/55 px-4 text-sm font-medium text-white transition-colors hover:bg-black/75"
              >
                <Icon720 className="size-4" />
                {t("panorama.enter")}
              </button>
            </>
          )}
          {!entered && (
            <MediaAssetReadinessControlForAsset
              mediaAssetId={data.mediaAssetId}
              capability={MEDIA_ASSET_READINESS_CAPABILITY.seedanceAigcReference}
              className="top-2 right-2 h-6 px-2 text-[10px]"
            />
          )}
        </div>
      </div>

      {full && <PanoramaViewer src={data.src} onClose={() => setFull(false)} />}
    </div>
  );
}

export const PanoramaNode = memo(PanoramaNodeComponent);
