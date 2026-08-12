"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import {
  IconCheck,
  IconChevronRight,
  IconClock,
  IconDimensions,
  IconExternalLink,
  IconFile,
  IconLoader2,
  IconMusic,
  IconPuzzle,
  IconSearch,
  IconX,
} from "@tabler/icons-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MediaAssetReadinessChipForAsset } from "@/components/canvas/authoring/media-asset-readiness";
import { cn } from "@/lib/utils";
import {
  promptMentionParts,
  promptMentionPrefix,
  promptMentionToken,
  type PromptMentionItem,
  type PromptMentionKind,
} from "@/lib/prompt-document";

/**
 * Inline prompt entities shared by studio generation surfaces. `@` cites an
 * attached media reference; `/` invokes a project Skill.
 */
export type MentionItem = PromptMentionItem;

export interface SkillMarketItem extends MentionItem {
  kind: "skill";
  catalogId: string;
  installed: boolean;
}

const LABEL_PREFIX: Record<PromptMentionKind, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
  skill: "Skill",
};

/** Per-kind mention label, e.g. mentionLabel("image", 1) → "Image1". */
export function mentionLabel(kind: PromptMentionKind, indexWithinKind: number): string {
  return `${LABEL_PREFIX[kind]}${indexWithinKind}`;
}

/**
 * Detect an active trigger query immediately left of the caret. Returns the
 * trigger offset and the typed query, or null when the caret isn't in a mention.
 * Users often type Chinese prompts without spaces around references, so the
 * trigger intentionally does not require whitespace before `@`.
 */
export function mentionRange(
  value: string,
  caret: number,
  trigger: "@" | "/" = "@"
): { start: number; query: string } | null {
  const start = value.lastIndexOf(trigger, caret - 1);
  if (start === -1) return null;
  const query = value.slice(start + trigger.length, caret);
  if (query.length > 32 || /[\s@/,.;:!?，。！？、；：)\]）'"”]/.test(query)) return null;
  return { start, query };
}

