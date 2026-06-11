"use client";

import { memo, useCallback, useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { IconDownload, IconView360 } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { CanvasNodeToolbar, ToolbarButton } from "./node-toolbar";
import { PanoramaViewer } from "./panorama-viewer";
import { PortPlus } from "./ports";

export type ImageNodeType = Node<{ src: string; imageId: string; label?: string }, "image">;

export const IMAGE_NODE_WIDTH = 280;

function ImageNodeComponent({ id, data, selected }: NodeProps<ImageNodeType>) {
  const [pano, setPano] = useState(false);

  const onDownload = useCallback(() => {
    const anchor = document.createElement("a");
    anchor.href = data.src;
    anchor.download = data.label ?? "image";
    anchor.click();
  }, [data.label, data.src]);

  return (
    <div className={cn("relative rounded-xl bg-card", selected && "ring-2 ring-ring")}>
      <PortPlus type="source" id="output" side="right" />
      <CanvasNodeToolbar nodeId={id} visible={selected ?? false}>
        <ToolbarButton label="720° View" onClick={() => setPano(true)}>
          <IconView360 className="size-4" stroke={1.8} />
        </ToolbarButton>
        <ToolbarButton label="Download" onClick={onDownload}>
          <IconDownload className="size-4" stroke={1.8} />
        </ToolbarButton>
      </CanvasNodeToolbar>

      {/* Object URLs from local blobs can't go through next/image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={data.src}
        alt={data.label ?? "Canvas image"}
        draggable={false}
        className="block max-h-[480px] w-[280px] rounded-xl object-cover select-none"
      />

      {pano && <PanoramaViewer src={data.src} onClose={() => setPano(false)} />}
    </div>
  );
}

export const ImageNode = memo(ImageNodeComponent);
