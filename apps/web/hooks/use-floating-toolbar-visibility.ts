import { type Editor } from "@tiptap/react";
import { NodeSelection, type Transaction } from "@tiptap/pm/state";
import { useEffect, useRef, useState } from "react";

export const HIDE_FLOATING_META = "hideFloatingToolbar";

/**
 * Centralizes all logic about when the floating toolbar should be hidden/shown.
 *
 * - Listens for transactions that carry HIDE_FLOATING_META
 * - Clears the hide flag on common “user intent” events
 * - Handles the “re-click on the same selected node” case
 * - Exposes `shouldShow` so UI can just render based on it
 * - Exposes helpers to set selections with the meta flag
 */
export function useFloatingToolbarVisibility(params: {
  editor: Editor | null;
  isSelectionValid: (editor: Editor, selection: Editor["state"]["selection"]) => boolean;
  extraHideWhen?: boolean;
}) {
  const { editor, isSelectionValid, extraHideWhen = false } = params;
  const [shouldShow, setShouldShow] = useState(false);
  const hideRef = useRef(false);

  // --- TX listener: turn on hide when our meta is present, clear it on new Selection without the flag
  useEffect(() => {
    if (!editor) return;

    const onTx = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.getMeta(HIDE_FLOATING_META)) {
        hideRef.current = true;
        // hide immediately — selectionUpdate won't fire if the transaction
        // re-set an identical selection
        setShouldShow(false);
      } else if (
        // Clear hide flag when a new Selection is made without the meta
        // This ensures first-click on a new selection shows the floating toolbar again
        transaction.selectionSet
      ) {
        hideRef.current = false;
      }
    };

    editor.on("transaction", onTx);

    return () => {
      editor.off("transaction", onTx);
    };
  }, [editor]);

  // --- Re-click same selected node should immediately allow floating
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;

    const onPointerDown = (e: PointerEvent) => {
      const sel = editor.state.selection;
      if (!(sel instanceof NodeSelection)) return;
      const nodeDom = editor.view.nodeDOM(sel.from) as HTMLElement | null;
      if (!nodeDom) return;
      if (nodeDom.contains(e.target as Node)) {
        hideRef.current = false;
        // selection won't change, recompute now
        const valid = isSelectionValid(editor, sel);
        setShouldShow(valid && !extraHideWhen);
      }
    };

    dom.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () =>
      dom.removeEventListener("pointerdown", onPointerDown, {
        capture: true,
      });
  }, [editor, extraHideWhen, isSelectionValid]);

  // --- Selection-driven visibility
  useEffect(() => {
    if (!editor) return;

    const handleSelectionUpdate = () => {
      const { selection } = editor.state;
      const valid = isSelectionValid(editor, selection);

      // Non-visible selections (NodeSelection, block ranges) are the
      // programmatic kind the hide meta is set for; text selections always
      // clear the flag via the tx listener above.
      if (extraHideWhen || (hideRef.current && !selection.visible)) {
        setShouldShow(false);
        return;
      }
      setShouldShow(valid);
    };

    handleSelectionUpdate();
    editor.on("selectionUpdate", handleSelectionUpdate);
    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate);
    };
  }, [editor, extraHideWhen, isSelectionValid]);

  return { shouldShow };
}

/**
 * Programmatically select a node and hide floating for that selection.
 *
 * No-ops when `pos` no longer points at a selectable node: callers like the
 * TOC pass positions captured from an earlier doc snapshot, and a collab or
 * local edit in between would otherwise make `NodeSelection.create` throw
 * (it "does not verify the validity of its argument").
 * @param editor
 * @param pos
 */
export const selectNodeAndHideFloating = (editor: Editor, pos: number) => {
  if (!editor) return;
  const { state, view } = editor;

  const node = pos >= 0 && pos <= state.doc.content.size ? state.doc.nodeAt(pos) : null;
  if (!node || !NodeSelection.isSelectable(node)) return;

  view.dispatch(
    state.tr.setSelection(NodeSelection.create(state.doc, pos)).setMeta(HIDE_FLOATING_META, true)
  );
};
