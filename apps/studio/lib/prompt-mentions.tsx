"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { IconMusic, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import {
  promptMentionParts,
  type PromptMentionItem,
  type PromptMentionKind,
} from "@/lib/prompt-document";

/**
 * `@`-mention support shared by the studio composer and the canvas generation
 * card: a reference can be cited in the prompt as `@Image1`, `@Video2`, … so a
 * phrase binds to a specific attached reference (imagine.art-style targeting).
 */
export type MentionItem = PromptMentionItem;

const LABEL_PREFIX: Record<PromptMentionKind, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
};

/** Per-kind mention label, e.g. mentionLabel("image", 1) → "Image1". */
export function mentionLabel(kind: PromptMentionKind, indexWithinKind: number): string {
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

const MEDIA_PREVIEW_WIDTH = 260;
const AUDIO_PREVIEW_WIDTH = 200;
const PREVIEW_GAP = 8;

export function mediaHoverPreviewPosition(
  rect: DOMRect,
  kind: PromptMentionKind = "image"
): CSSProperties {
  const previewWidth = kind === "audio" ? AUDIO_PREVIEW_WIDTH : MEDIA_PREVIEW_WIDTH;
  return {
    bottom: window.innerHeight - rect.top + PREVIEW_GAP,
    left: rect.left + rect.width / 2 - previewWidth / 2,
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
  const [isWaveformActive, setIsWaveformActive] = useState(true);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    let cancelled = false;
    void audio.play().catch(() => {
      if (!cancelled) setIsWaveformActive(false);
    });

    return () => {
      cancelled = true;
      audio.pause();
    };
  }, [item.previewUrl]);

  const bars = [8, 15, 11, 20, 14, 25, 17, 28, 18, 24, 13, 22, 15, 19, 10, 16];
  return (
    <div
      data-audio-preview
      data-waveform-active={isWaveformActive ? "true" : "false"}
      aria-hidden="true"
      style={style}
      className="pointer-events-none fixed z-[1000] w-[200px] overflow-hidden rounded-xl bg-[oklch(0.17_0_0_/_0.97)] p-2.5 shadow-[0_14px_36px_rgba(0,0,0,0.48)] backdrop-blur-xl"
    >
      <div
        data-audio-waveform
        aria-hidden="true"
        className="flex h-8 items-center justify-center gap-1.5"
      >
        {bars.map((height, index) => (
          <span
            key={`${height}-${index}`}
            className={cn(
              "w-[3px] rounded-full bg-violet-300/70",
              isWaveformActive && "prompt-audio-wave-bar"
            )}
            style={{
              animationDelay: `-${index * 70}ms`,
              animationDuration: `${620 + (index % 5) * 90}ms`,
              height,
              opacity: 0.42 + (index % 4) * 0.12,
            }}
          />
        ))}
      </div>
      <div className="mt-1.5 min-w-0">
        <div data-audio-meta className="mx-auto flex w-fit min-w-0 max-w-full items-center gap-1.5">
          <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-violet-300/10 text-violet-200/80">
            <IconMusic className="size-3" stroke={1.8} />
          </span>
          <span className="min-w-0 max-w-[148px] truncate text-center text-[11px] leading-4 font-medium text-white/75">
            {item.name ?? `@${item.label}`}
          </span>
        </div>
      </div>
      {item.previewUrl ? (
        <audio
          key={item.previewUrl}
          ref={audioRef}
          src={item.previewUrl}
          preload="auto"
          onPlay={() => setIsWaveformActive(true)}
          onPlaying={() => setIsWaveformActive(true)}
          onPause={() => setIsWaveformActive(false)}
          onWaiting={() => setIsWaveformActive(false)}
          onStalled={() => setIsWaveformActive(false)}
          onSeeking={() => setIsWaveformActive(false)}
          onEnded={() => setIsWaveformActive(false)}
          onAbort={() => setIsWaveformActive(false)}
          onEmptied={() => setIsWaveformActive(false)}
          onError={() => setIsWaveformActive(false)}
          className="hidden"
        />
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
        <AudioWaveformPreview
          key={item.previewUrl ?? `${item.label}:no-preview`}
          item={item}
          style={style}
        />
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

export function MentionChip({
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
    if (rect) setPreviewStyle(mediaHoverPreviewPosition(rect, mention.kind));
  };

  return (
    <span
      ref={ref}
      className="pointer-events-auto mr-0.5 inline-flex items-center gap-1 rounded-full bg-violet-500/25 py-[1px] pr-1.5 pl-1 align-baseline text-xs leading-5 font-normal text-violet-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),inset_0_-1px_0_rgba(76,29,149,0.34),0_0_0_1px_rgba(167,139,250,0.3)]"
      onPointerEnter={showPreview}
      onPointerMove={showPreview}
      onPointerLeave={() => setPreviewStyle(null)}
      onMouseEnter={showPreview}
      onMouseMove={showPreview}
      onMouseLeave={() => setPreviewStyle(null)}
    >
      <span className="inline-flex size-3 shrink-0 items-center justify-center overflow-hidden rounded-full bg-violet-200/20">
        {mention.kind === "audio" ? (
          <IconMusic className="size-2 text-violet-100" stroke={2} />
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
          className="-mr-0.5 ml-0.5 inline-flex size-3 shrink-0 items-center justify-center rounded-full text-violet-100/55 transition-colors hover:bg-violet-100/15 hover:text-violet-50"
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
          <IconX className="size-2" stroke={2.2} />
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
  const parts = promptMentionParts(value, mentions);
  return (
    <div
      aria-hidden
      className={cn(
        className,
        "pointer-events-none absolute inset-0 z-[2] overflow-hidden whitespace-pre-wrap break-words text-foreground"
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
