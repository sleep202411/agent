"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import {
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconDownload,
  IconX,
} from "@tabler/icons-react";
import type { FizzAiJobOutput } from "@/lib/canvas-authoring/generation-api";
import { useVideoPlaybackError, VideoPlaybackFallback } from "@/components/video-playback-fallback";
import { downloadOutput } from "./download-output";
import { timeAgo } from "./feed-tiles";
import type { FeedJob } from "./use-generation-feed";

/** One viewable item — a completed output with its parent job's context. */
export interface LightboxItem {
  key: string;
  job: FeedJob;
  output: FizzAiJobOutput;
}

function reducedRatio(width?: number, height?: number): string | null {
  if (!width || !height) return null;
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const d = gcd(width, height);
  return `${width / d}:${height / d}`;
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-white/85 tabular-nums">{value}</span>
    </div>
  );
}

/**
 * Fullscreen result viewer: media area + details sidebar. ←/→ cycles every
 * completed output, Esc closes; body scroll locked while open.
 */
export function ResultLightbox({
  items,
  index,
  modelName,
  onNavigate,
  onClose,
}: {
  items: LightboxItem[];
  index: number;
  modelName: (modelId: string) => string;
  onNavigate: (index: number) => void;
  onClose: () => void;
}) {
  const t = useTranslations("generation");
  const tc = useTranslations("common");
  const item = items[index];
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight") onNavigate((index + 1) % items.length);
      else if (event.key === "ArrowLeft") onNavigate((index - 1 + items.length) % items.length);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, items.length, onNavigate, onClose]);

  const { failed: videoFailed, onError: onVideoError } = useVideoPlaybackError(
    item ? (item.output.url ?? item.output.accessUrl) : undefined
  );

  if (!item) return null;
  const { job, output } = item;
  const isVideo = output.type === "video";
  const ratio = reducedRatio(output.width, output.height);
  const src = output.url ?? output.accessUrl;

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(job.prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  const download = () =>
    downloadOutput(src, `${job.prompt.slice(0, 40) || "result"}.${isVideo ? "mp4" : "png"}`, {
      failed: t("downloadFailed"),
      openOriginal: t("openOriginal"),
    });

  return createPortal(
    <div className="fixed inset-0 z-[100] flex bg-black/92 backdrop-blur-sm">
      {/* Media area */}
      <div className="relative flex min-w-0 flex-1 items-center justify-center p-6 lg:p-10">
        {isVideo ? (
          <video
            key={item.key}
            src={src}
            controls
            autoPlay
            playsInline
            onError={onVideoError}
            className="max-h-full max-w-full rounded-lg"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={job.prompt}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        )}

        {isVideo && videoFailed && <VideoPlaybackFallback onDownload={() => void download()} />}

        {items.length > 1 && (
          <>
            <button
              type="button"
              aria-label={t("previous")}
              onClick={() => onNavigate((index - 1 + items.length) % items.length)}
              className="absolute top-1/2 left-4 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur-md transition-colors hover:bg-white/20 hover:text-white"
            >
              <IconChevronLeft className="size-5" stroke={2} />
            </button>
            <button
              type="button"
              aria-label={tc("next")}
              onClick={() => onNavigate((index + 1) % items.length)}
              className="absolute top-1/2 right-4 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white/80 backdrop-blur-md transition-colors hover:bg-white/20 hover:text-white"
            >
              <IconChevronRight className="size-5" stroke={2} />
            </button>
          </>
        )}
      </div>

      {/* Details sidebar */}
      <aside className="hidden w-[360px] shrink-0 flex-col gap-4 overflow-y-auto bg-[oklch(0.16_0_0)] p-5 lg:flex">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void download()}
              className="flex h-8 items-center gap-1.5 rounded-full bg-white/[0.08] px-3 text-xs font-medium transition-colors hover:bg-white/[0.14]"
            >
              <IconDownload className="size-3.5" stroke={2} />
              {t("download")}
            </button>
          </div>
          <button
            type="button"
            aria-label={tc("close")}
            onClick={onClose}
            className="flex size-8 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            <IconX className="size-4.5" stroke={1.8} />
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          {t("createdAt", { time: timeAgo(job.createdAtMs, t) })}
        </p>

        <div className="rounded-2xl bg-card p-3.5">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-medium text-muted-foreground">{t("prompt")}</p>
            <button
              type="button"
              onClick={() => void copyPrompt()}
              className="flex h-6 items-center gap-1 rounded-full px-2 text-[11px] text-white/60 transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              <IconCopy className="size-3" stroke={2} />
              {copied ? tc("copied") : tc("copy")}
            </button>
          </div>
          <p className="mt-2 text-sm leading-6 whitespace-pre-wrap text-white/90">{job.prompt}</p>
        </div>

        <div className="rounded-2xl bg-card p-3.5">
          <p className="text-xs font-medium text-muted-foreground">{t("details")}</p>
          <div className="mt-1.5 divide-y divide-border">
            {output.width && output.height && (
              <MetaRow label={t("resolution")} value={`${output.width} × ${output.height}`} />
            )}
            {ratio && <MetaRow label={t("ratio")} value={ratio} />}
            {isVideo && output.durationSeconds != null && (
              <MetaRow
                label={t("durationLabel")}
                value={t("duration.seconds", { seconds: output.durationSeconds })}
              />
            )}
            <MetaRow label={t("model")} value={modelName(job.modelId)} />
          </div>
        </div>
      </aside>
    </div>,
    document.body
  );
}
