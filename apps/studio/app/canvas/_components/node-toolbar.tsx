"use client";

import { useCallback } from "react";
import { NodeToolbar, Position, useReactFlow } from "@xyflow/react";
import { IconMessage, IconMessagePlus, IconTrash } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useCanvasGraphContext } from "@/lib/collab/canvas-graph-context";
import { useComments } from "./comments-context";

/** Floating panel surface for the dock and node toolbars — sits clearly above
 *  the canvas (lighter than the canvas bg) with a frosted blur. */
export const FLOATING_PANEL = "bg-[oklch(0.205_0_0)]/95 shadow-lg shadow-black/40 backdrop-blur-xl";

/** Icon-only action button with a hover tooltip. */
export function ToolbarButton({
  label,
  onClick,
  variant = "default",
  className,
  children,
}: {
  label: string;
  onClick: () => void;
  variant?: "default" | "danger";
  /** Override sizing (e.g. a larger dock button); merged over the size-8 default. */
  className?: string;
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
          : "text-white/70 hover:bg-white/[0.1] hover:text-white",
        className
      )}
    >
      {children}
      <span className="pointer-events-none absolute -top-8 left-1/2 z-10 -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-xs font-medium whitespace-nowrap text-background opacity-0 shadow-md transition-opacity duration-150 group-hover/tb:opacity-100">
        {label}
      </span>
    </button>
  );
}

/**
 * Actions bar above the single selected node: `children` actions + Delete
 * (editor-only) and an always-available Comment. Shown only for a sole
 * selection — a marquee / multi-select doesn't pop a bar on every node.
 */
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
  const { canEdit, nodes } = useCanvasGraphContext();
  const { toggle, commentCount } = useComments();
  const soleSelected = nodes.filter((n) => n.selected).length === 1;
  const count = commentCount(nodeId);

  const onDelete = useCallback(() => {
    void deleteElements({ nodes: [{ id: nodeId }] });
  }, [deleteElements, nodeId]);

  return (
    <NodeToolbar
      isVisible={visible && soleSelected}
      position={Position.Top}
      offset={10}
      className={cn("flex h-12 items-center gap-0.5 rounded-full px-2", FLOATING_PANEL)}
    >
      {canEdit && children}
      {canEdit && (
        <ToolbarButton label="Delete" variant="danger" onClick={onDelete}>
          <IconTrash className="size-4" stroke={1.8} />
        </ToolbarButton>
      )}
      <ToolbarButton label="Comment" onClick={() => toggle(nodeId)}>
        {count > 0 ? (
          <IconMessage className="size-4" stroke={1.8} />
        ) : (
          <IconMessagePlus className="size-4" stroke={1.8} />
        )}
      </ToolbarButton>
    </NodeToolbar>
  );
}
