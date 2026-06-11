"use client";

import { useCallback } from "react";
import { NodeToolbar, Position, useReactFlow } from "@xyflow/react";
import { IconCopy, IconTrash } from "@tabler/icons-react";

export function ToolbarButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-8 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/[0.08] hover:text-white"
    >
      {children}
    </button>
  );
}

/** Standard duplicate/delete toolbar above a selected node; `children` prepends extra actions. */
export function CanvasNodeToolbar({
  nodeId,
  visible,
  children,
}: {
  nodeId: string;
  visible: boolean;
  children?: React.ReactNode;
}) {
  const { addNodes, deleteElements, getNode } = useReactFlow();

  const onDuplicate = useCallback(() => {
    const node = getNode(nodeId);
    if (!node) return;
    addNodes({
      ...node,
      id: crypto.randomUUID(),
      position: { x: node.position.x + 32, y: node.position.y + 32 },
      selected: false,
    });
  }, [addNodes, getNode, nodeId]);

  const onDelete = useCallback(() => {
    void deleteElements({ nodes: [{ id: nodeId }] });
  }, [deleteElements, nodeId]);

  return (
    <NodeToolbar
      isVisible={visible}
      position={Position.Top}
      offset={10}
      className="flex items-center gap-0.5 rounded-full bg-popover/90 p-1 shadow-md backdrop-blur-xl"
    >
      {children}
      <ToolbarButton label="Duplicate" onClick={onDuplicate}>
        <IconCopy className="size-4" stroke={1.8} />
      </ToolbarButton>
      <ToolbarButton label="Delete" onClick={onDelete}>
        <IconTrash className="size-4" stroke={1.8} />
      </ToolbarButton>
    </NodeToolbar>
  );
}
