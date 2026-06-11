"use client";

import { useCallback } from "react";
import { NodeToolbar, Position, useReactFlow } from "@xyflow/react";
import { IconTrash } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

/** Floating panel surface for the dock and node toolbars — sits clearly above
 *  the canvas (lighter than the canvas bg) with a frosted blur. */
export const FLOATING_PANEL = "bg-[oklch(0.205_0_0)]/95 shadow-lg shadow-black/40 backdrop-blur-xl";

/** Icon-only action button with a hover tooltip. */
export function ToolbarButton({
  label,
  onClick,
  variant = "default",
  children,
}: {
  label: string;
  onClick: () => void;
  variant?: "default" | "danger";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "group/tb relative flex size-8 items-center justify-center rounded-full transition-colors",
        variant === "danger"
          ? "text-white/70 hover:bg-red-500/15 hover:text-red-400"
          : "text-white/70 hover:bg-white/[0.1] hover:text-white"
      )}
    >
      {children}
      <span className="pointer-events-none absolute -top-8 left-1/2 z-10 -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-xs font-medium whitespace-nowrap text-background opacity-0 shadow-md transition-opacity duration-150 group-hover/tb:opacity-100">
        {label}
      </span>
    </button>
  );
}

/** Toolbar above a selected node: `children` actions, then a built-in Delete. */
export function CanvasNodeToolbar({
  nodeId,
  visible,
  children,
}: {
  nodeId: string;
  visible: boolean;
  children?: React.ReactNode;
}) {
  const { deleteElements } = useReactFlow();

  const onDelete = useCallback(() => {
    void deleteElements({ nodes: [{ id: nodeId }] });
  }, [deleteElements, nodeId]);

  return (
    <NodeToolbar
      isVisible={visible}
      position={Position.Top}
      offset={10}
      className={cn("flex items-center gap-0.5 rounded-full p-1", FLOATING_PANEL)}
    >
      {children}
      <ToolbarButton label="Delete" variant="danger" onClick={onDelete}>
        <IconTrash className="size-4" stroke={1.8} />
      </ToolbarButton>
    </NodeToolbar>
  );
}
