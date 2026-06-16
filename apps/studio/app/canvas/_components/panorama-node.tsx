"use client";

import { memo, useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { IconDownload, IconX } from "@tabler/icons-react";
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
  // Default to a STATIC preview — the live 360 canvas captures drag/scroll, so
  // entering it must be opt-in (else hovering the card hijacks the canvas).
  const [entered, setEntered] = useState(false);

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
                Exit
              </button>
            </>
          ) : (
            <>
              {/* Static equirectangular preview — no capture. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={data.src}
                alt={data.label ?? "Panorama"}
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
                Enter panorama
              </button>
            </>
          )}
        </div>
      </div>

      {full && <PanoramaViewer src={data.src} onClose={() => setFull(false)} />}
    </div>
  );
}

export const PanoramaNode = memo(PanoramaNodeComponent);
