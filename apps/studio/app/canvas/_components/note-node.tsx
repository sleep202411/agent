"use client";

import { memo } from "react";
import { useReactFlow, type Node, type NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";
import { CanvasNodeToolbar } from "./node-toolbar";
import { Port } from "./ports";

export type NoteNodeType = Node<{ text: string }, "note">;

function NoteNodeComponent({ id, data, selected }: NodeProps<NoteNodeType>) {
  const { updateNodeData } = useReactFlow();

  return (
    <div
      className={cn(
        "relative w-60 rounded-xl bg-muted p-3 shadow-md",
        selected && "ring-2 ring-ring"
      )}
    >
      <CanvasNodeToolbar nodeId={id} visible={selected ?? false} />
      <Port type="source" id="text" side="right" top={24} label="Text" />
      <textarea
        value={data.text}
        onChange={(event) => updateNodeData(id, { text: event.target.value })}
        placeholder="Write a note…"
        rows={4}
        className="nodrag block w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

export const NoteNode = memo(NoteNodeComponent);
