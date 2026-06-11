"use client";

import { memo } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";

export type ImageNodeType = Node<{ src: string; label?: string }, "image">;

export const IMAGE_NODE_WIDTH = 280;

function ImageNodeComponent({ data, selected }: NodeProps<ImageNodeType>) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl bg-card shadow-md transition-shadow",
        selected && "ring-2 ring-ring"
      )}
    >
      {/* Object URLs from local drops can't go through next/image. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={data.src}
        alt={data.label ?? "Canvas image"}
        draggable={false}
        className="block max-h-[480px] w-[280px] object-cover select-none"
      />
    </div>
  );
}

export const ImageNode = memo(ImageNodeComponent);
