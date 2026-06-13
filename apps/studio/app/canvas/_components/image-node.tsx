"use client";

import { memo, useCallback } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { IconDownload } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useCreatePanorama } from "@/app/canvas/_lib/use-panorama";
import { CanvasNodeToolbar, ToolbarButton } from "./node-toolbar";
import { Icon720 } from "./panorama-viewer";
import { PortPlus } from "./ports";

export type ImageNodeType = Node<
  { src: string; imageId: string; mediaAssetId?: string; label?: string },
  "image"
>;

export const IMAGE_NODE_WIDTH = 280;

function ImageNodeComponent({ id, data, selected }: NodeProps<ImageNodeType>) {
  const createPanorama = useCreatePanorama();

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
        <ToolbarButton label="Generate Panorama" onClick={() => createPanorama(id, data.src)}>
          <Icon720 className="size-4" />
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
    </div>
  );
}

export const ImageNode = memo(ImageNodeComponent);
