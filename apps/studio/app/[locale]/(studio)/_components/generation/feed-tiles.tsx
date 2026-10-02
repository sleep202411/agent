"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  IconAlertTriangle,
  IconDownload,
  IconLoader2,
  IconMaximize,
  IconRefresh,
} from "@tabler/icons-react";
import { downloadOutput } from "./download-output";
import { cn } from "@/lib/utils";
import { useVideoPlaybackError, VideoPlaybackFallback } from "@/components/video-playback-fallback";
import type { FizzAiJobOutput } from "@/lib/canvas-authoring/generation-api";
import type { FeedJob } from "./use-generation-feed";

/** Translator type for the "generation" namespace, threaded into the pure
 *  display helpers below so they stay outside the React render tree. */
type GenerationT = ReturnType<typeof useTranslations<"generation">>;

/** CSS aspect-ratio for a pending tile from the job's size settings, so the
 *  masonry doesn't shift when the result lands. */
export function aspectRatioFromInput(input: Record<string, unknown>, fallback: string): string {
  const token = String(input.imageSize ?? input.aspectRatio ?? input.size ?? "");
  const match = token.match(/(\d+)\s*[:x]\s*(\d+)/);
  return match ? `${match[1]} / ${match[2]}` : fallback;
}

export function timeAgo(ms: number, t: GenerationT): string {
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) return t("time.justNow");
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t("time.minutesAgo", { minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t("time.hoursAgo", { hours });
  return t("time.daysAgo", { days: Math.floor(hours / 24) });
}

function stageLabel(stage: string, status: string, t: GenerationT): string {
  if (/submit|creat|validat/i.test(stage)) return t("stage.preparing");
  if (status === "queued" || /queue/i.test(stage)) return t("stage.queued");
  if (/fetch|upload|oss|output/i.test(stage)) return t("stage.finalizing");
  return t("stage.generating");
}

/** Live ETA countdown — ticks once a second while the job runs. */
function useEtaCountdown(etaSeconds: number | null, createdAtMs: number, active: boolean) {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    if (!active || etaSeconds == null) return;
    const tick = () => {
      setRemaining(Math.max(0, Math.ceil(etaSeconds - (Date.now() - createdAtMs) / 1000)));
    };
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [active, createdAtMs, etaSeconds]);
  if (!active || etaSeconds == null) return null;
  return remaining != null && remaining > 0 ? remaining : null;
}

function formatSeconds(total: number, t: GenerationT): string {
  if (total < 60) return t("duration.seconds", { seconds: total });
  return t("duration.minutesSeconds", { minutes: Math.floor(total / 60), seconds: total % 60 });
}

export function PendingTile({ job, ratio }: { job: FeedJob; ratio: string }) {
  const t = useTranslations("generation");
  const eta = useEtaCountdown(job.etaSeconds, job.createdAtMs, true);
  const percent =
    job.progress != null
      ? Math.round(
          Math.min(0.97, Math.max(0.02, job.progress <= 1 ? job.progress : job.progress / 100)) *
            100
        )
      : null;

  return (
    <div
      className="relative flex flex-col justify-between overflow-hidden rounded-xl bg-card p-3"
      style={{ aspectRatio: ratio }}
    >
      {/* Shimmer sweep */}
      <div className="pointer-events-none absolute inset-0 animate-pulse bg-gradient-to-tr from-transparent via-white/[0.035] to-transparent" />

      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] font-medium text-white/80">
          <IconLoader2 className="size-3 animate-spin" stroke={2} />
          {stageLabel(job.stage, job.status, t)}
        </span>
        {percent != null && (
          <span className="rounded-full bg-white/[0.06] px-2 py-1 text-[11px] text-white/70 tabular-nums">
            {percent}%
          </span>
        )}
      </div>

      <p className="line-clamp-3 text-xs leading-5 text-white/45">{job.prompt}</p>

      <div>
        <div className="h-px overflow-hidden rounded-full bg-white/[0.08]">
          {percent != null ? (
            <div
              className="h-full bg-white/70 transition-[width] duration-700"
              style={{ width: `${percent}%` }}
            />
          ) : (
            <div className="h-full w-1/3 animate-pulse bg-white/50" />
          )}
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
          <span>
            {job.queuePosition != null && job.queuePosition > 0
              ? t("queuePosition", { position: job.queuePosition })
              : " "}
          </span>
          <span>{eta != null ? t("etaApprox", { duration: formatSeconds(eta, t) }) : " "}</span>
        </div>
      </div>
    </div>
  );
}

