"use client";

import { useState } from "react";
import { RichMentionEditor } from "@/app/projects/_components/storyboard/editor/rich-mention-editor";
import type {
  MentionItem,
  MentionType,
} from "@/app/projects/_components/storyboard/editor/mention-node";
import {
  getCellDisplayValue,
  normalizeRichTextValue,
  persistTextCell,
  renderMentionPreviewHtml,
} from "./cell-utils";
import type { ShotValue } from "@/src/store/slices/projectSlice";

export function RichTextCell({
  cell,
  shotId,
  shotColumnId,
  mentionItems,
  allowedMentionTypes,
  placeholder,
  showAvatar = true,
  extraFields,
}: {
  cell?: ShotValue;
  shotId: string;
  shotColumnId: string;
  mentionItems: MentionItem[];
  allowedMentionTypes?: MentionType[];
  placeholder: string;
  showAvatar?: boolean;
  extraFields?: Array<"voiceId" | "model">;
}) {
  const [editing, setEditing] = useState(false);
  const value = getCellDisplayValue(cell);

  return (
    <div className="h-full w-full px-3 py-2">
      {editing ? (
        <RichMentionEditor
          value={value}
          editing
          onChange={(nextValue) =>
            void persistTextCell(shotId, shotColumnId, normalizeRichTextValue(nextValue), {
              richText: true,
            })
          }
          onStartEdit={() => setEditing(true)}
          onStopEdit={() => setEditing(false)}
          placeholder={placeholder}
          mentionItems={mentionItems}
          mentionTypes={allowedMentionTypes}
          showAvatar={showAvatar}
          extraFields={extraFields}
        />
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="block h-full w-full cursor-text overflow-hidden rounded-lg text-left hover:bg-muted/20"
        >
          {value ? (
            <div
              className="line-clamp-5 text-xs leading-relaxed"
              dangerouslySetInnerHTML={{ __html: renderMentionPreviewHtml(value) }}
            />
          ) : (
            <span className="text-xs text-muted-foreground">{placeholder}</span>
          )}
        </button>
      )}
    </div>
  );
}
