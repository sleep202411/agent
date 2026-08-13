"use client";

import { useMemo, useRef, useState } from "react";
import { useProjectContext } from "@/app/[locale]/project/_components/project-context";
import {
  projectAssetToMentionItem,
  useProjectAssets,
} from "@/lib/canvas-authoring/use-project-assets";
import type { MentionItem } from "@/lib/prompt-mentions";
import { cn } from "@/lib/utils";
import { StoryboardPromptTextarea } from "./storyboard-prompt-textarea";

/**
 * A rich-text prompt cell (description / imagePrompt / videoPrompt) with
 * Excel-like behavior and inline @reference tags via StoryboardPromptTextarea
 * (storyboard-only — does not share canvas composer `@` behavior).
 *
 * Display mode: plain text (truncated). Click/Enter to edit.
 * `@` opens AssetSelectDialog over project inventory.
 */
export function ShotPromptCell({
  value,
  placeholder,
  ariaLabel,
  readOnly,
  onCommit,
  cellId,
  onNavigate,
}: {
  value: string | undefined;
  placeholder: string;
  ariaLabel: string;
  readOnly: boolean;
  onCommit: (next: string | undefined) => void;
  cellId?: string;
  onNavigate?: (direction: "next" | "prev" | "down" | "up") => void;
}) {
  const { owner } = useProjectContext();
  const crewProjectId = owner.kind === "platform_project" ? owner.projectId : "";
  const { assets } = useProjectAssets(crewProjectId);
  const mentions = useMemo<MentionItem[]>(
    () => assets.map((asset) => projectAssetToMentionItem(asset, assets)),
    [assets]
  );
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
        <StoryboardPromptTextarea
          value={value ?? ""}
          onCommit={(next) => onCommit(next || undefined)}
          mentions={mentions}
          projectId={crewProjectId}
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
        displayText
          ? "text-white/85"
          : "flex items-center justify-center text-white/25 focus:items-start focus:justify-start"
      )}
    >
      {displayText || <span className="focus:hidden">{placeholder}</span>}
    </div>
  );
}
