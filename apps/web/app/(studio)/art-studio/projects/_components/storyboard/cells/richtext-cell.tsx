"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RichMentionEditor } from "@/app/(studio)/art-studio/projects/_components/storyboard/editor/rich-mention-editor";
import type {
  MentionItem,
  MentionType,
} from "@/app/(studio)/art-studio/projects/_components/storyboard/editor/mention-node";
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

  // ── Debounced autosave ────────────────────────────────────────────────
  // Edits used to persist only on blur, so anything typed before navigating
  // away / a failed blur-save was lost. We now autosave on every change with
  // an 800ms trailing debounce, and flush immediately on blur and on unmount
  // so the final value always reaches the backend. Timer is component-scoped
  // (not module-global) so it can't fire against a different project later.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingValue = useRef<string | null>(null);

  const flush = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (pendingValue.current != null) {
      const v = pendingValue.current;
      pendingValue.current = null;
      void persistTextCell(shotId, shotColumnId, v, { richText: true, silent: true });
    }
  }, [shotId, shotColumnId]);

  const scheduleSave = useCallback(
    (nextValue: string) => {
      pendingValue.current = normalizeRichTextValue(nextValue);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, 800);
    },
    [flush]
  );

  // Flush any pending edit when the cell unmounts (navigation, row removal…).
  useEffect(() => () => flush(), [flush]);

  return (
    <div className="h-full w-full px-3 py-2">
      {editing ? (
        <RichMentionEditor
          value={value}
          editing
          onAutoSave={scheduleSave}
          onChange={(nextValue) => {
            // Blur commit → persist immediately and drop any pending debounce.
            pendingValue.current = null;
            if (saveTimer.current) {
              clearTimeout(saveTimer.current);
              saveTimer.current = null;
            }
            void persistTextCell(shotId, shotColumnId, normalizeRichTextValue(nextValue), {
              richText: true,
            });
          }}
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
