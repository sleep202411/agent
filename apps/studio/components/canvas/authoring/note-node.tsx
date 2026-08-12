"use client";

import { memo } from "react";
import { useTranslations } from "next-intl";
import { type Node, type NodeProps } from "@xyflow/react";
import { IconNote } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useCanvasGraphContext } from "@/lib/canvas-core/canvas-graph-context";
import { canvasNodeGeometry } from "@/lib/canvas-core/node-geometry";
import { CanvasNodeToolbar } from "./node-toolbar";

export type NoteNodeType = Node<{ text: string }, "note">;

function NoteNodeComponent({ id, data, selected }: NodeProps<NoteNodeType>) {
  const t = useTranslations("canvasNodes");
  const { patchNodeData, canEdit } = useCanvasGraphContext();

  return (
    <div className="relative" style={{ width: canvasNodeGeometry({ type: "note" }).width }}>
      <CanvasNodeToolbar nodeId={id} visible={selected ?? false} />

      {/* Header — matches the generation cards' title row. */}
      <div className="flex items-center gap-1.5 rounded px-1 pb-1.5 text-xs text-white/80">
        <IconNote className="size-3.5" stroke={1.8} />
        {t("note.title")}
      </div>

      <div
        className={cn("rounded-xl bg-muted p-4", selected && "ring-2 ring-ring")}
        style={{ minHeight: canvasNodeGeometry({ type: "note" }).minHeight - 26 }}
      >
        <textarea
          value={data.text}
          onChange={(event) => patchNodeData(id, { text: event.target.value })}
          placeholder={canEdit ? t("note.placeholder") : ""}
          rows={6}
          readOnly={!canEdit}
          data-canvas-scroll-owner="y"
          className="nodrag nowheel block w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>
    </div>
  );
}

export const NoteNode = memo(NoteNodeComponent);
