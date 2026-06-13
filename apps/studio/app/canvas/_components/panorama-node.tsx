"use client";

import { memo, useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { IconDownload } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { CanvasNodeToolbar, ToolbarButton } from "./node-toolbar";
import { Icon720, PanoramaCanvas, PanoramaViewer } from "./panorama-viewer";
import { PortPlus } from "./ports";

export type PanoramaNodeType = Node<
  { src: string; imageId?: string; mediaAssetId?: string; label?: string },
  "panorama"
>;

/** A panorama asset on the canvas — renders the equirectangular image as a live
 *  inline 360 view (drag to look around), with a fullscreen 720° viewer. The
 *  header is the drag handle; the canvas body is `nodrag` so dragging looks
 *  around instead of moving the node. */
function PanoramaNodeComponent({ id, data, selected }: NodeProps<PanoramaNodeType>) {
  const [full, setFull] = useState(false);

  const onDownload = () => {
    const anchor = document.createElement("a");
    anchor.href = data.src;
    anchor.download = data.label ?? "panorama";
    anchor.click();
  };

  return (
    <div className="relative w-[360px]">
      <CanvasNodeToolbar nodeId={id} visible={selected ?? false}>
        <ToolbarButton label="720° View" onClick={() => setFull(true)}>
          <Icon720 className="size-4" />
        </ToolbarButton>
        <ToolbarButton label="Download" onClick={onDownload}>
          <IconDownload className="size-4" stroke={1.8} />
        </ToolbarButton>
      </CanvasNodeToolbar>

      {/* Header = drag handle */}
      <div className="flex items-center gap-1.5 px-1 pb-1.5 text-xs text-white/80">
        <Icon720 className="size-3.5" />
        720° Panorama
      </div>

      <PortPlus type="source" id="output" side="right" />
      <div className={cn("overflow-hidden rounded-xl bg-card", selected && "ring-2 ring-ring")}>
        {/* nodrag/nowheel: drag looks around, scroll zooms — don't pan the canvas. */}
        <div className="nodrag nowheel relative aspect-[2/1] w-full bg-black">
          <PanoramaCanvas src={data.src} className="absolute inset-0" />
        </div>
      </div>

      {full && <PanoramaViewer src={data.src} onClose={() => setFull(false)} />}
    </div>
  );
}

export const PanoramaNode = memo(PanoramaNodeComponent);
