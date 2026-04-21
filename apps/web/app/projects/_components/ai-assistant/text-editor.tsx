"use client";

import { useTranslations } from "@/src/i18n/i18n";
import { useAppDispatch } from "@/src/store";
import { setDraft } from "@/src/store/slices/assistantSlice";

interface TextEditorProps {
  projectId: string | null;
  hasPendingTools: boolean;
  editorRef: React.RefObject<HTMLDivElement | null>;
  /** Called on Ctrl/Cmd+Enter. Composer owns the send-gate logic
   *  (confirmation dialog when a workflow chip is selected) so the
   *  editor just surfaces the keyboard shortcut. */
  onSend: () => void;
}

export function TextEditor({ projectId, hasPendingTools, editorRef, onSend }: TextEditorProps) {
  const t = useTranslations("ai");
  const dispatch = useAppDispatch();

  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      data-placeholder={`${t("inputPlaceholder")} (${t("sendHint")})`}
      className="min-h-24 max-h-52 overflow-y-auto text-sm leading-relaxed outline-none empty:before:pointer-events-none empty:before:float-left empty:before:h-0 empty:before:text-muted-foreground/40 empty:before:content-[attr(data-placeholder)]"
      onInput={(event) => {
        if (projectId)
          dispatch(setDraft({ projectId, draft: (event.target as HTMLDivElement).innerText }));
      }}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          if (projectId && !hasPendingTools) onSend();
        }
      }}
    />
  );
}
