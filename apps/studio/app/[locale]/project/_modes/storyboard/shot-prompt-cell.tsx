"use client";

import { useRef, useState } from "react";
import { PromptTextarea } from "@/components/canvas/authoring/prompt-textarea";
import type { MentionItem } from "@/lib/prompt-mentions";
import { cn } from "@/lib/utils";

/**
 * A rich-text prompt cell (description / imagePrompt / videoPrompt) with
 * Excel-like behavior and inline @reference tags via PromptTextarea.
 *
 * Display mode: plain text (truncated). Click/Enter to edit with the full
 * Tiptap editor — supports @mentions, IME, paste auto-binding.
 */
export function ShotPromptCell({
  value,
  placeholder,
  ariaLabel,
  readOnly,
  onCommit,
  cellId,
  onNavigate,
  mentions = EMPTY_MENTIONS,
}: {
  value: string | undefined;
  placeholder: string;
  ariaLabel: string;
  readOnly: boolean;
  onCommit: (next: string | undefined) => void;
  cellId?: string;
  onNavigate?: (direction: "next" | "prev" | "down" | "up") => void;
  /** Reference items for @mention autocomplete. */
  mentions?: readonly MentionItem[];
}) {
  const [isEditing, setIsEditing] = useState(false);
  const editRef = useRef<HTMLDivElement>(null);

  if (readOnly) {
    return (
      <div className="w-full px-1.5 py-1 text-xs/relaxed whitespace-pre-wrap text-white/75">
        {value || <span className="text-white/25">—</span>}
      </div>
    );
  }

  if (isEditing) {
    return (
      <div
        ref={editRef}
        className="h-full w-full"
        onKeyDownCapture={(e) => {
          if (!onNavigate) return;
          if (e.key === "Tab") {
            e.preventDefault();
            onNavigate(e.shiftKey ? "prev" : "next");
          } else if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onNavigate("down");
          } else if (e.key === "Escape") {
            e.preventDefault();
            setIsEditing(false);
            (e.target as HTMLElement).blur();
          }
        }}
      >
        <PromptTextarea
          value={value ?? ""}
          onCommit={(next) => onCommit(next || undefined)}
          mentions={mentions}
          aria-label={ariaLabel}
          rows={2}
          autoFocus
          onBlur={() => setIsEditing(false)}
        />
      </div>
    );
  }

  // Display mode — plain text, click to edit.
  const displayText = value?.trim() || "";

  return (
    <div
      id={cellId}
      role="button"
      tabIndex={0}
      onClick={() => setIsEditing(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "F2" || e.key.length === 1) {
          e.preventDefault();
          setIsEditing(true);
        } else if (e.key === "Tab" && onNavigate) {
          e.preventDefault();
          onNavigate(e.shiftKey ? "prev" : "next");
        }
      }}
      className={cn(
        "h-full min-h-[1.75rem] w-full cursor-text px-1.5 py-1 text-xs/relaxed transition-colors hover:bg-white/[0.05] focus:bg-white/[0.06] focus:outline-none focus:ring-1 focus:ring-white/15 overflow-hidden",
        displayText ? "text-white/85" : "flex items-center justify-center text-white/25 focus:items-start focus:justify-start",
      )}
    >
      {displayText || <span className="focus:hidden">{placeholder}</span>}
    </div>
  );
}

const EMPTY_MENTIONS: readonly MentionItem[] = [];
