"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface TextCellProps {
  value: string;
  height: number;
  /** Blur commit — reconciles the store (non-silent). */
  onSave?: (value: string) => void;
  /** Debounced autosave — should be network-only/silent so the optimistic
   *  store update doesn't re-render this contenteditable and reset the caret.
   *  Falls back to `onSave` when not provided. */
  onAutoSave?: (value: string) => void;
}

export function TextCell({ value, height, onSave, onAutoSave }: TextCellProps) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Debounced autosave: edits used to persist only on blur, so content typed
  // before navigating away (or a failed blur-save) was lost. Now we autosave
  // on every keystroke with an 800ms trailing debounce, and flush on blur and
  // on unmount so the final value always reaches the backend.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);

  useEffect(() => {
    if (!editing || !ref.current) return;
    ref.current.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(ref.current);
    range.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editing]);

  const flush = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (pending.current != null) {
      const v = pending.current;
      pending.current = null;
      if (v !== value) (onAutoSave ?? onSave)?.(v);
    }
  }, [value, onSave, onAutoSave]);

  // Flush any pending autosave when the cell unmounts (navigation, etc.).
  useEffect(() => () => flush(), [flush]);

  const scheduleSave = useCallback(() => {
    if (!ref.current) return;
    pending.current = ref.current.innerText.trim();
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 800);
  }, [flush]);

  const commit = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    pending.current = null;
    setEditing(false);
    if (!ref.current) return;
    const newValue = ref.current.innerText.trim();
    if (newValue !== value) onSave?.(newValue);
  }, [value, onSave]);

  return (
    <div
      ref={ref}
      contentEditable={editing}
      suppressContentEditableWarning
      onDoubleClick={() => setEditing(true)}
      onInput={editing ? scheduleSave : undefined}
      onBlur={commit}
      onKeyDown={
        editing
          ? (e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                if (saveTimer.current) {
                  clearTimeout(saveTimer.current);
                  saveTimer.current = null;
                }
                pending.current = null;
                if (ref.current) ref.current.innerText = value;
                setEditing(false);
              }
            }
          : undefined
      }
      style={{ height }}
      className={`w-full whitespace-pre-wrap px-3 py-2 leading-relaxed outline-none ${editing ? "overflow-auto ring-1 ring-primary" : "cursor-default overflow-hidden hover:bg-muted/40"}`}
    >
      {value}
    </div>
  );
}
