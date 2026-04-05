"use client";

import { createColumnHelper } from "@tanstack/react-table";
import { EditableTextCell } from "./cells/editable-text-cell";
import { SelectCell } from "./cells/select-cell";
import { ThumbnailCell } from "./cells/thumbnail-cell";
import { NumberCell } from "./cells/number-cell";
import { ActionCell } from "./cells/action-cell";
import type { StoryboardShot } from "@/src/types/storyboard";
import type { MentionItem } from "./editor/mention-node";

const shotSizes = ["全景", "远景", "中景", "近景", "特写", "大特写"];
const movements = ["固定", "推", "拉", "摇", "移", "跟", "升", "降"];

const col = createColumnHelper<StoryboardShot>();

export type CellEditingState = {
  isEditing: (rowIndex: number, colId: string) => boolean;
  startEdit: (rowIndex: number, colId: string) => void;
  stopEdit: () => void;
};

export function createStoryboardColumns(
  onUpdateCell: (shotId: string, field: keyof StoryboardShot, value: unknown) => void,
  onDelete: (shotId: string) => void,
  editState: CellEditingState,
  mentionItems: MentionItem[],
  t?: (key: string) => string
) {
  return [
    col.display({
      id: "shotNumber",
      header: "#",
      size: 50,
      cell: ({ row }) => (
        <div className="text-center text-xs font-medium text-muted-foreground">{row.index + 1}</div>
      ),
    }),

    col.accessor("imageUrl", {
      header: t?.("columnThumbnail") ?? "缩略图",
      size: 120,
      cell: ({ row }) => (
        <ThumbnailCell
          imageUrl={row.original.imageUrl}
          videoUrl={row.original.videoUrl}
          imageStatus={row.original.imageStatus}
        />
      ),
    }),

    col.accessor("description", {
      id: "description",
      header: t?.("columnDescription") ?? "画面描述",
      size: 280,
      cell: ({ row }) => (
        <EditableTextCell
          value={row.original.description}
          editing={editState.isEditing(row.index, "description")}
          onSave={(v) => onUpdateCell(row.original.id, "description", v)}
          onStartEdit={() => editState.startEdit(row.index, "description")}
          onStopEdit={editState.stopEdit}
          placeholder={
            t?.("descriptionCellPlaceholder") ?? "描述画面内容... 输入 @ 引用角色/场景/道具"
          }
          mentionItems={mentionItems}
        />
      ),
    }),

    col.accessor("videoPrompt", {
      id: "videoPrompt",
      header: t?.("columnVideoPrompt") ?? "视频描述",
      size: 200,
      cell: ({ row }) => (
        <EditableTextCell
          value={row.original.videoPrompt}
          editing={editState.isEditing(row.index, "videoPrompt")}
          onSave={(v) => onUpdateCell(row.original.id, "videoPrompt", v)}
          onStartEdit={() => editState.startEdit(row.index, "videoPrompt")}
          onStopEdit={editState.stopEdit}
          placeholder={t?.("videoPromptCellPlaceholder") ?? "视频生成提示词..."}
          mentionItems={mentionItems}
        />
      ),
    }),

    col.accessor("shotSize", {
      id: "shotSize",
      header: t?.("columnShotSize") ?? "景别",
      size: 90,
      cell: ({ row }) => (
        <SelectCell
          value={row.original.shotSize}
          options={shotSizes}
          editing={editState.isEditing(row.index, "shotSize")}
          onSave={(v) => onUpdateCell(row.original.id, "shotSize", v)}
          onStartEdit={() => editState.startEdit(row.index, "shotSize")}
          onStopEdit={editState.stopEdit}
        />
      ),
    }),

    col.accessor("cameraMovement", {
      id: "cameraMovement",
      header: t?.("columnCameraMovement") ?? "运镜",
      size: 90,
      cell: ({ row }) => (
        <SelectCell
          value={row.original.cameraMovement}
          options={movements}
          editing={editState.isEditing(row.index, "cameraMovement")}
          onSave={(v) => onUpdateCell(row.original.id, "cameraMovement", v)}
          onStartEdit={() => editState.startEdit(row.index, "cameraMovement")}
          onStopEdit={editState.stopEdit}
        />
      ),
    }),

    col.accessor("dialogue", {
      id: "dialogue",
      header: t?.("columnDialogue") ?? "对白",
      size: 180,
      cell: ({ row }) => (
        <EditableTextCell
          value={row.original.dialogue}
          editing={editState.isEditing(row.index, "dialogue")}
          onSave={(v) => onUpdateCell(row.original.id, "dialogue", v)}
          onStartEdit={() => editState.startEdit(row.index, "dialogue")}
          onStopEdit={editState.stopEdit}
          placeholder={t?.("dialogueCellPlaceholder") ?? "角色对白... 输入 @ 引用角色"}
          mentionItems={mentionItems}
          allowedMentionTypes={["character"]}
          showAvatar={false}
          extraFields={["voiceId", "model"]}
        />
      ),
    }),

    col.accessor("narration", {
      id: "narration",
      header: t?.("columnNarration") ?? "旁白",
      size: 150,
      cell: ({ row }) => (
        <EditableTextCell
          value={row.original.narration}
          editing={editState.isEditing(row.index, "narration")}
          onSave={(v) => onUpdateCell(row.original.id, "narration", v)}
          onStartEdit={() => editState.startEdit(row.index, "narration")}
          onStopEdit={editState.stopEdit}
          placeholder={t?.("narrationCellPlaceholder") ?? "旁白文本..."}
          mentionItems={mentionItems}
        />
      ),
    }),

    col.accessor("duration", {
      id: "duration",
      header: t?.("columnDuration") ?? "时长",
      size: 70,
      cell: ({ row }) => (
        <NumberCell
          value={row.original.duration}
          editing={editState.isEditing(row.index, "duration")}
          onSave={(v) => onUpdateCell(row.original.id, "duration", v)}
          onStartEdit={() => editState.startEdit(row.index, "duration")}
          onStopEdit={editState.stopEdit}
        />
      ),
    }),

    col.display({
      id: "actions",
      header: t?.("columnActions") ?? "操作",
      size: 80,
      cell: ({ row }) => (
        <ActionCell
          onGenerateImage={() => {}}
          onGenerateVideo={() => {}}
          onDelete={() => onDelete(row.original.id)}
        />
      ),
    }),
  ];
}
