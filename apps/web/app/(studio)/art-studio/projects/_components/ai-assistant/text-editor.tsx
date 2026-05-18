"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useTranslations } from "@/src/i18n/i18n";
import { useAppDispatch } from "@/src/store";
import { setDraft } from "@/src/store/slices/assistantSlice";
import { PersonaPrefixNode } from "./persona-prefix-extension";
import type { ForcedPersonaKey } from "./force-persona-pills";

/**
 * Imperative handle exposed to ai-assistant-panel for the small set of
 * things it needs to do to the editor that aren't pure render: clear
 * after submit, prefill from a suggested action, focus on prompt-pick.
 *
 * Replaces the old "ref-to-the-contentEditable-div + read/write
 * innerText directly" pattern. Tiptap owns its DOM; bypassing it
 * would put the React state and the doc out of sync.
 */
export interface TextEditorHandle {
  clear(): void;
  setText(text: string): void;
  focus(): void;
  isEmpty(): boolean;
}

interface TextEditorProps {
  projectId: string | null;
  hasPendingTools: boolean;
  /** Called on Cmd/Ctrl+Enter. */
  onSend: () => void;
  /** When set, a `personaPrefix` chip lives at the start of the doc. */
  forcedPersona?: ForcedPersonaKey | null;
  /** Fired when the chip is removed from inside the editor (backspace,
   *  X click, select-and-delete). The composer treats this as deselect. */
  onClearForcedPersona?: () => void;
}

export const TextEditor = forwardRef<TextEditorHandle, TextEditorProps>(function TextEditor(
  { projectId, hasPendingTools, onSend, forcedPersona, onClearForcedPersona },
  ref
) {
  const t = useTranslations("ai");
  const dispatch = useAppDispatch();
  const [isUserTextEmpty, setIsUserTextEmpty] = useState(true);

  const editor = useEditor({
    extensions: [
      // Strip block-ish features we don't want in a chat composer —
      // headings, lists, blockquote, code blocks all stay out. We
      // keep paragraph + inline marks + history/undo.
      StarterKit.configure({
        heading: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      PersonaPrefixNode,
    ],
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        // [&_p]:my-0 — strip the default paragraph margin so our
        // absolutely-positioned placeholder lines up with the first
        // line of user text.
        class:
          "min-h-24 max-h-52 overflow-y-auto text-sm leading-relaxed outline-none focus:outline-none [&_p]:my-0",
      },
      handleKeyDown(_view, event) {
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          if (projectId && !hasPendingTools) onSend();
          return true;
        }
        return false;
      },
    },
    onUpdate({ editor }) {
      const text = getDraftText(editor);
      if (projectId) dispatch(setDraft({ projectId, draft: text }));
      setIsUserTextEmpty(text.length === 0);
      if (forcedPersona && !findPersonaChipPos(editor)) onClearForcedPersona?.();
    },
    // Avoid hydration warnings — we're in a client component but
    // Tiptap recommends this when SSR is in play.
    immediatelyRender: false,
  });

  // Keep the doc in sync with `forcedPersona`. This is the single
  // place that mutates the chip; user-driven removal flows back via
  // `onUpdate` → `onClearForcedPersona`.
  useEffect(() => {
    if (!editor) return;
    const existing = findPersonaChipPos(editor);
    if (forcedPersona) {
      if (existing) {
        // Persona switched — update the chip's attrs in place.
        editor
          .chain()
          .command(({ tr }) => {
            tr.setNodeAttribute(existing.from, "persona", forcedPersona);
            return true;
          })
          .run();
      } else {
        // Insert a fresh chip at the start of the first paragraph.
        // pos=1 is *inside* the opening of the first paragraph; pos=0
        // would put the chip outside the paragraph.
        editor
          .chain()
          .insertContentAt(1, {
            type: "personaPrefix",
            attrs: { persona: forcedPersona },
          })
          .run();
      }
    } else if (existing) {
      editor.chain().deleteRange({ from: existing.from, to: existing.to }).run();
    }
  }, [editor, forcedPersona]);

  useImperativeHandle(
    ref,
    () => ({
      clear() {
        editor?.commands.clearContent();
      },
      setText(text: string) {
        if (!editor) return;
        const para: Record<string, unknown> = { type: "paragraph", content: [] };
        const content: unknown[] = [];
        if (forcedPersona) {
          content.push({ type: "personaPrefix", attrs: { persona: forcedPersona } });
        }
        if (text) content.push({ type: "text", text });
        (para.content as unknown[]) = content;
        editor.commands.setContent({ type: "doc", content: [para] });
        editor.commands.focus("end");
      },
      focus() {
        editor?.commands.focus("end");
      },
      isEmpty() {
        if (!editor) return true;
        // Tiptap treats a doc containing only the persona chip as
        // non-empty; for our "is the user's draft empty" check we
        // want chip-only to count as empty.
        return getDraftText(editor).trim().length === 0;
      },
    }),
    [editor, forcedPersona]
  );

  // We render our own placeholder rather than using
  // @tiptap/extension-placeholder because the chip lives inside the
  // first paragraph — once it's there, Tiptap's `isEmpty` flips to
  // false and the built-in placeholder hides. We only want to show
  // the placeholder when the *user* hasn't typed anything; chip
  // alone shouldn't suppress it.
  const showPlaceholder = isUserTextEmpty;
  return (
    <div className="relative">
      {showPlaceholder && (
        <div className="pointer-events-none absolute left-0 top-0 text-sm leading-relaxed text-muted-foreground/40">
          {forcedPersona ? t("inputPlaceholder") : `${t("inputPlaceholder")} (${t("sendHint")})`}
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
});

// ─── helpers ───────────────────────────────────────────────────────

/** Concatenate all text in the doc, skipping our atom chip. */
function getDraftText(editor: Editor): string {
  let text = "";
  editor.state.doc.descendants((node) => {
    if (node.type.name === "personaPrefix") return false;
    if (node.isText) text += node.text ?? "";
  });
  return text;
}

function findPersonaChipPos(editor: Editor): { from: number; to: number } | null {
  let result: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "personaPrefix") {
      result = { from: pos, to: pos + node.nodeSize };
      return false;
    }
    return true;
  });
  return result;
}
