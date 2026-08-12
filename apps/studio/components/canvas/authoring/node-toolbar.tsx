"use client";

import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  useCallback,
  type ReactElement,
} from "react";
import { useTranslations } from "next-intl";
import { NodeToolbar, Position, useReactFlow } from "@xyflow/react";
import { IconBoxOff, IconMessage, IconMessagePlus, IconTrash } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useCanvasGraphContext } from "@/lib/canvas-core/canvas-graph-context";
import { useCanvasNodeGroupingAction } from "@/components/canvas/groups/canvas-grouping";
import { useComments } from "./comments-context";

/** Floating panel surface for the dock and node toolbars — sits clearly above
 *  the canvas (lighter than the canvas bg) with a frosted blur. */
export const FLOATING_PANEL = "bg-[oklch(0.205_0_0)]/95 shadow-lg shadow-black/40 backdrop-blur-xl";

export type ToolbarButtonProps = {
  label: string;
  onClick: () => void;
  variant?: "default" | "danger";
  /** Override sizing (e.g. a larger dock button); merged over the size-8 default. */
  className?: string;
  /** Node toolbars can expose labels inline; dock buttons keep icon-only affordances. */
  showLabel?: boolean;
  /** Keep compact even when a node toolbar exposes labels for neighboring actions. */
  iconOnly?: boolean;
  pressed?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
};

/** Action button used by floating toolbars and docks. */
export function ToolbarButton({
  label,
  onClick,
  variant = "default",
  className,
  showLabel = false,
  iconOnly = false,
  pressed,
  disabled = false,
  children,
}: ToolbarButtonProps) {
  const withLabel = showLabel && !iconOnly;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "group/tb relative flex items-center justify-center rounded-full transition-colors",
        withLabel ? "h-8 gap-1.5 px-2.5" : "size-8",
        disabled
          ? "text-white/28"
          : variant === "danger"
            ? "text-red-400 hover:bg-red-500/15 hover:text-red-300"
            : pressed
              ? "bg-white/[0.14] text-white"
              : "text-white/70 hover:bg-white/[0.1] hover:text-white",
        className
      )}
    >
      {children}
      {withLabel ? (
        <span className="whitespace-nowrap text-xs font-medium">{label}</span>
      ) : (
        <span className="pointer-events-none absolute -top-8 left-1/2 z-10 -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-xs font-medium whitespace-nowrap text-background opacity-0 shadow-md transition-opacity duration-150 group-hover/tb:opacity-100">
          {label}
        </span>
      )}
    </button>
  );
}

const MAX_VISIBLE_TOOLBAR_LABELS = 3;

function withVisibleToolbarLabels(children: React.ReactNode): React.ReactNode {
  let visibleLabels = 0;

  const mapChildren = (node: React.ReactNode): React.ReactNode =>
    Children.map(node, (child) => {
      if (!isValidElement(child)) return child;
      if (child.type === Fragment) {
        const fragment = child as ReactElement<{ children?: React.ReactNode }>;
        return cloneElement(fragment, undefined, mapChildren(fragment.props.children));
      }
      if (child.type !== ToolbarButton) return child;
      const button = child as ReactElement<ToolbarButtonProps>;
      if (button.props.iconOnly) return button;
      const showLabel = visibleLabels < MAX_VISIBLE_TOOLBAR_LABELS;
      visibleLabels += 1;
      return cloneElement(button, { showLabel });
    });

  return mapChildren(children);
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
  const t = useTranslations("canvasControls");
  const tc = useTranslations("common");
  const tg = useTranslations("canvas.groups");
  const { deleteElements } = useReactFlow();
  const { canEdit, nodes } = useCanvasGraphContext();
  const { enabled: commentsEnabled, toggle, commentCount } = useComments();
  const groupingAction = useCanvasNodeGroupingAction(nodeId);
  const soleSelected = nodes.filter((n) => n.selected).length === 1;
  const count = commentCount(nodeId);

  const onDelete = useCallback(() => {
    void deleteElements({ nodes: [{ id: nodeId }] });
  }, [deleteElements, nodeId]);

  return (
    <NodeToolbar
      isVisible={visible && soleSelected}
      position={Position.Top}
      align="center"
      offset={10}
      className={cn(
        "nodrag nopan nowheel flex min-h-12 max-w-[calc(100vw-2rem)] flex-wrap items-center gap-1 rounded-2xl px-2 py-2",
        FLOATING_PANEL
      )}
    >
      {canEdit && groupingAction ? (
        <ToolbarButton label={tg("removeNode")} onClick={groupingAction.remove} showLabel>
          <IconBoxOff className="size-4" stroke={1.8} />
        </ToolbarButton>
      ) : null}
      {canEdit && withVisibleToolbarLabels(children)}
      {canEdit && (
        <ToolbarButton label={tc("delete")} variant="danger" onClick={onDelete}>
          <IconTrash className="size-4" stroke={1.8} />
        </ToolbarButton>
      )}
      {commentsEnabled ? (
        <ToolbarButton label={t("comment")} onClick={() => toggle(nodeId)}>
          {count > 0 ? (
            <IconMessage className="size-4" stroke={1.8} />
          ) : (
            <IconMessagePlus className="size-4" stroke={1.8} />
          )}
        </ToolbarButton>
      ) : null}
    </NodeToolbar>
  );
}