export function FailedTile({
  job,
  ratio,
  onRetry,
}: {
  job: FeedJob;
  ratio: string;
  onRetry: () => void;
}) {
  const t = useTranslations("generation");
  const tc = useTranslations("common");
  return (
    <div
      className="relative flex flex-col items-start justify-between overflow-hidden rounded-xl bg-card p-3"
      style={{ aspectRatio: ratio }}
    >
      <span className="flex items-center gap-1.5 rounded-full bg-destructive/15 px-2.5 py-1 text-[11px] font-medium text-destructive">
        <IconAlertTriangle className="size-3" stroke={2} />
        {t("failed")}
      </span>
      <div className="min-h-0">
        <p className="line-clamp-3 text-xs leading-5 text-white/75">
          {job.errorCode === "PROVIDER_CONTENT_FILTER"
            ? t("contentPolicyBlocked")
            : (job.error ?? t("generationFailed"))}
        </p>
        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
          {job.prompt}
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="flex h-7 items-center gap-1.5 rounded-full bg-white/[0.08] px-3 text-xs font-medium transition-colors hover:bg-white/[0.14]"
      >
        <IconRefresh className="size-3.5" stroke={2} />
        {tc("retry")}
      </button>
    </div>
  );
}

function HoverCaption({ job, index, total }: { job: FeedJob; index: number; total: number }) {
  const t = useTranslations("generation");
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-3 pt-8 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
      <p className="line-clamp-2 text-xs leading-4 text-white/90">{job.prompt}</p>
      <p className="mt-1 text-[10px] text-white/55 tabular-nums">
        {total > 1 ? `${index + 1}/${total} · ` : ""}
        {timeAgo(job.createdAtMs, t)}
      </p>
    </div>
  );
}

export function ImageResultTile({
  job,
  output,
  index,
  total,
  onOpen,
}: {
  job: FeedJob;
  output: FizzAiJobOutput;
  index: number;
  total: number;
  onOpen: () => void;
}) {
  const t = useTranslations("generation");
  const src = output.url ?? output.accessUrl;
  const ratio =
    output.width && output.height
      ? `${output.width} / ${output.height}`
      : aspectRatioFromInput(job.input, "1 / 1");
  return (
    <div
      className="group relative block w-full overflow-hidden rounded-xl bg-card text-left"
      style={{ aspectRatio: ratio }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={job.prompt}
        loading="lazy"
        className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.025]"
      />
      <button
        type="button"
        aria-label={`${t("fullscreen")}: ${job.prompt}`}
        onClick={onOpen}
        className="absolute inset-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70"
      />
      <HoverCaption job={job} index={index} total={total} />
      <span className="absolute top-2 right-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          aria-label={t("download")}
          onClick={(event) => {
            event.stopPropagation();
            void downloadOutput(src, `${job.prompt.slice(0, 40) || "image"}.png`, {
              failed: t("downloadFailed"),
              openOriginal: t("openOriginal"),
            });
          }}
          className="flex size-8 items-center justify-center rounded-full bg-black/55 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/75 hover:text-white"
        >
          <IconDownload className="size-4" stroke={1.8} />
        </button>
      </span>
    </div>
  );
}

