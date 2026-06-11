"use client";

import { memo } from "react";
import { useReactFlow, type Node, type NodeProps } from "@xyflow/react";
import { IconNote } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { CanvasNodeToolbar } from "./node-toolbar";

export type NoteNodeType = Node<{ text: string }, "note">;

function NoteNodeComponent({ id, data, selected }: NodeProps<NoteNodeType>) {
  const { updateNodeData } = useReactFlow();

  return (
    <div className="relative w-60">
      <CanvasNodeToolbar nodeId={id} visible={selected ?? false} />

      {/* Header — matches the generation cards' title row. */}
      <div className="flex items-center gap-1.5 px-1 pb-1.5 text-xs text-white/80">
        <IconNote className="size-3.5" stroke={1.8} />
        Note
      </div>

      <div className={cn("rounded-xl bg-muted p-3", selected && "ring-2 ring-ring")}>
        <textarea
          value={data.text}
          onChange={(event) => updateNodeData(id, { text: event.target.value })}
          placeholder="Write a note…"
          rows={4}
          className="nodrag block w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );
}

export const NoteNode = memo(NoteNodeComponent);
