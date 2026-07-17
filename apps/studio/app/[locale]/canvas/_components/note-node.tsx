"use client";

import { memo } from "react";
import { useTranslations } from "next-intl";
import { type Node, type NodeProps } from "@xyflow/react";
import { IconNote } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { CANVAS_NODE_DRAG_HANDLE_CLASS } from "@/components/canvas/canvas-interaction-policy";
import { useCanvasGraphContext } from "@/lib/collab/canvas-graph-context";
import { CanvasNodeToolbar } from "./node-toolbar";

export type NoteNodeType = Node<{ text: string }, "note">;

function NoteNodeComponent({ id, data, selected }: NodeProps<NoteNodeType>) {
  const t = useTranslations("canvasNodes");
  const { patchNodeData, canEdit } = useCanvasGraphContext();

  return (
    <div className="relative w-60">
      <CanvasNodeToolbar nodeId={id} visible={selected ?? false} />

      {/* Header — matches the generation cards' title row. */}
      <div
        className={cn(
          CANVAS_NODE_DRAG_HANDLE_CLASS,
          "flex items-center gap-1.5 rounded px-1 pb-1.5 text-xs text-white/80"
        )}
      >
        <IconNote className="size-3.5" stroke={1.8} />
        {t("note.title")}
      </div>

      <div className={cn("rounded-xl bg-muted p-3", selected && "ring-2 ring-ring")}>
        <textarea
          value={data.text}
          onChange={(event) => patchNodeData(id, { text: event.target.value })}
          placeholder={canEdit ? t("note.placeholder") : ""}
          rows={4}
          readOnly={!canEdit}
          data-canvas-scroll-owner="y"
          className="nodrag nowheel block w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );
}

export const NoteNode = memo(NoteNodeComponent);