export function VideoResultTile({
  job,
  output,
  onOpen,
}: {
  job: FeedJob;
  output: FizzAiJobOutput;
  onOpen: () => void;
}) {
  const t = useTranslations("generation");
  const videoRef = useRef<HTMLVideoElement>(null);
  const src = output.url ?? output.accessUrl;
  const { failed, onError } = useVideoPlaybackError(src);
  useEffect(() => {
    const video = videoRef.current;
    const restore = () => {
      if (video && document.fullscreenElement !== video) {
        video.controls = false;
        video.muted = true;
      }
    };
    document.addEventListener("fullscreenchange", restore);
    return () => {
      document.removeEventListener("fullscreenchange", restore);
    };
  }, []);
  const enterFullscreen = async () => {
    const video = videoRef.current;
    if (!video?.requestFullscreen) {
      onOpen();
      return;
    }
    video.controls = true;
    video.muted = false;
    try {
      await video.requestFullscreen();
    } catch {
      video.controls = false;
      video.muted = true;
      if (video.isConnected) onOpen();
    }
  };
  return (
    <div
      className="group relative aspect-video cursor-pointer overflow-hidden rounded-xl bg-card"
      onMouseEnter={() => void videoRef.current?.play().catch(() => {})}
      onMouseLeave={() => {
        const el = videoRef.current;
        if (el && document.fullscreenElement !== el) {
          el.pause();
          el.currentTime = 0;
        }
      }}
    >
      <video
        ref={videoRef}
        src={src}
        muted
        loop
        playsInline
        preload="metadata"
        onError={onError}
        className="size-full object-cover"
      />
      <button
        type="button"
        aria-label={`${t("fullscreen")}: ${job.prompt}`}
        onClick={onOpen}
        className="absolute inset-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/70"
      />
      {failed && <VideoPlaybackFallback compact />}
      <HoverCaption job={job} index={0} total={1} />
      <span className="absolute top-2 right-2 flex gap-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          aria-label={t("fullscreen")}
          onClick={(event) => {
            event.stopPropagation();
            void enterFullscreen();
          }}
          className="flex size-8 items-center justify-center rounded-full bg-black/55 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/75 hover:text-white"
        >
          <IconMaximize className="size-4" stroke={1.8} />
        </button>
        <button
          type="button"
          aria-label={t("download")}
          onClick={(event) => {
            event.stopPropagation();
            void downloadOutput(src, `${job.prompt.slice(0, 40) || "video"}.mp4`, {
              failed: t("downloadFailed"),
              openOriginal: t("openOriginal"),
            });
          }}
          className="flex size-8 items-center justify-center rounded-full bg-black/55 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/75 hover:text-white"
        >
          <IconDownload className="size-4" stroke={1.8} />
        </button>
      </span>
    </div>
  );
}

/** Reading history must never be confused with retrying a paid generation. */
export function FeedHistoryError({ error, onRetry }: { error: string; onRetry: () => void }) {
  const t = useTranslations("common");
  return (
    <div role="alert" className="mb-4 text-sm text-destructive">
      <p>{error}</p>
      <button type="button" onClick={onRetry} className="mt-2 underline">
        {t("retry")}
      </button>
    </div>
  );
}

export function FeedLoadingState() {
  return (
    <div className="flex min-h-[240px] items-center justify-center">
      <IconLoader2 className="size-6 animate-spin text-white/40" stroke={1.8} />
    </div>
  );
}

export function FeedEmptyState({
  message,
  hint,
  modelName,
}: {
  message: string;
  hint: string;
  /** Currently-selected model — highlighted in the hero, tracks the selection. */
  modelName?: string;
}) {
  return (
    <div className="flex min-h-[340px] flex-col items-center justify-center gap-3 px-6 text-center">
      <h2 className="text-3xl font-extrabold uppercase leading-[1.05] tracking-tight sm:text-4xl">
        <span className="block text-foreground">{message}</span>
        {modelName ? <span className="mt-1 block text-[#E52227]">{modelName}</span> : null}
      </h2>
      <p className="mt-1 max-w-md text-sm leading-relaxed text-muted-foreground sm:text-base">
        {hint}
      </p>
    </div>
  );
}

/** Masonry wrapper (CSS columns) for the image feed. */
export function Masonry({ children }: { children: React.ReactNode }) {
  return (
    <div className="columns-2 gap-2.5 sm:columns-3 lg:columns-4 xl:columns-5 2xl:columns-6 [&>*]:mb-2.5 [&>*]:break-inside-avoid">
      {children}
    </div>
  );
}

/** Uniform 16:9 grid for the video feed. */
export function VideoGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className={cn("grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5")}>
      {children}
    </div>
  );
}
