"use client";

import { useMemo, useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  MentionMenu,
  PromptMentionMirror,
  insertMentionText,
  mentionRange,
  removeMentionText,
  textareaMentionMenuPosition,
  type MentionItem,
} from "@/lib/prompt-mentions";
import { listStoryAssetSpecs, storyProductionKeys } from "@/lib/story-production-api";
import { cn } from "@/lib/utils";

/**
 * The chapter's Asset Specs as prompt mention items: `@{stableKey}` is the
 * production mention grammar ("引用即提示词"), so the token label IS the
 * stable key and the chip previews the spec's selected media when it exists.
 */
export function useStoryAssetMentions(
  workspaceId: string,
  projectId: string,
  chapterId: string
): MentionItem[] {
  const assetsQuery = useQuery({
    queryKey: storyProductionKeys.assets(workspaceId, projectId, chapterId),
    queryFn: ({ signal }) => listStoryAssetSpecs(workspaceId, projectId, chapterId, signal),
    enabled: Boolean(workspaceId && chapterId),
    retry: false,
  });
  return useMemo(
    () =>
      (assetsQuery.data ?? []).map((asset) => ({
        id: asset.id,
        label: asset.stableKey,
        name: asset.name,
        kind: "image" as const,
        previewUrl:
          asset.selectedMediaVersion?.thumbnailUrl ??
          asset.selectedMediaVersion?.previewUrl ??
          undefined,
      })),
    [assetsQuery.data]
  );
}

/** Both layers must render text identically for the chips to align. */
const PROMPT_TEXT_CLASS =
  "min-h-36 w-full resize-y rounded-md px-3 py-2 text-xs leading-5 focus-visible:outline-none";

/**
 * Prompt editor for the production detail dialogs — the composer's mention
 * treatment on a plain textarea: `@stableKey` tokens render as chips through
 * the mirror overlay, and typing `@` offers the chapter's Asset Specs.
 */
export function StoryPromptMentionField({
  id,
  value,
  onChange,
  disabled = false,
  mentions,
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  mentions: MentionItem[];
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>();
  const [query, setQuery] = useState("");

  const options = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return mentions
      .filter(
        (item) =>
          !needle ||
          item.label.toLowerCase().includes(needle) ||
          (item.name ?? "").toLowerCase().includes(needle)
      )
      .slice(0, 12);
  }, [mentions, query]);

  const updateMentionState = (nextValue: string, caret: number) => {
    const range = mentionRange(nextValue, caret);
    if (!range || mentions.length === 0) {
      setMenuOpen(false);
      return;
    }
    setQuery(range.query);
    if (textareaRef.current && containerRef.current) {
      setMenuStyle(
        textareaMentionMenuPosition(textareaRef.current, containerRef.current, range.start)
      );
    }
    setMenuOpen(true);
  };

  const insertMention = (item: MentionItem) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const caret = textarea.selectionStart ?? value.length;
    const result = insertMentionText(value, caret, item);
    if (!result) return;
    onChange(result.value);
    setMenuOpen(false);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(result.caret, result.caret);
    });
  };

  const removeMention = (range: { end: number; start: number }) => {
    onChange(removeMentionText(value, range).value);
  };

  return (
    <div ref={containerRef} className="relative">
      {mentions.length > 0 ? (
        <PromptMentionMirror
          value={value}
          mentions={mentions}
          onRemoveMention={disabled ? undefined : removeMention}
          scrollTop={scrollTop}
          className={PROMPT_TEXT_CLASS}
        />
      ) : null}
      <textarea
        id={id}
        ref={textareaRef}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.value);
          updateMentionState(
            event.target.value,
            event.target.selectionStart ?? event.target.value.length
          );
        }}
        onSelect={(event) =>
          updateMentionState(
            event.currentTarget.value,
            event.currentTarget.selectionStart ?? event.currentTarget.value.length
          )
        }
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        onBlur={() => setTimeout(() => setMenuOpen(false), 120)}
        className={cn(
          PROMPT_TEXT_CLASS,
          "relative z-[1] bg-white/[0.07] text-white/88 focus-visible:ring-2 focus-visible:ring-white/25 disabled:opacity-60",
          mentions.length > 0 && value && "text-transparent caret-white selection:bg-sky-500/35"
        )}
      />
      {menuOpen ? (
        <MentionMenu
          options={options}
          active={0}
          onPick={insertMention}
          className="top-0 left-0"
          style={menuStyle}
        />
      ) : null}
    </div>
  );
}
