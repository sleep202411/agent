"use client";

import { type ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  buildMentionItems,
  CharacterCell,
  DurationCell,
  RichTextCell,
  SceneReferenceCell,
  SelectCell,
} from "@/app/projects/_components/storyboard/cells";
import { TextCell } from "@/app/projects/_components/storyboard/cells/text-cell";
import { persistTextCell } from "@/app/projects/_components/storyboard/cells/cell-utils";
import { useTranslations } from "@/src/i18n/i18n";
import type { ShotColumn, ShotRow, ShotValue } from "@/src/store/slices/projectSlice";

/**
 * Modal editor for a single 其他信息 field in the storyboard card view.
 *
 * Why a modal instead of in-place swap: the table-view cell components
 * are not sized for a 13px inline paragraph — stuffing them into the
 * card's 其他信息 column looked cramped / visually noisy. A modal gives
 * the cell its natural editing space and keeps the card scanning-
 * friendly. Cells auto-save on change (same behaviour as the list
 * view), so closing the dialog just stops editing — there's no explicit
 * save button.
 */
export function StoryboardCardFieldDialog({
  open,
  onClose,
  row,
  column,
  mentionItems,
}: {
  open: boolean;
  onClose: () => void;
  row: ShotRow;
  column: ShotColumn | undefined;
  mentionItems: ReturnType<typeof buildMentionItems>;
}) {
  const t = useTranslations("storyboard");

  if (!column) return null;

  const cell: ShotValue | undefined = row.shotValues?.find(
    (value) => value.shotColumnId === column.id
  );
  const shotId = String(row.shotId ?? "");
  const columnId = String(column.id ?? "");
  const label = column.columnName ?? column.presetColumnKey ?? "—";
  const textValue = cell?.richText?.content ?? cell?.value ?? "";
  const isRichText = column.resolvedType === "richtext" || column.resolvedType === "dialogue";

  const editor: ReactNode = (() => {
    switch (column.resolvedType) {
      case "richtext":
        return (
          <RichTextCell
            cell={cell}
            shotId={shotId}
            shotColumnId={columnId}
            mentionItems={mentionItems}
            placeholder={t("richtextPlaceholder")}
          />
        );
      case "dialogue":
        return (
          <RichTextCell
            cell={cell}
            shotId={shotId}
            shotColumnId={columnId}
            mentionItems={mentionItems}
            allowedMentionTypes={["character"]}
            placeholder={t("dialoguePlaceholder")}
            showAvatar={false}
            extraFields={["voiceId", "model"]}
          />
        );
      case "character":
        return <CharacterCell cell={cell} shotId={shotId} shotColumnId={columnId} />;
      case "scene":
        return <SceneReferenceCell cell={cell} shotId={shotId} shotColumnId={columnId} />;
      case "select":
        return <SelectCell column={column} cell={cell} shotId={shotId} shotColumnId={columnId} />;
      case "number":
        return <DurationCell cell={cell} shotId={shotId} shotColumnId={columnId} />;
      case "text":
      default:
        return (
          <TextCell
            value={String(textValue)}
            height={140}
            onSave={(nextValue) => void persistTextCell(shotId, columnId, nextValue)}
          />
        );
    }
  })();

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      {/* Richtext / dialogue get a wider, taller modal so the tiptap
          editor has room to breathe + mention popups don't clip. Other
          types (character / number / plain text) stay small. sm: prefix
          is required because shadcn's base DialogContent sets
          sm:max-w-sm which otherwise wins. */}
      <DialogContent
        className={isRichText ? "sm:max-w-[min(92vw,720px)]" : "sm:max-w-[min(92vw,480px)]"}
      >
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription className="sr-only">编辑分镜字段</DialogDescription>
        </DialogHeader>
        <div className={isRichText ? "min-h-[320px] p-4" : "min-h-[120px] p-4"}>{editor}</div>
      </DialogContent>
    </Dialog>
  );
}
