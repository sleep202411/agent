"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useTextDraft } from "@/lib/use-text-draft";
import { cn } from "@/lib/utils";

/**
 * Seconds — stored as a number. The ENTIRE cell is the editable surface.
 * Display as plain text, click/Enter to edit, Tab/Enter/Esc navigate.
 */
export function ShotDurationCell({
  value,
  ariaLabel,
  readOnly,
  onCommit,
  cellId,
  onNavigate,
}: {
  value: number | undefined;
  ariaLabel: string;
  readOnly: boolean;
  onCommit: (next: number | undefined) => void;
  cellId?: string;
  onNavigate?: (direction: "next" | "prev" | "down" | "up") => void;
}) {
  const t = useTranslations("storyboard");
  const [isEditing, setIsEditing] = useState(false);
  const draft = useTextDraft(value == null ? "" : String(value), (next) => {
    const parsed = Number.parseFloat(next.replace(",", "."));
    onCommit(Number.isFinite(parsed) && parsed > 0 ? parsed : undefined);
  });
  const editRef = useRef<HTMLInputElement>(null);
  const typedEntry = useRef(false);

  useEffect(() => {
    if (isEditing && editRef.current) {
      editRef.current.focus();
      if (typedEntry.current) {
        const end = editRef.current.value.length;
        editRef.current.setSelectionRange(end, end);
      } else {
        editRef.current.select();
      }
      typedEntry.current = false;
    }
  }, [isEditing]);

  const displayText = value == null ? "—" : `${value}${t("cell.durationUnit")}`;

  if (readOnly) {
    return (
      <div className="w-full px-1.5 py-1 text-xs/relaxed tabular-nums text-white/75">
        {displayText}
      </div>
    );
  }

  if (isEditing) {
    return (
      <div className="flex h-full w-full items-center gap-0.5 px-1.5 py-1">
        <input
          ref={editRef}
          id={cellId}
          value={draft.value}
          onChange={(e) => draft.onChange(e.target.value)}
          onBlur={() => {
            draft.flush();
            setIsEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing || !onNavigate) return;
            if (e.key === "Tab") {
              e.preventDefault();
              draft.flush();
              setIsEditing(false);
              onNavigate(e.shiftKey ? "prev" : "next");
            } else if (e.key === "Enter") {
              e.preventDefault();
              draft.flush();
              setIsEditing(false);
              onNavigate("down");
            } else if (e.key === "Escape") {
              e.preventDefault();
              draft.onChange(value == null ? "" : String(value));
              setIsEditing(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
          inputMode="decimal"
          placeholder="—"
          aria-label={ariaLabel}
          className="w-full bg-transparent text-xs/relaxed tabular-nums text-white/95 outline-none placeholder:text-white/25"
        />
      </div>
    );
  }

  return (
    <div
      id={cellId}
      role="button"
      tabIndex={0}
      onClick={() => setIsEditing(true)}
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key === "Enter" || e.key === "F2" || e.key.length === 1) {
          e.preventDefault();
          if (e.key.length === 1) {
            typedEntry.current = true;
            draft.onChange(e.key);
          }
          setIsEditing(true);
        } else if (e.key === "Tab" && onNavigate) {
          e.preventDefault();
          onNavigate(e.shiftKey ? "prev" : "next");
        }
      }}
      className={cn(
        "h-full min-h-[1.75rem] w-full cursor-text px-1.5 py-1 text-xs/relaxed tabular-nums transition-colors",
        "text-white/85 hover:bg-white/[0.05] focus:bg-white/[0.06] focus:outline-none focus:ring-1 focus:ring-white/15",
        value == null && "text-white/25"
      )}
    >
      {displayText === "—" ? <span className="focus:hidden">{displayText}</span> : displayText}
    </div>
  );
}
