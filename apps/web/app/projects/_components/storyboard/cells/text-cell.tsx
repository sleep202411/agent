"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface TextCellProps {
  value: string;
  height: number;
  onSave?: (value: string) => void;
}

export function TextCell({ value, height, onSave }: TextCellProps) {
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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

  const commit = useCallback(() => {
    if (!ref.current) return;
    const newValue = ref.current.innerText.trim();
    setEditing(false);
    if (newValue !== value) onSave?.(newValue);
  }, [value, onSave]);

  return (
    <div
      ref={ref}
      contentEditable={editing}
      suppressContentEditableWarning
      onDoubleClick={() => setEditing(true)}
      onBlur={commit}
      onKeyDown={
        editing
          ? (e) => {
              if (e.key === "Escape") {
                e.preventDefault();
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
