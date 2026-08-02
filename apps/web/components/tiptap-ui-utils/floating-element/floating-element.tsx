"use client";

import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Editor } from "@tiptap/react";
import { flip, offset, shift, useMergeRefs, type UseFloatingOptions } from "@floating-ui/react";
import { Selection } from "@tiptap/pm/state";

// --- Hooks ---
import { useTiptapEditor } from "@/hooks/use-tiptap-editor";
import { useFloatingElement } from "@/hooks/use-floating-element";

// --- Lib ---
import { getSelectionBoundingRect, isSelectionValid } from "@/lib/tiptap-editor-utils";

import {
  isElementWithinEditor,
  isElementWithinExternalPortal,
} from "@/components/tiptap-ui-utils/floating-element";
import { isValidPosition } from "@/lib/tiptap-utils";

export interface FloatingElementProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * The Tiptap editor instance to attach to.
   */
  editor?: Editor | null;
  /**
   * Controls whether the floating element should be visible.
   * @default undefined
   */
  shouldShow?: boolean;
  /**
   * Additional options to pass to the floating UI.
   */
  floatingOptions?: Partial<UseFloatingOptions>;
  /**
   * Z-index for the floating element.
   * @default 50
   */
  zIndex?: number;
  /**
   * Callback fired when the visibility state changes.
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * Reference element to position the floating element relative to.
   * If provided, this takes precedence over getBoundingClientRect.
   */
  referenceElement?: HTMLElement | null;
  /**
   * Custom function to determine the position of the floating element.
   * Only used if referenceElement is not provided.
   * @default getSelectionBoundingRect
   */
  getBoundingClientRect?: (editor: Editor) => DOMRect | null;
  /**
   * Whether to close the floating element when Escape key is pressed.
   * @default true
   */
  closeOnEscape?: boolean;
  /**
   * Whether to reset the text selection when the floating element is closed or clicked outside the editor.
   * @default true
   */
  resetTextSelectionOnClose?: boolean;
}

/**
 * A floating UI element that positions itself relative to the current selection in a Tiptap editor.
 * Used for floating toolbars, menus, and other UI elements that need to appear near the text cursor.
 */
