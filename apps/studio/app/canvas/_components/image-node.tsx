"use client";

import { memo, useCallback } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { IconDownload } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { CanvasNodeToolbar, ToolbarButton } from "./node-toolbar";
import { Port } from "./ports";

export type ImageNodeType = Node<{ src: string; imageId: string; label?: string }, "image">;

export const IMAGE_NODE_WIDTH = 280;

function ImageNodeComponent({ id, data, selected }: NodeProps<ImageNodeType>) {
  const onDownload = useCallback(() => {
    const anchor = document.createElement("a");
    anchor.href = data.src;
    anchor.download = data.label ?? "image";
    anchor.click();
  }, [data.label, data.src]);

  return (
    <div
      className={cn(
        "relative rounded-xl bg-card shadow-md transition-shadow",
        selected && "ring-2 ring-ring"
      )}
    >
      <Port type="source" id="image" side="right" top={32} label="Image" />
      <CanvasNodeToolbar nodeId={id} visible={selected ?? false}>
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
