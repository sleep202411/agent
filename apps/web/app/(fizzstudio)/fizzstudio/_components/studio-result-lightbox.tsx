"use client";

import { type ComponentType, useCallback, useEffect, useRef, useState } from "react";
import {
  IconArrowLeft,
  IconArrowRight,
  IconArrowsMaximize,
  IconDownload,
  IconInfoCircle,
  IconSparkles,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import { downloadMediaFile } from "@/src/lib/media-download";

/**
 * One viewable result inside the shared studio lightbox. The studios map their
 * job rows into this shape, so image and video render the same markup —
 * differences are data-driven (media element + duration row), never forked.
 */
export interface StudioResultLightboxItem {
  id: string;
  kind: "image" | "video";
  url: string;
  /** Generation prompt. Canvas previews may have none — copy UI hides itself. */
  prompt?: string;
  /** ISO timestamp rendered as "Created N ago" (completedAt ?? createdAt). */
  createdAt?: string;
  /** Resolved display name of the generating model; chip hidden when absent. */
  modelLabel?: string;
  width?: number | null;
  height?: number | null;
  /** Video only — drives the extra Duration metadata row. */
  durationSeconds?: number | null;
  /** CSS aspect-ratio fallback ("16 / 9") for the ratio row when width/height are unknown. */
  fallbackRatio?: string;
}

type LightboxT = ReturnType<typeof useTranslations>;

/**
 * Fullscreen result-detail lightbox shared by the image and video studios.
 * Extracted verbatim from the image studio's detail overlay, which is why its
 * strings live under `fizzStudio.imageStudio.detail` (their original home);
 * the video media label reuses `fizzStudio.videoStudio.results.alt`.
 */
export function StudioResultLightbox({
  items,
  activeId,
  onClose,
  onSelect,
}: {
  items: StudioResultLightboxItem[];
  activeId: string;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const t = useTranslations("fizzStudio.imageStudio");
  const videoT = useTranslations("fizzStudio.videoStudio");
  const [promptCopyState, setPromptCopyState] = useState<"copied" | "failed" | "idle">("idle");
  const promptCopyResetRef = useRef<number | null>(null);

  const activeIndex = items.findIndex((entry) => entry.id === activeId);
  const item = activeIndex >= 0 ? items[activeIndex] : null;
  const showNavigation = items.length > 1;

  const moveSelection = useCallback(
    (direction: -1 | 1) => {
      if (items.length === 0 || activeIndex < 0) return;
      const next = items[(activeIndex + direction + items.length) % items.length];
      if (next) onSelect(next.id);
    },
    [activeIndex, items, onSelect]
  );

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (!showNavigation) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveSelection(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        moveSelection(1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [moveSelection, onClose, showNavigation]);

  useEffect(() => {
    return () => {
      if (promptCopyResetRef.current) window.clearTimeout(promptCopyResetRef.current);
    };
  }, []);

  const prompt = item?.prompt ?? "";
  const copyPrompt = useCallback(async () => {
    const copied = await copyTextToClipboard(prompt);
    setPromptCopyState(copied ? "copied" : "failed");
    if (promptCopyResetRef.current) window.clearTimeout(promptCopyResetRef.current);
    promptCopyResetRef.current = window.setTimeout(() => setPromptCopyState("idle"), 1600);
  }, [prompt]);

  const downloadItem = useCallback(async () => {
    if (!item) return;
    // Cross-origin OSS URLs make the `download` attribute a no-op, so the
    // bytes go through a same-origin blob to guarantee a real file save.
    const saved = await downloadMediaFile(item.url);
    if (!saved) {
      toast.error(t("detail.downloadFailed"));
    }
  }, [item, t]);

  if (!item) return null;

  const mediaAlt = item.kind === "image" ? t("results.alt") : videoT("results.alt");
  const resolution = resolutionLabel(item, t);
  const ratio = ratioLabel(item, t);
  const promptCopyLabel =
    promptCopyState === "copied"
      ? t("detail.promptCopied")
      : promptCopyState === "failed"
        ? t("detail.promptCopyFailed")
        : t("detail.copyPrompt");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("detail.title")}
      className="fixed inset-0 z-[999] overflow-hidden bg-black text-white duration-150 animate-in fade-in-0"
    >
      {item.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.url}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 size-full scale-110 object-cover opacity-[0.22] blur-3xl"
        />
      ) : null}
      <div className="absolute inset-0 bg-black/78 bg-[radial-gradient(circle_at_18%_10%,rgba(45,212,191,0.12),transparent_30%),radial-gradient(circle_at_78%_92%,rgba(124,58,237,0.18),transparent_34%)]" />

      <div className="relative flex h-[100svh] min-h-0 flex-col gap-4 p-4 lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:p-7">
        <section className="relative flex min-h-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 items-center justify-center px-3 pb-20 pt-8 sm:px-10 lg:px-16 lg:pb-24 lg:pt-10">
            {showNavigation ? (
              <>
                <button
                  type="button"
                  onClick={() => moveSelection(-1)}
                  aria-label={t("detail.previous")}
                  className="absolute left-0 top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full text-white/64 transition hover:bg-white/[0.08] hover:text-white md:grid"
                >
                  <IconArrowLeft className="size-5" stroke={1.8} />
                </button>
                <button
                  type="button"
                  onClick={() => moveSelection(1)}
                  aria-label={t("detail.next")}
                  className="absolute right-0 top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full text-white/64 transition hover:bg-white/[0.08] hover:text-white md:grid"
                >
                  <IconArrowRight className="size-5" stroke={1.8} />
                </button>
              </>
            ) : null}

            <div className="relative max-h-full max-w-full">
              {item.kind === "image" ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.url}
                    alt={mediaAlt}
                    className="max-h-[calc(100svh-210px)] max-w-full rounded-[10px] object-contain shadow-[0_30px_90px_rgba(0,0,0,.48)] lg:max-h-[calc(100svh-170px)]"
                  />
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={t("detail.expand")}
                    className="absolute right-3 top-3 grid size-10 place-items-center rounded-full bg-black/48 text-white backdrop-blur-md transition hover:bg-black/68"
                  >
                    <IconArrowsMaximize className="size-5" stroke={1.8} />
                  </a>
                </>
              ) : (
                // Real playback chrome in the lightbox is intentional for video:
                // native controls already cover fullscreen, scrub, and volume.
                // key remounts the element so autoplay re-triggers on prev/next.
                <video
                  key={item.id}
                  src={item.url}
                  controls
                  autoPlay
                  playsInline
                  aria-label={mediaAlt}
                  className="max-h-[calc(100svh-210px)] max-w-full rounded-[10px] object-contain shadow-[0_30px_90px_rgba(0,0,0,.48)] lg:max-h-[calc(100svh-170px)]"
                />
              )}
            </div>
          </div>

          <div className="absolute inset-x-0 bottom-2 flex justify-center px-3 lg:bottom-4">
            <div className="flex max-w-full items-center gap-2 overflow-x-auto rounded-[18px] border border-white/[0.08] bg-black/34 p-2 shadow-[0_18px_55px_rgba(0,0,0,.38)] backdrop-blur-xl">
              <DetailActionButton
                icon={IconSparkles}
                label={promptCopyLabel}
                onClick={prompt ? copyPrompt : undefined}
                disabled={!prompt}
              />
              <DetailActionButton
                icon={IconDownload}
                label={t("detail.download")}
                onClick={downloadItem}
              />
            </div>
          </div>
        </section>

        <aside className="flex min-h-0 flex-col rounded-[24px] border border-white/[0.08] bg-[#0d0d0f]/96 p-5 shadow-[0_24px_80px_rgba(0,0,0,.52)] backdrop-blur-xl lg:h-full">
          <div className="flex shrink-0 items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => void downloadItem()}
              className="inline-flex h-10 items-center gap-2 rounded-[14px] border border-white/[0.1] px-3 text-sm font-semibold text-white transition hover:bg-white/[0.07]"
            >
              <IconDownload className="size-4" stroke={1.8} />
              {t("detail.download")}
            </button>
            <div className="relative flex items-center gap-1.5">
              <button
                type="button"
                aria-label={t("detail.close")}
                onClick={onClose}
                className="grid size-9 place-items-center rounded-full text-white/76 transition hover:bg-white/[0.08] hover:text-white"
              >
                <IconX className="size-5" stroke={1.8} />
              </button>
            </div>
          </div>

          <div className="mt-7 flex items-center gap-2.5">
            <span className="grid size-7 place-items-center rounded-full bg-[#9a6336] text-white">
              <IconSparkles className="size-3.5" stroke={2} />
            </span>
            <p className="text-sm font-semibold text-white/88">{t("detail.byYou")}</p>
          </div>
          {item.createdAt ? (
            <p className="mt-3 text-sm font-medium text-white/48">
              {t("detail.created", { time: formatRelativeTime(item.createdAt, t) })}
            </p>
          ) : null}

          <div className="mt-6 min-h-0 flex-1 overflow-y-auto pr-1">
            {prompt ? (
              <section className="rounded-[18px] border border-white/[0.08] p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="inline-flex items-center gap-2 text-base font-semibold text-white/88">
                    <IconInfoCircle className="size-4" stroke={1.8} />
                    {t("detail.prompt")}
                  </h3>
                  <button
                    type="button"
                    onClick={copyPrompt}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[11px] bg-white/[0.08] px-3 text-xs font-semibold text-white/86 transition hover:bg-white/[0.13] hover:text-white"
                  >
                    <IconSparkles className="size-3.5" stroke={1.8} />
                    {promptCopyLabel}
                  </button>
                </div>
                <p className="mt-4 whitespace-pre-wrap text-sm font-medium leading-7 text-white/86">
                  {prompt}
                </p>
              </section>
            ) : null}

            {item.modelLabel ? (
              <div className={cn("flex justify-end", prompt ? "mt-4" : null)}>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.08] px-3 py-1 text-xs font-semibold text-white/82">
                  <IconSparkles className="size-3.5" stroke={1.8} />
                  {item.modelLabel}
                  <IconInfoCircle className="size-3.5 text-white/52" stroke={1.8} />
                </span>
              </div>
            ) : null}

            <div className="mt-5 rounded-[18px] border border-white/[0.08] p-4">
              <h3 className="text-base font-semibold text-white/88">{t("detail.metadata")}</h3>
              <div className="mt-4 space-y-3">
                <DetailMetadataRow label={t("detail.resolution")} value={resolution} />
                <DetailMetadataRow label={t("detail.ratio")} value={ratio} />
                {item.kind === "video" ? (
                  <DetailMetadataRow label={t("detail.duration")} value={durationLabel(item, t)} />
                ) : null}
                {item.modelLabel ? (
                  <DetailMetadataRow label={t("detail.model")} value={item.modelLabel} />
                ) : null}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function DetailActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: ComponentType<{ className?: string; stroke?: number }>;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const className =
    "inline-flex h-10 shrink-0 items-center gap-2 rounded-[14px] border border-white/[0.08] bg-white/[0.05] px-3 text-sm font-semibold text-white/86 transition hover:bg-white/[0.1] hover:text-white disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-white/[0.05]";
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={className}>
      <Icon className="size-4" stroke={1.8} />
      <span>{label}</span>
    </button>
  );
}

function DetailMetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-white/42">{label}</span>
      <span className="min-w-0 truncate font-semibold text-white/82">{value}</span>
    </div>
  );
}

/* ── display helpers ──────────────────────────────────────────────────────── */

function resolutionLabel(item: StudioResultLightboxItem, t: LightboxT): string {
  if (
    typeof item.width === "number" &&
    typeof item.height === "number" &&
    item.width > 0 &&
    item.height > 0
  ) {
    return `${Math.round(item.width)} x ${Math.round(item.height)}`;
  }
  return t("detail.unknownResolution");
}

function ratioLabel(item: StudioResultLightboxItem, t: LightboxT): string {
  if (
    typeof item.width === "number" &&
    typeof item.height === "number" &&
    item.width > 0 &&
    item.height > 0
  ) {
    const divisor = greatestCommonDivisor(Math.round(item.width), Math.round(item.height));
    return `${Math.round(item.width) / divisor}:${Math.round(item.height) / divisor}`;
  }
  if (item.fallbackRatio) {
    return item.fallbackRatio.replace(/\s*\/\s*/g, ":");
  }
  return t("detail.unknownResolution");
}

function durationLabel(item: StudioResultLightboxItem, t: LightboxT): string {
  const seconds = item.durationSeconds;
  if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) {
    return formatDuration(seconds, t);
  }
  return t("detail.unknownResolution");
}

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y > 0) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x || 1;
}

function formatDuration(seconds: number, t: LightboxT): string {
  const totalSeconds = Math.max(1, Math.ceil(seconds));
  if (totalSeconds < 60) return t("results.duration.seconds", { seconds: totalSeconds });
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;
  if (remainingSeconds === 0 || minutes >= 3) {
    return t("results.duration.minutes", { minutes: Math.ceil(totalSeconds / 60) });
  }
  return t("results.duration.minuteSeconds", {
    minutes,
    seconds: remainingSeconds,
  });
}

function formatRelativeTime(value: string, t: LightboxT): string {
  const elapsed = Math.max(0, Date.now() - timestampMs(value));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return t("results.relative.justNow");
  if (minutes < 60) return t("results.relative.minutesAgo", { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("results.relative.hoursAgo", { hours });
  return t("results.relative.daysAgo", { days: Math.floor(hours / 24) });
}

function timestampMs(value: string): number {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (copyTextWithSelection(text)) return true;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function copyTextWithSelection(text: string): boolean {
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
  } catch {
    return false;
  }
}
