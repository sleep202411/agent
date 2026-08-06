"use client";

import { useEffect, useRef, useState } from "react";
import { useTextDraft } from "@/lib/use-text-draft";
import { cn } from "@/lib/utils";

/**
 * A text cell (dialogue / notes) with Excel-like behavior.
 *
 * The ENTIRE cell area is the editable surface — no narrow input tucked in a
 * corner. Display mode shows plain text; click/Enter switches to a textarea
 * that fills the whole cell. Tab/Enter navigate; Esc reverts.
 */
export function ShotTextCell({
  value,
  placeholder,
  ariaLabel,
  readOnly,
  onCommit,
  cellId,
  onNavigate,
}: {
  value: string;
  placeholder: string;
  ariaLabel: string;
  readOnly: boolean;
  onCommit: (next: string) => void;
  cellId?: string;
  onNavigate?: (direction: "next" | "prev" | "down" | "up") => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const draft = useTextDraft(value, onCommit);
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isEditing && editRef.current) {
      editRef.current.focus();
    }
  }, [isEditing]);

  if (readOnly) {
    return (
      <div className="w-full px-1.5 py-1 text-xs/relaxed whitespace-pre-wrap text-white/75">
        {value || <span className="text-white/25">—</span>}
      </div>
    );
  }

  if (isEditing) {
    return (
      <textarea
        ref={editRef}
        id={cellId}
        value={draft.value}
        onChange={(e) => draft.onChange(e.target.value)}
        onBlur={() => {
          draft.flush();
          setIsEditing(false);
        }}
        onKeyDown={(e) => {
          if (!onNavigate) return;
          if (e.key === "Tab") {
            e.preventDefault();
            draft.flush();
            setIsEditing(false);
            onNavigate(e.shiftKey ? "prev" : "next");
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            draft.flush();
            setIsEditing(false);
            onNavigate("down");
          } else if (e.key === "Escape") {
            e.preventDefault();
            draft.onChange(value);
            setIsEditing(false);
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        rows={1}
        className="block h-full w-full resize-none bg-transparent px-1.5 py-1 text-xs/relaxed text-white/95 outline-none placeholder:text-white/25"
      />
    );
  }

  return (
    <div
      id={cellId}
      role="button"
      tabIndex={0}
      onClick={() => setIsEditing(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "F2" || e.key.length === 1) {
          e.preventDefault();
          if (e.key.length === 1) draft.onChange("");
          setIsEditing(true);
        } else if (e.key === "Tab" && onNavigate) {
          e.preventDefault();
          onNavigate(e.shiftKey ? "prev" : "next");
        }
      }}
      className={cn(
        "flex h-full min-h-[1.75rem] w-full cursor-text items-center px-1.5 py-1 text-xs/relaxed transition-colors hover:bg-white/[0.05] focus:bg-white/[0.06] focus:outline-none focus:ring-1 focus:ring-white/15 overflow-hidden",
        value ? "justify-start text-left text-white/85" : "justify-center text-center text-white/25"
      )}
    >
      {value || <span className="focus:hidden">{placeholder}</span>}
    </div>
  );
}