export function insertMentionText(
  value: string,
  caret: number,
  item: Pick<MentionItem, "kind" | "label">
): { caret: number; value: string } | null {
  const trigger = promptMentionPrefix(item.kind);
  const range = mentionRange(value, caret, trigger);
  if (!range) return null;
  const before = value.slice(0, range.start);
  const after = value.slice(caret).replace(/^[ \t]+/, "");
  const needsSeparator = after.length === 0 || !/^[\n,.;:!?，。！？、；：)\]）'"”]/.test(after);
  const separator = needsSeparator ? " " : "";
  const token = promptMentionToken(item);
  const next = `${before}${token}${separator}${after}`;
  return {
    value: next,
    caret: before.length + token.length + separator.length,
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

const MEDIA_PREVIEW_WIDTH = 288;
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

export function formatMediaPreviewDuration(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return null;
  const rounded = Math.round(seconds);
  if (rounded < 60) return `${rounded}s`;
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

export function formatMediaPreviewBytes(bytes: number | null | undefined): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

function ReferencePreviewMetadata({
  item,
}: {
  item: Pick<
    MentionItem,
    "assetId" | "bytes" | "durationSeconds" | "height" | "kind" | "label" | "name" | "width"
  >;
}) {
  const t = useTranslations("canvasNodes.reference");
  const duration = formatMediaPreviewDuration(item.durationSeconds);
  const fileSize = formatMediaPreviewBytes(item.bytes);
  const dimensions =
    typeof item.width === "number" &&
    item.width > 0 &&
    typeof item.height === "number" &&
    item.height > 0
      ? `${Math.round(item.width)}×${Math.round(item.height)}`
      : null;
  const hasSeedanceReadiness =
    Boolean(item.assetId) && (item.kind === "image" || item.kind === "video");

  return (
    <div
      data-reference-preview-metadata
      className="border-t border-white/[0.07] bg-[oklch(0.18_0_0_/_0.98)] px-3 py-2.5"
    >
      <div className="truncate text-xs font-medium text-white/85">{item.name ?? item.label}</div>
      {hasSeedanceReadiness || duration || dimensions || fileSize ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {hasSeedanceReadiness ? (
            <MediaAssetReadinessChipForAsset
              mediaAssetId={item.assetId}
              capability="seedance-aigc-reference"
              className="static shrink-0"
            />
          ) : null}
          {duration ? (
            <span
              title={`${t("duration")} · ${duration}`}
              className="inline-flex h-5 items-center gap-1 rounded-full bg-white/[0.07] px-1.5 text-[9px] font-medium text-white/65"
            >
              <IconClock className="size-2.5" stroke={1.8} />
              {duration}
            </span>
          ) : null}
          {dimensions ? (
            <span
              title={`${t("dimensions")} · ${dimensions}`}
              className="inline-flex h-5 items-center gap-1 rounded-full bg-white/[0.07] px-1.5 text-[9px] font-medium text-white/65"
            >
              <IconDimensions className="size-2.5" stroke={1.8} />
              {dimensions}
            </span>
          ) : null}
          {fileSize ? (
            <span
              title={`${t("fileSize")} · ${fileSize}`}
              className="inline-flex h-5 items-center gap-1 rounded-full bg-white/[0.07] px-1.5 text-[9px] font-medium text-white/65"
            >
              <IconFile className="size-2.5" stroke={1.8} />
              {fileSize}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
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
              "bg-brand-blue/70 w-[3px] rounded-full",
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
          <span className="bg-brand-blue/10 text-brand-blue/80 inline-flex size-5 shrink-0 items-center justify-center rounded-md">
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
  item: Pick<
    MentionItem,
    | "assetId"
    | "bytes"
    | "durationSeconds"
    | "height"
    | "kind"
    | "label"
    | "name"
    | "previewUrl"
    | "width"
  >;
  style: CSSProperties;
}) {
  if (item.kind === "skill") return null;
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
        className="pointer-events-none fixed z-[1000] w-72 overflow-hidden rounded-2xl bg-[oklch(0.18_0_0_/_0.98)] shadow-2xl shadow-black/70 ring-1 ring-white/[0.08]"
      >
        <div className="flex min-h-32 items-center justify-center bg-black/35">
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
        <ReferencePreviewMetadata item={item} />
      </div>
    </HoverPreviewPortal>
  );
}

export function MentionChip({
  mention,
  onActivate,
  onRemove,
  text,
}: {
  mention: MentionItem;
  onActivate?: () => void;
  onRemove?: () => void;
  text: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [previewStyle, setPreviewStyle] = useState<CSSProperties | null>(null);
  const displayText = /^[@/]/.test(text) ? text.slice(1) : text;
  const isSkill = mention.kind === "skill";

  const showPreview = () => {
    if (mention.kind === "skill") return;
    const rect = ref.current?.getBoundingClientRect();
    if (rect) setPreviewStyle(mediaHoverPreviewPosition(rect, mention.kind));
  };

  const mentionBody = (
    <>
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center overflow-hidden",
          isSkill ? "size-3.5 rounded-[3px] bg-transparent" : "size-3 rounded-full bg-white/14"
        )}
      >
        {isSkill ? (
          <IconPuzzle className="text-brand-yellow size-3" stroke={1.8} />
        ) : mention.kind === "audio" ? (
          <IconMusic className="size-2 text-white/78" stroke={2} />
        ) : mention.kind === "video" ? (
          <video src={mention.previewUrl} muted playsInline className="size-full object-cover" />
        ) : mention.previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={mention.previewUrl} alt="" className="size-full object-cover" />
        ) : null}
      </span>
      {displayText}
    </>
  );

  return (
    <span
      ref={ref}
      data-mention-kind={mention.kind}
      className={cn(
        "pointer-events-auto mr-0.5 inline-flex items-center gap-1 py-[1px] pr-1.5 pl-1 align-baseline text-xs leading-5",
        isSkill
          ? "group/skill text-brand-yellow/85 ring-brand-yellow/30 hover:bg-brand-yellow/[0.055] hover:text-brand-yellow hover:ring-brand-yellow/50 rounded-md bg-transparent font-medium ring-1 ring-inset transition-colors"
          : "rounded-full bg-white/[0.085] font-normal text-white/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_-1px_0_rgba(0,0,0,0.18),0_0_0_1px_rgba(255,255,255,0.16)] transition-colors hover:bg-white/[0.12] hover:text-white"
      )}
      onPointerEnter={showPreview}
      onPointerMove={showPreview}
      onPointerLeave={() => setPreviewStyle(null)}
      onMouseEnter={showPreview}
      onMouseMove={showPreview}
      onMouseLeave={() => setPreviewStyle(null)}
    >
      {onActivate ? (
        <button
          type="button"
          aria-label={mention.name ?? displayText}
          className={cn(
            "-my-[1px] -ml-1 inline-flex items-center gap-1 py-[1px] pl-1 outline-none focus-visible:ring-2",
            isSkill
              ? "rounded-[5px] hover:bg-transparent focus-visible:ring-white/25"
              : "rounded-full hover:bg-white/[0.06] focus-visible:ring-white/35"
          )}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onActivate}
        >
          {mentionBody}
        </button>
      ) : (
        mentionBody
      )}
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${displayText}`}
          className={cn(
            "-mr-0.5 ml-0.5 inline-flex size-3 shrink-0 items-center justify-center rounded-full transition-colors",
            isSkill
              ? "text-brand-yellow/35 hover:bg-brand-yellow/10 hover:text-brand-yellow/80 opacity-60 group-hover/skill:opacity-100"
              : "text-white/38 hover:bg-white/10 hover:text-white/78"
          )}
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

/** Dropdown of mentionable references and project Skills. */
function MentionMenuThumbnail({ active, item }: { active: boolean; item: MentionItem }) {
  if (item.kind === "skill") {
    if (active && item.previewVideoUrl) {
      return (
        <video
          src={item.previewVideoUrl}
          poster={item.previewUrl}
          muted
          playsInline
          loop
          autoPlay
          preload="metadata"
          className="size-full object-cover"
        />
      );
    }
    if (item.previewUrl) {
      return (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.previewUrl} alt="" className="size-full object-cover" />
      );
    }
    return (
      <span className="flex size-full items-center justify-center bg-white/[0.06]">
        <IconPuzzle className="text-brand-yellow size-4" stroke={1.8} />
      </span>
    );
  }
  if (item.kind === "audio") {
    return (
      <span className="flex size-full items-center justify-center">
        <IconMusic className="size-3.5 text-white/70" stroke={1.7} />
      </span>
    );
  }
  if (item.kind === "video") {
    return <video src={item.previewUrl} muted playsInline className="size-full object-cover" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={item.previewUrl} alt="" className="size-full object-cover" />
  );
}

export function MentionMenu({
  options,
  active,
  onPick,
  onShowAll,
  totalCount = options.length,
  emptyKind = "reference",
  className,
  style,
}: {
  options: MentionItem[];
  active: number;
  onPick: (item: MentionItem) => void;
  onShowAll?: () => void;
  totalCount?: number;
  emptyKind?: "reference" | "skill";
  className?: string;
  style?: CSSProperties;
}) {
  const t = useTranslations("generation");
  const visibleOptions = emptyKind === "skill" ? options.slice(0, 8) : options;
  const resolvedTotalCount = Math.max(totalCount, options.length);
  return (
    <div
      data-popover-zone
      style={style}
      className={cn(
        "absolute z-50 max-h-[min(32rem,calc(100dvh-1rem))] overflow-y-auto rounded-2xl bg-[oklch(0.18_0_0_/_0.98)] p-1.5 shadow-2xl shadow-black/65 backdrop-blur-xl duration-150 animate-in fade-in-0 zoom-in-95 motion-reduce:animate-none",
        emptyKind === "skill" ? "w-72" : "w-64",
        className
      )}
    >
      {options.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          {emptyKind === "skill" ? t("noSkillMatches") : t("uploadReferenceFirst")}
        </p>
      ) : (
        <>
          {visibleOptions.map((item, index) => (
            <button
              key={item.id}
              type="button"
              // Mousedown so the pick wins over the textarea blur.
              onMouseDown={(event) => {
                event.preventDefault();
                onPick(item);
              }}
              className={cn(
                "flex w-full items-center rounded-xl text-left transition-colors",
                item.kind === "skill" ? "min-h-13 gap-3 px-1.5 py-1.5" : "gap-2.5 px-2 py-1.5",
                index === active ? "bg-white/[0.09]" : "hover:bg-white/[0.055]"
              )}
            >
              <span
                className={cn(
                  "shrink-0 overflow-hidden bg-white/[0.05]",
                  item.kind === "skill" ? "h-10 w-16 rounded-lg" : "size-8 rounded-md"
                )}
              >
                <MentionMenuThumbnail item={item} active={index === active} />
              </span>
              <span className="min-w-0">
                <span
                  className={cn(
                    "block truncate",
                    item.kind === "skill"
                      ? "text-[13px] font-medium text-white/90"
                      : "text-xs font-semibold"
                  )}
                >
                  {item.kind === "skill" ? item.label : promptMentionToken(item)}
                </span>
                {item.name && item.name !== item.label ? (
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {item.name}
                  </span>
                ) : null}
              </span>
            </button>
          ))}
          {emptyKind === "skill" && resolvedTotalCount > visibleOptions.length && onShowAll ? (
            <button
              type="button"
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                onShowAll();
              }}
              className="sticky bottom-0 z-10 mt-1 flex h-9 w-full items-center justify-between rounded-xl bg-[oklch(0.18_0_0_/_0.98)] px-2.5 text-xs font-medium text-white/60 shadow-[0_-10px_18px_oklch(0.18_0_0_/_0.98)] transition-colors hover:bg-[oklch(0.22_0_0_/_0.98)] hover:text-white/85"
            >
              <span>{t("showAllSkills", { count: resolvedTotalCount })}</span>
              <IconChevronRight className="size-3.5" stroke={1.8} />
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

export function SkillMentionDialog({
  open,
  options,
  marketOptions,
  marketLoading = false,
  marketError = false,
  onOpenChange,
  onPick,
  onMarketRetry,
  onOpenMarket,
}: {
  open: boolean;
  options: MentionItem[];
  marketOptions?: readonly SkillMarketItem[];
  marketLoading?: boolean;
  marketError?: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (item: MentionItem) => void;
  onMarketRetry?: () => void;
  onOpenMarket?: (catalogId: string) => void;
}) {
  const t = useTranslations("generation");
  const [tab, setTab] = useState<"installed" | "market">("installed");
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const marketEnabled = marketOptions !== undefined || marketLoading || marketError;
  const currentOptions = tab === "installed" ? options : (marketOptions ?? []);
  const filtered = currentOptions.filter(
    (item) =>
      !normalizedQuery ||
      item.label.toLowerCase().includes(normalizedQuery) ||
      item.name?.toLowerCase().includes(normalizedQuery)
  );

  const changeOpen = (next: boolean) => {
    if (!next) {
      setQuery("");
      setTab("installed");
    }
    onOpenChange(next);
  };

  const selectTab = (next: "installed" | "market") => {
    setTab(next);
    setQuery("");
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="grid h-[min(82dvh,760px)] grid-rows-[auto_auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-3xl border-0 bg-[oklch(0.145_0_0)] p-0 shadow-2xl shadow-black/75 sm:max-w-[1000px] 2xl:max-w-[1180px]">
        <header className="flex items-start gap-6 px-8 pt-7 pb-5">
          <div className="min-w-0">
            <DialogTitle className="text-xl font-semibold tracking-tight text-white/94">
              {t("chooseSkill")}
            </DialogTitle>
            <DialogDescription className="mt-1 text-xs text-white/38">
              {t("skillBrowserDescription")}
            </DialogDescription>
          </div>
          <label className="ml-auto mr-8 flex h-10 w-72 shrink-0 items-center gap-2.5 rounded-xl bg-white/[0.065] px-3.5 text-white/55 transition-colors focus-within:bg-white/[0.09] focus-within:text-white/75">
            <IconSearch className="size-4 shrink-0" stroke={1.8} />
            <input
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder={t(tab === "installed" ? "searchSkills" : "searchSkillMarket")}
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/35"
            />
          </label>
        </header>

        <div className="flex h-11 shrink-0 items-end border-b border-white/[0.07] px-8">
          <div role="tablist" aria-label={t("skillBrowserTabs")} className="flex h-full gap-7">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "installed"}
              onClick={() => selectTab("installed")}
              className={cn(
                "relative h-full text-sm font-medium transition-colors focus-visible:outline-none",
                tab === "installed" ? "text-white/94" : "text-white/38 hover:text-white/68"
              )}
            >
              {t("installedSkillsTab")}
              <span className="ml-2 text-[11px] tabular-nums text-white/32">{options.length}</span>
              {tab === "installed" ? (
                <span className="absolute inset-x-0 bottom-0 h-px bg-white/85" />
              ) : null}
            </button>
            {marketEnabled ? (
              <button
                type="button"
                role="tab"
                aria-selected={tab === "market"}
                onClick={() => selectTab("market")}
                className={cn(
                  "relative h-full text-sm font-medium transition-colors focus-visible:outline-none",
                  tab === "market" ? "text-white/94" : "text-white/38 hover:text-white/68"
                )}
              >
                {t("skillMarketTab")}
                {marketOptions ? (
                  <span className="ml-2 text-[11px] tabular-nums text-white/32">
                    {marketOptions.length}
                  </span>
                ) : null}
                {tab === "market" ? (
                  <span className="absolute inset-x-0 bottom-0 h-px bg-white/85" />
                ) : null}
              </button>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto px-8 py-6">
          {tab === "market" && marketLoading ? (
            <div className="grid h-full place-items-center text-white/42">
              <IconLoader2 className="size-5 animate-spin" stroke={1.7} />
            </div>
          ) : tab === "market" && marketError ? (
            <div className="grid h-full place-items-center">
              <button
                type="button"
                onClick={onMarketRetry}
                className="rounded-xl px-4 py-2 text-sm text-white/48 transition-colors hover:bg-white/[0.06] hover:text-white/78"
              >
                {t("skillMarketLoadFailed")}
              </button>
            </div>
          ) : filtered.length > 0 ? (
            <div
              data-testid="skill-browser-grid"
              className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-6"
            >
              {filtered.map((item) => {
                const marketItem = tab === "market" ? (item as SkillMarketItem) : null;
                const installed = tab === "installed" || Boolean(marketItem?.installed);
                return (
                  <button
                    key={tab === "market" ? (marketItem?.catalogId ?? item.id) : item.id}
                    type="button"
                    onClick={() => {
                      if (installed) {
                        onPick(item);
                      } else if (marketItem) {
                        onOpenMarket?.(marketItem.catalogId);
                      }
                      changeOpen(false);
                    }}
                    className="group min-w-0 rounded-2xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[oklch(0.145_0_0)]"
                  >
                    <span className="relative block aspect-[16/10] overflow-hidden rounded-2xl bg-white/[0.04] ring-1 ring-white/[0.06] transition-[filter,box-shadow] group-hover:brightness-110 group-hover:ring-white/[0.16]">
                      <MentionMenuThumbnail item={item} active={false} />
                      {tab === "market" ? (
                        installed ? (
                          <span className="absolute top-2.5 right-2.5 inline-flex items-center gap-1 rounded-full bg-black/65 px-2 py-1 text-[10px] font-medium text-white/78 backdrop-blur-md">
                            <IconCheck className="size-3" stroke={2.1} />
                            {t("installedBadge")}
                          </span>
                        ) : (
                          <span className="absolute top-2.5 right-2.5 grid size-7 place-items-center rounded-full bg-black/60 text-white/62 opacity-0 backdrop-blur-md transition-opacity group-hover:opacity-100">
                            <IconExternalLink className="size-3.5" stroke={1.8} />
                          </span>
                        )
                      ) : null}
                    </span>
                    <span
                      data-testid="skill-browser-card-title"
                      className="flex min-w-0 items-center gap-2 px-1 pt-2.5"
                    >
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-white/85 group-hover:text-white">
                        {item.label}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="grid h-full place-items-center text-sm text-white/40">
              {t("noSkillMatches")}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
