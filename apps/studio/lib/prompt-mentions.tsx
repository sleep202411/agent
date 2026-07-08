"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { IconMusic, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { FizzAiReferenceKind } from "@/app/[locale]/canvas/_lib/generation-api";

/**
 * `@`-mention support shared by the studio composer and the canvas generation
 * card: a reference can be cited in the prompt as `@Image1`, `@Video2`, … so a
 * phrase binds to a specific attached reference (imagine.art-style targeting).
 */
export type MentionItem = {
  id: string;
  /** Token shown after the `@`, e.g. "Image1". */
  label: string;
  name?: string;
  kind: FizzAiReferenceKind;
  previewUrl?: string;
};

const LABEL_PREFIX: Record<FizzAiReferenceKind, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
};

/** Per-kind mention label, e.g. mentionLabel("image", 1) → "Image1". */
export function mentionLabel(kind: FizzAiReferenceKind, indexWithinKind: number): string {
  return `${LABEL_PREFIX[kind]}${indexWithinKind}`;
}

/**
 * Detect an active `@query` immediately left of the caret. Returns the `@`
 * offset and the typed query, or null when the caret isn't in a mention.
 * Users often type Chinese prompts without spaces around references, so the
 * trigger intentionally does not require whitespace before `@`.
 */
export function mentionRange(
  value: string,
  caret: number
): { start: number; query: string } | null {
  const at = value.lastIndexOf("@", caret - 1);
  if (at === -1) return null;
  const query = value.slice(at + 1, caret);
  if (query.length > 32 || /[\s@,.;:!?，。！？、；：)\]）'"”]/.test(query)) return null;
  return { start: at, query };
}

export function insertMentionText(
  value: string,
  caret: number,
  item: Pick<MentionItem, "label">
): { caret: number; value: string } | null {
  const range = mentionRange(value, caret);
  if (!range) return null;
  const before = value.slice(0, range.start);
  const after = value.slice(caret).replace(/^[ \t]+/, "");
  const needsSeparator = after.length === 0 || !/^[\n,.;:!?，。！？、；：)\]）'"”]/.test(after);
  const separator = needsSeparator ? " " : "";
  const next = `${before}@${item.label}${separator}${after}`;
  return {
    value: next,
    caret: before.length + item.label.length + 1 + separator.length,
  };
}

function isMentionTokenEnd(value: string, end: number): boolean {
  if (end >= value.length) return true;
  return !/^[A-Za-z0-9_]/.test(value[end] ?? "");
}

function mentionAt(
  value: string,
  offset: number,
  mentions: readonly MentionItem[]
): MentionItem | undefined {
  if (value[offset] !== "@") return undefined;
  return [...mentions]
    .sort((a, b) => b.label.length - a.label.length)
    .find((mention) => {
      const token = `@${mention.label}`;
      const end = offset + token.length;
      return value.startsWith(token, offset) && isMentionTokenEnd(value, end);
    });
}

function mentionMirrorParts(value: string, mentions: readonly MentionItem[]) {
  const parts: Array<{ end: number; mention?: MentionItem; start: number; text: string }> = [];
  let offset = 0;
  while (offset < value.length) {
    const mention = mentionAt(value, offset, mentions);
    if (mention) {
      const end = offset + mention.label.length + 1;
      parts.push({ end, mention, start: offset, text: `@${mention.label}` });
      offset = end;
      continue;
    }
    const nextMentionOffset = value.indexOf("@", offset + 1);
    const end = nextMentionOffset === -1 ? value.length : nextMentionOffset;
    parts.push({ end, start: offset, text: value.slice(offset, end) });
    offset = end;
  }
  return parts;
}

export function removeMentionText(
  value: string,
  range: { end: number; start: number }
): { caret: number; value: string } {
  let start = range.start;
  let end = range.end;
  if (value[end] === " ") {
    end += 1;
  } else if (start > 0 && value[start - 1] === " ") {
    start -= 1;
  }
  return {
    caret: start,
    value: `${value.slice(0, start)}${value.slice(end)}`,
  };
}

const PREVIEW_WIDTH = 260;
const PREVIEW_GAP = 10;

export function mediaHoverPreviewPosition(rect: DOMRect): CSSProperties {
  return {
    bottom: window.innerHeight - rect.top + PREVIEW_GAP,
    left: rect.left + rect.width / 2 - PREVIEW_WIDTH / 2,
  };
}

