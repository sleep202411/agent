import { useCallback, type CSSProperties } from "react";
import { cn } from "@/lib/utils";
import { TiptapCell } from "./mention-editor";
import type { MentionItem, MentionType } from "./mention-node";

interface RichMentionEditorProps {
  value: string;
  onChange: (value: string) => void;
  editing?: boolean;
  onStartEdit?: () => void;
  onStopEdit?: () => void;
  placeholder?: string;
  mentionItems?: MentionItem[];
  mentionTypes?: MentionType[];
  showAvatar?: boolean;
  extraFields?: Array<"voiceId" | "model">;
  minHeight?: number;
  maxHeight?: number;
  className?: string;
  onSubmitShortcut?: () => void;
  submitMode?: "none" | "mod" | "enter";
}

export function RichMentionEditor({
  value,
  onChange,
  editing = true,
  onStartEdit,
  onStopEdit,
  placeholder,
  mentionItems,
  mentionTypes,
  showAvatar = true,
  extraFields,
  minHeight,
  maxHeight,
  className,
  onSubmitShortcut,
  submitMode = "none",
}: RichMentionEditorProps) {
  const handleStartEdit = useCallback(() => {
    onStartEdit?.();
  }, [onStartEdit]);
  const handleStopEdit = useCallback(() => {
    onStopEdit?.();
  }, [onStopEdit]);

  const style: CSSProperties & {
    "--rich-mention-editor-min-height"?: string;
    "--rich-mention-editor-max-height"?: string;
  } = {};
  if (typeof minHeight === "number") {
    style["--rich-mention-editor-min-height"] = `${minHeight}px`;
  }
  if (typeof maxHeight === "number") {
    style["--rich-mention-editor-max-height"] = `${maxHeight}px`;
  }

  return (
    <div
      className={cn(
        minHeight ? "[&_[contenteditable]]:min-h-[var(--rich-mention-editor-min-height)]" : "",
        maxHeight ? "[&_[contenteditable]]:max-h-[var(--rich-mention-editor-max-height)]" : "",
        className
      )}
      style={style}
      onKeyDownCapture={(event) => {
        if (submitMode === "mod" && (event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          onSubmitShortcut?.();
        }
        if (
          submitMode === "enter" &&
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.metaKey &&
          !event.ctrlKey
        ) {
          event.preventDefault();
          onSubmitShortcut?.();
        }
      }}
    >
      <TiptapCell
        value={value}
        editing={editing}
        onSave={onChange}
        onStartEdit={handleStartEdit}
        onStopEdit={handleStopEdit}
        placeholder={placeholder}
        mentionItems={mentionItems ?? []}
        allowedMentionTypes={mentionTypes}
        showAvatar={showAvatar}
        extraFields={extraFields}
      />
    </div>
  );
}