export const FloatingElement = forwardRef<HTMLDivElement, FloatingElementProps>(
  (
    {
      editor: providedEditor,
      shouldShow = undefined,
      floatingOptions,
      zIndex = 50,
      onOpenChange,
      referenceElement,
      getBoundingClientRect = getSelectionBoundingRect,
      closeOnEscape = true,
      resetTextSelectionOnClose = true,
      children,
      style: propStyle,
      ...props
    },
    forwardedRef
  ) => {
    const [open, setOpen] = useState<boolean>(shouldShow !== undefined ? shouldShow : false);

    const floatingElementRef = useRef<HTMLDivElement | null>(null);
    const preventHideRef = useRef(false);
    const preventShowRef = useRef(false);
    const editorRef = useRef<Editor | null>(null);
    const getBoundingClientRectRef = useRef(getBoundingClientRect);
    // Mirrors `open` so handleOpenChange can dedupe without re-rendering.
    const openRef = useRef(open);

    const { editor } = useTiptapEditor(providedEditor);

    // Keep refs up to date
    useEffect(() => {
      editorRef.current = editor;
      getBoundingClientRectRef.current = getBoundingClientRect;
    }, [editor, getBoundingClientRect]);

    const handleOpenChange = useCallback(
      (newOpen: boolean) => {
        // Only report REAL transitions. Visibility is re-evaluated on every
        // selection update, so without this a consumer's `onOpenChange`
        // receives a stream of redundant "closed" calls — including one from
        // the render where an external `shouldShow` hasn't caught up with
        // the state that is about to open it, which would let the consumer
        // cancel its own open.
        if (openRef.current === newOpen) return;
        openRef.current = newOpen;
        onOpenChange?.(newOpen);
        setOpen(newOpen);
      },
      [onOpenChange]
    );

    const handleFloatingOpenChange = (open: boolean) => {
      if (!open && editor && resetTextSelectionOnClose) {
        // When the floating element closes, reset the selection.
        // This lets the user place the cursor again and ensures the drag handle reappears,
        // as it's intentionally hidden during valid text selections.
        const tr = editor.state.tr.setSelection(Selection.near(editor.state.doc.resolve(0)));
        editor.view.dispatch(tr);
      }

      handleOpenChange(open);
    };

    // Use referenceElement if provided, otherwise create dynamic rect function
    const reference = useMemo(() => {
      if (referenceElement) {
        return referenceElement;
      }

      return () => {
        if (!editorRef.current) return null;
        return getBoundingClientRectRef.current(editorRef.current);
      };
    }, [referenceElement]);

    const { isMounted, ref, style, getFloatingProps } = useFloatingElement(
      open,
      reference,
      zIndex,
      {
        placement: "top",
        middleware: [shift(), flip(), offset(4)],
        onOpenChange: handleFloatingOpenChange,
        dismissOptions: {
          enabled: true,
          escapeKey: true,
          outsidePress(event) {
            const relatedTarget = event.target as Node;
            if (!relatedTarget) return false;

            // Don't close if clicking inside a portaled UI
            if (isElementWithinExternalPortal(relatedTarget)) return false;

            return !isElementWithinEditor(editor, relatedTarget);
          },
        },
        ...floatingOptions,
      }
    );

    const updateSelectionState = useCallback(() => {
      if (!editor) return;

      const newRect = getBoundingClientRect(editor);

      if (shouldShow !== undefined) {
        // Externally controlled visibility (`shouldShow` prop): mirror the
        // prop. While a mouse press is in flight (`preventShowRef`), DEFER
        // instead of falling through to the force-close below — the press
        // suppression exists for selection-driven floatings and must not
        // clobber external state (e.g. the thread panel opening from the
        // very click that is still being processed). `handleMouseUp` re-runs
        // this once the press ends.
        if (preventShowRef.current) return;
        // With an explicit `referenceElement` the selection rect is
        // irrelevant — the floating anchors to that element (e.g. the
        // thread panel anchors to the thread mark, while the caret sits
        // collapsed inside it).
        const hasAnchor = referenceElement != null || !!newRect;
        if (hasAnchor) {
          handleOpenChange(shouldShow);
        } else if (!preventHideRef.current) {
          handleOpenChange(false);
        }
        return;
      }

      const shouldShowResult = isSelectionValid(editor);

      if (newRect && !preventShowRef.current && (shouldShowResult || preventHideRef.current)) {
        handleOpenChange(true);
      } else if (
        !preventHideRef.current &&
        (!shouldShowResult || preventShowRef.current || !editor.isEditable)
      ) {
        handleOpenChange(false);
      }
    }, [editor, getBoundingClientRect, handleOpenChange, shouldShow, referenceElement]);

    useEffect(() => {
      if (!editor || !closeOnEscape) return;

      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.key === "Escape" && open) {
          handleOpenChange(false);
          return true;
        }
        return false;
      };

      editor.view.dom.addEventListener("keydown", handleKeyDown);
      return () => {
        editor.view.dom.removeEventListener("keydown", handleKeyDown);
      };
    }, [editor, open, closeOnEscape, handleOpenChange]);

    useEffect(() => {
      if (!editor) return;

      const handleBlur = (event: FocusEvent) => {
        if (preventHideRef.current) {
          preventHideRef.current = false;
          return;
        }

        const relatedTarget = event.relatedTarget as Node;
        if (!relatedTarget) return;

        const isWithinEditor = isElementWithinEditor(editor, relatedTarget);

        const floatingElement = floatingElementRef.current;
        const isWithinFloatingElement =
          floatingElement &&
          (floatingElement === relatedTarget || floatingElement.contains(relatedTarget));

        // Don't close if focus moved to a portaled UI
        const isWithinExternalPortal = isElementWithinExternalPortal(relatedTarget);

        if (!isWithinEditor && !isWithinFloatingElement && !isWithinExternalPortal && open) {
          handleOpenChange(false);
        }
      };

      editor.view.dom.addEventListener("blur", handleBlur);
      return () => {
        editor.view.dom.removeEventListener("blur", handleBlur);
      };
    }, [editor, handleOpenChange, open]);

    useEffect(() => {
      if (!editor) return;

      const handleDrag = () => {
        if (open) {
          handleOpenChange(false);
        }
      };

      editor.view.dom.addEventListener("dragstart", handleDrag);
      editor.view.dom.addEventListener("dragover", handleDrag);

      return () => {
        editor.view.dom.removeEventListener("dragstart", handleDrag);
        editor.view.dom.removeEventListener("dragover", handleDrag);
      };
    }, [editor, open, handleOpenChange]);

    useEffect(() => {
      if (!editor) return;

      const handleMouseDown = (event: MouseEvent) => {
        if (event.button !== 0) return;

        preventShowRef.current = true;

        // Only run the cursor-placement branch for genuine single clicks.
        // This handler exists to solve a specific issue: when the editor
        // loses focus while the floating UI is open, the first click back
        // into the content only refocuses the editor and a second click is
        // needed to place the caret. We dispatch the caret position
        // ourselves so a single click both refocuses and places the caret.
        //
        // That intent is single-click only. On a `mousedown` whose
        // `event.detail` is 2 or higher, the browser is in the middle of a
        // multi-click sequence (double-click word selection, triple-click
        // block selection via `handleTripleClick`, etc.) and overwriting
        // with a collapsed `Selection.near` here would silently destroy
        // those selections — most visibly for triple-click, where
        // ProseMirror calls `event.preventDefault()` so the browser cannot
        // restore the selection after we collapse it.
        if (event.detail > 1) return;

        // And it is unfocused-editor only. When the editor already has
        // focus, the browser and ProseMirror place the caret natively —
        // dispatching mid-press here interferes with ProseMirror's own
        // press tracking, and with several floatings mounted every press
        // would fire one duplicate selection transaction per instance.
        if (editor.view.hasFocus()) return;

        const { state, view } = editor;
        const posCoords = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });

        if (!posCoords || !isValidPosition(posCoords.pos)) return;

        const $pos = state.doc.resolve(posCoords.pos);
        const nodeBefore = $pos.nodeBefore;

        if (!nodeBefore || nodeBefore.isBlock) return;

        const tr = state.tr.setSelection(Selection.near(state.doc.resolve(posCoords.pos)));
        view.dispatch(tr);
      };

      const handleMouseUp = (event: Event) => {
        const target = event.target;
        const NodeConstructor = editor.view.dom.ownerDocument.defaultView?.Node;
        const endedInsideEditor = Boolean(
          NodeConstructor &&
          target instanceof NodeConstructor &&
          isElementWithinEditor(editor, target)
        );
        const shouldUpdate = preventShowRef.current || endedInsideEditor;

        preventShowRef.current = false;
        if (shouldUpdate) updateSelectionState();
      };

      editor.view.dom.addEventListener("mousedown", handleMouseDown);
      editor.view.root.addEventListener("mouseup", handleMouseUp);

      return () => {
        editor.view.dom.removeEventListener("mousedown", handleMouseDown);
        editor.view.root.removeEventListener("mouseup", handleMouseUp);
      };
    }, [editor, updateSelectionState]);

    useEffect(() => {
      if (!editor) return;

      editor.on("selectionUpdate", updateSelectionState);

      return () => {
        editor.off("selectionUpdate", updateSelectionState);
      };
    }, [editor, updateSelectionState]);

    useEffect(() => {
      if (!editor) return;
      updateSelectionState();
    }, [editor, updateSelectionState]);

    const finalStyle = useMemo(
      () => (propStyle && Object.keys(propStyle).length > 0 ? propStyle : style),
      [propStyle, style]
    );
    const mergedRef = useMergeRefs([ref, forwardedRef, floatingElementRef]);

    if (!editor || !isMounted || !open) return null;

    return (
      <div ref={mergedRef} style={finalStyle} {...props} {...getFloatingProps()}>
        {children}
      </div>
    );
  }
);

FloatingElement.displayName = "FloatingElement";
