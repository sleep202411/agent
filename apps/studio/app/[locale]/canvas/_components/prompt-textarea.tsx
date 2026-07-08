"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MentionMenu,
  PromptMentionMirror,
  insertMentionText,
  mentionRange,
  removeMentionText,
  textareaMentionMenuPosition,
  type MentionItem,
} from "@/lib/prompt-mentions";
import { cn } from "@/lib/utils";

/**
 * IME-safe prompt textarea. The card's prompt lives in the Yjs doc, so a plain
 * controlled `value={data.prompt}` re-sets the field on every keystroke via the
 * async CRDT round-trip — which interrupts CJK (Chinese/Japanese/Korean) IME
 * composition, making those languages impossible to type. This binds the
 * textarea to LOCAL state instead: it commits to the doc on input when idle and
 * on composition end, never resets mid-composition, and reflects external
 * edits (collab / reset) only while unfocused so it can't clobber live typing.
 *
 * When `mentions` are supplied, typing `@` opens a picker of the attached
 * references and inserts a `@Image1`-style token (imagine.art-style targeting).
 * The picker is suppressed mid-composition so it never interferes with IME.
 */
export function PromptTextarea({
  value,
  onCommit,
  mentions,
  className,
  ...rest
}: {
  value: string;
  onCommit: (next: string) => void;
  mentions?: MentionItem[];
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  const [draft, setDraft] = useState(value);
  const composing = useRef(false);
  const focused = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const mentionsOn = !!mentions && mentions.length > 0;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties | undefined>();
  const [scrollTop, setScrollTop] = useState(0);

  // Reflect external changes (a peer's edit, a reset) only when the field is
  // idle — never while the user is typing or mid-composition.
  useEffect(() => {
    if (!composing.current && !focused.current) setDraft(value);
  }, [value]);

  const options = useMemo(() => {
    if (!open || !mentions) return [];
    const q = query.toLowerCase();
    return mentions.filter(
      (m) => !q || m.label.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q)
    );
  }, [open, query, mentions]);

  function refreshMention(text: string, caret: number) {
    if (!mentionsOn || composing.current) {
      setOpen(false);
      return;
    }
    const range = mentionRange(text, caret);
    setOpen(Boolean(range));
    setActive(0);
    setQuery(range?.query ?? "");
    if (range && ref.current && wrapperRef.current) {
      setMenuStyle(textareaMentionMenuPosition(ref.current, wrapperRef.current, range.start));
    } else {
      setMenuStyle(undefined);
    }
  }

  function insertMention(item: MentionItem) {
    const el = ref.current;
    const caret = el?.selectionStart ?? draft.length;
    const inserted = insertMentionText(draft, caret, item);
    if (!inserted) return;
    setDraft(inserted.value);
    onCommit(inserted.value);
    setOpen(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(inserted.caret, inserted.caret);
    });
  }

  function removeMention(range: { end: number; start: number }) {
    const el = ref.current;
    const removed = removeMentionText(draft, range);
    setDraft(removed.value);
    onCommit(removed.value);
    setOpen(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(removed.caret, removed.caret);
    });
  }

  return (
    <div ref={wrapperRef} className="nodrag nowheel relative">
      {mentionsOn && (
        <PromptMentionMirror
          value={draft}
          mentions={mentions ?? []}
          onRemoveMention={removeMention}
          scrollTop={scrollTop}
          className={className}
        />
      )}
      <textarea
        {...rest}
        ref={ref}
        value={draft}
        className={cn(
          className,
          "relative z-[1]",
          mentionsOn && draft && "text-transparent caret-white selection:bg-sky-500/35"
        )}
        onChange={(e) => {
          setDraft(e.target.value);
          if (!composing.current) onCommit(e.target.value);
          refreshMention(e.target.value, e.target.selectionStart ?? e.target.value.length);
        }}
        onSelect={(e) => refreshMention(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)}
        onKeyDown={(e) => {
          if (mentionsOn && open && options.length > 0) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive(
                (i) => (i + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length
              );
              return;
            }
            if (e.key === "Enter") {
              e.preventDefault();
              insertMention(options[active]);
              return;
            }
            if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
              return;
            }
          }
          rest.onKeyDown?.(e);
        }}
        onWheel={(e) => {
          e.stopPropagation();
          rest.onWheel?.(e);
        }}
        onScroll={(e) => {
          setScrollTop(e.currentTarget.scrollTop);
          if (open) {
            refreshMention(e.currentTarget.value, e.currentTarget.selectionStart ?? 0);
          }
          rest.onScroll?.(e);
        }}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(e) => {
          composing.current = false;
          setDraft(e.currentTarget.value);
          onCommit(e.currentTarget.value);
          refreshMention(
            e.currentTarget.value,
            e.currentTarget.selectionStart ?? e.currentTarget.value.length
          );
        }}
        onFocus={(e) => {
          focused.current = true;
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          focused.current = false;
          setDraft(value);
          // Delay so a mention pick (mousedown) lands before the menu closes.
          setTimeout(() => setOpen(false), 120);
          rest.onBlur?.(e);
        }}
      />
      {mentionsOn && open && (
        <MentionMenu
          options={options}
          active={active}
          onPick={insertMention}
          className="top-0 left-0"
          style={menuStyle}
        />
      )}
    </div>
  );
}