function AudioWaveformPreview({
  item,
  style,
}: {
  item: Pick<MentionItem, "label" | "name" | "previewUrl">;
  style: CSSProperties;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    void audioRef.current?.play().catch(() => undefined);
  }, []);

  const bars = [18, 34, 24, 48, 31, 58, 38, 72, 44, 62, 28, 52, 35, 46, 22, 40];
  return (
    <div
      style={style}
      className="pointer-events-none fixed z-[1000] flex h-28 w-[260px] flex-col justify-center overflow-hidden rounded-2xl bg-[oklch(0.18_0_0_/_0.96)] px-5 shadow-2xl shadow-black/70 backdrop-blur-2xl"
    >
      <div className="flex h-14 items-center gap-1.5">
        {bars.map((height, index) => (
          <span
            key={`${height}-${index}`}
            className="w-1.5 animate-pulse rounded-full bg-violet-300/80"
            style={{
              height,
              opacity: 0.45 + (index % 4) * 0.13,
              animationDelay: `${index * 55}ms`,
            }}
          />
        ))}
      </div>
      <div className="mt-2 truncate text-xs font-medium text-violet-100">
        {item.name ?? `@${item.label}`}
      </div>
      {item.previewUrl ? (
        <audio ref={audioRef} src={item.previewUrl} autoPlay className="hidden" />
      ) : null}
    </div>
  );
}

function HoverPreviewPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

export function ReferenceMediaHoverPreview({
  item,
  style,
}: {
  item: Pick<MentionItem, "kind" | "label" | "name" | "previewUrl">;
  style: CSSProperties;
}) {
  if (item.kind === "audio") {
    return (
      <HoverPreviewPortal>
        <AudioWaveformPreview item={item} style={style} />
      </HoverPreviewPortal>
    );
  }
  if (!item.previewUrl) return null;

  return (
    <HoverPreviewPortal>
      <div
        style={style}
        className="pointer-events-none fixed z-[1000] w-[260px] overflow-hidden rounded-2xl shadow-2xl shadow-black/70"
      >
        {item.kind === "video" ? (
          <video
            src={item.previewUrl}
            muted
            playsInline
            loop
            autoPlay
            className="block max-h-[260px] w-full object-contain"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.previewUrl}
            alt={item.name ?? item.label}
            className="block max-h-[260px] w-full object-contain"
          />
        )}
      </div>
    </HoverPreviewPortal>
  );
}

