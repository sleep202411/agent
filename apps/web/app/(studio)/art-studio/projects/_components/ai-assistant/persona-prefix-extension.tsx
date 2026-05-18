"use client";

import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { PERSONA_TONE_TEXT, getPersonaFromForcedKey } from "@/src/lib/assistant/personas";
import type { ForcedPersonaKey } from "./force-persona-pills";

/**
 * Tiptap inline-atom node that renders the "force this designer" chip
 * inside the chat composer. We use Tiptap (ProseMirror) here for the
 * same reason the AI image generator does: atomic inline nodes are a
 * solved problem in ProseMirror — caret traversal, selection, atomic
 * delete on backspace, IME composition all work natively. Building
 * this on raw `contenteditable` was fighting browser internals; this
 * file is the right primitive.
 *
 * Lifecycle:
 *  - Pill click → composer dispatches `setForcedPersona`, the editor's
 *    sync effect inserts a `personaPrefix` node at the start of the doc.
 *  - User backspace at offset 1 (right after chip) → ProseMirror
 *    deletes the atom as one unit → `onUpdate` notices the chip is
 *    gone → composer clears `forcedPersona` → pills + ring follow.
 *  - X click on the chip → same delete path.
 */
export const PersonaPrefixNode = Node.create({
  name: "personaPrefix",
  group: "inline",
  inline: true,
  atom: true,
  selectable: false,
  draggable: false,

  addAttributes() {
    return {
      persona: { default: "character_designer" as ForcedPersonaKey },
    };
  },

  parseHTML() {
    return [{ tag: "persona-prefix" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["persona-prefix", mergeAttributes(HTMLAttributes)];
  },

  addNodeView() {
    return ReactNodeViewRenderer(PersonaChipView);
  },
});

function PersonaChipView({ node }: NodeViewProps) {
  const t = useTranslations("ai");
  const personaKey = node.attrs.persona as ForcedPersonaKey;
  const persona = getPersonaFromForcedKey(personaKey);
  if (!persona) return null;
  const displayName = t(`personas.${persona.nameKey}`);

  // Plain inline text in the persona's tone — no badge, no border,
  // no X button. The user removes it via backspace (atom-delete) or
  // by clicking the pill again. ProseMirror still treats this as a
  // single atomic unit, so caret / IME / selection all behave.
  return (
    <NodeViewWrapper as="span" data-persona-prefix style={{ display: "inline" }}>
      <span contentEditable={false} className={cn("font-medium", PERSONA_TONE_TEXT[persona.tone])}>
        {displayName} /{" "}
      </span>
    </NodeViewWrapper>
  );
}
