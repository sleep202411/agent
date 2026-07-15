"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/**
 * Declares a native interactive island inside a React Flow node.
 *
 * Pointer defaults remain owned by descendants such as video/audio controls;
 * canvas selection, node dragging, and node click focus stop at this boundary.
 */
export function CanvasNativePointerOwner({
  className,
  onClick,
  onContextMenu,
  onDoubleClick,
  onPointerDown,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      {...props}
      data-canvas-native-pointer=""
      className={cn("nodrag nopan nokey", className)}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        event.stopPropagation();
      }}
      onClick={(event) => {
        onClick?.(event);
        event.stopPropagation();
      }}
      onDoubleClick={(event) => {
        onDoubleClick?.(event);
        event.stopPropagation();
      }}
      onContextMenu={(event) => {
        onContextMenu?.(event);
        event.stopPropagation();
      }}
    />
  );
}