function MentionChip({
  mention,
  onRemove,
  text,
}: {
  mention: MentionItem;
  onRemove?: () => void;
  text: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [previewStyle, setPreviewStyle] = useState<CSSProperties | null>(null);
  const displayText = text.startsWith("@") ? text.slice(1) : text;

  const showPreview = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setPreviewStyle(mediaHoverPreviewPosition(rect));
  };

  return (
    <span
      ref={ref}
      className="pointer-events-auto mr-0.5 inline-flex items-center gap-1 rounded-full bg-violet-500/25 py-[1px] pr-1.5 pl-1 align-baseline font-normal text-violet-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(76,29,149,0.34),0_0_0_1px_rgba(167,139,250,0.3)]"
      onPointerEnter={showPreview}
      onPointerMove={showPreview}
      onPointerLeave={() => setPreviewStyle(null)}
      onMouseEnter={showPreview}
      onMouseMove={showPreview}
      onMouseLeave={() => setPreviewStyle(null)}
    >
      <span className="inline-flex size-3.5 shrink-0 items-center justify-center overflow-hidden rounded-full bg-violet-200/20">
        {mention.kind === "audio" ? (
          <IconMusic className="size-2.5 text-violet-100" stroke={2} />
        ) : mention.kind === "video" ? (
          <video src={mention.previewUrl} muted playsInline className="size-full object-cover" />
        ) : mention.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mention.previewUrl} alt="" className="size-full object-cover" />
        ) : null}
      </span>
      {displayText}
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${displayText}`}
          className="-mr-0.5 ml-0.5 inline-flex size-3.5 shrink-0 items-center justify-center rounded-full text-violet-100/55 transition-colors hover:bg-violet-100/15 hover:text-violet-50"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setPreviewStyle(null);
            onRemove();
          }}
        >
          <IconX className="size-2.5" stroke={2.2} />
        </button>
      ) : null}
      {previewStyle ? <ReferenceMediaHoverPreview item={mention} style={previewStyle} /> : null}
    </span>
  );
}

export function PromptMentionMirror({
  className,
  mentions,
  onRemoveMention,
  scrollTop = 0,
  value,
}: {
  className?: string;
  mentions: readonly MentionItem[];
  onRemoveMention?: (range: { end: number; start: number }) => void;
  scrollTop?: number;
  value: string;
}) {
  if (!value) return null;
  const parts = mentionMirrorParts(value, mentions);
  return (
    <div
      aria-hidden
      className={cn(
        className,
        "pointer-events-none absolute inset-0 z-[2] overflow-visible whitespace-pre-wrap break-words text-foreground"
      )}
    >
      <div style={{ transform: `translateY(-${scrollTop}px)` }}>
        {parts.map((part, index) =>
          part.mention ? (
            <MentionChip
              key={`${part.text}-${index}`}
              mention={part.mention}
              onRemove={
                onRemoveMention
                  ? () => onRemoveMention({ end: part.end, start: part.start })
                  : undefined
              }
              text={part.text}
            />
          ) : (
            <span key={`${part.text}-${index}`}>{part.text}</span>
          )
        )}
      </div>
    </div>
  );
}

const MENTION_MENU_WIDTH = 256;

const TEXTAREA_MIRROR_PROPERTIES = [
  "border-bottom-width",
  "border-left-width",
  "border-right-width",
  "border-top-width",
  "box-sizing",
  "font-family",
  "font-size",
  "font-stretch",
  "font-style",
  "font-variant",
  "font-weight",
  "letter-spacing",
  "line-height",
  "padding-bottom",
  "padding-left",
  "padding-right",
  "padding-top",
  "tab-size",
  "text-align",
  "text-indent",
  "text-transform",
  "white-space",
  "word-spacing",
] as const;

/**
 * Compute an absolute menu position inside `container`, matching where a text
 * offset renders in a wrapping textarea. Used to anchor the mention picker to
 * the active `@xxx` token instead of the textarea's fixed bottom-left corner.
 */
export function textareaMentionMenuPosition(
  textarea: HTMLTextAreaElement,
  container: HTMLElement,
  textOffset: number
): CSSProperties {
  const style = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");

  for (const property of TEXTAREA_MIRROR_PROPERTIES) {
    mirror.style.setProperty(property, style.getPropertyValue(property));
  }
  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.top = "0";
  mirror.style.left = "-9999px";
  mirror.style.width = `${textarea.offsetWidth}px`;
  mirror.style.height = "auto";
  mirror.style.minHeight = "0";
  mirror.style.overflow = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflowWrap = "break-word";
  mirror.style.wordBreak = style.wordBreak || "normal";

  mirror.appendChild(document.createTextNode(textarea.value.slice(0, textOffset)));
  const marker = document.createElement("span");
  marker.textContent = "\u200b";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const markerRect = marker.getBoundingClientRect();
  const mirrorRect = mirror.getBoundingClientRect();
  const textareaRect = textarea.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const parsedLineHeight = Number.parseFloat(style.lineHeight);
  const parsedFontSize = Number.parseFloat(style.fontSize);
  const lineHeight = Number.isFinite(parsedLineHeight)
    ? parsedLineHeight
    : (Number.isFinite(parsedFontSize) ? parsedFontSize : 14) * 1.4;

  const rawLeft =
    textareaRect.left -
    containerRect.left +
    markerRect.left -
    mirrorRect.left -
    textarea.scrollLeft;
  const rawTop =
    textareaRect.top -
    containerRect.top +
    markerRect.top -
    mirrorRect.top -
    textarea.scrollTop +
    lineHeight +
    6;

  document.body.removeChild(mirror);

  const maxLeft = Math.max(0, container.clientWidth - MENTION_MENU_WIDTH);
  return {
    left: Math.min(Math.max(0, rawLeft), maxLeft),
    top: Math.max(0, rawTop),
  };
}

/** Dropdown of mentionable references. Caller positions it via `className`. */
export function MentionMenu({
  options,
  active,
  onPick,
  className,
  style,
}: {
  options: MentionItem[];
  active: number;
  onPick: (item: MentionItem) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const t = useTranslations("generation");
  return (
    <div
      data-popover-zone
      style={style}
      className={cn(
        "absolute z-50 w-64 rounded-2xl bg-[oklch(0.24_0_0)] p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl duration-150 animate-in fade-in-0 zoom-in-95",
        className
      )}
    >
      {options.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">{t("uploadReferenceFirst")}</p>
      ) : (
        options.map((item, index) => (
          <button
            key={item.id}
            type="button"
            // Mousedown so the pick wins over the textarea blur.
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(item);
            }}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-xl px-2 py-1.5 text-left transition-colors",
              index === active ? "bg-white/[0.08]" : "hover:bg-white/[0.06]"
            )}
          >
            <span className="size-8 shrink-0 overflow-hidden rounded-md bg-muted">
              {item.kind === "audio" ? (
                <span className="flex size-full items-center justify-center">
                  <IconMusic className="size-3.5 text-white/70" stroke={1.7} />
                </span>
              ) : item.kind === "video" ? (
                <video src={item.previewUrl} muted playsInline className="size-full object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.previewUrl} alt={item.label} className="size-full object-cover" />
              )}
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-semibold">@{item.label}</span>
              {item.name ? (
                <span className="block truncate text-[11px] text-muted-foreground">
                  {item.name}
                </span>
              ) : null}
            </span>
          </button>
        ))
      )}
    </div>
  );
}
