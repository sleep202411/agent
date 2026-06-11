"use client";

import { useEffect, useRef, useState } from "react";
import {
  IconAlertTriangle,
  IconClock,
  IconDownload,
  IconLoader2,
  IconMaximize,
  IconRefresh,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { FizzAiJobOutput } from "@/app/canvas/_lib/generation-api";
import type { FeedJob } from "./use-generation-feed";

/** CSS aspect-ratio for a pending tile from the job's size settings, so the
 *  masonry doesn't shift when the result lands. */
export function aspectRatioFromInput(input: Record<string, unknown>, fallback: string): string {
  const token = String(input.imageSize ?? input.aspectRatio ?? input.size ?? "");
  const match = token.match(/(\d+)\s*[:x]\s*(\d+)/);
  return match ? `${match[1]} / ${match[2]}` : fallback;
}

export function timeAgo(ms: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function stageLabel(stage: string, status: string): string {
  if (/submit|creat|validat/i.test(stage)) return "Preparing";
  if (status === "queued" || /queue/i.test(stage)) return "Queued";
  if (/fetch|upload|oss|output/i.test(stage)) return "Finalizing";
  return "Generating";
}

/** Live ETA countdown — ticks once a second while the job runs. */
function useEtaCountdown(etaSeconds: number | null, createdAtMs: number, active: boolean) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!active || etaSeconds == null) return;
    const timer = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [active, etaSeconds]);
  if (!active || etaSeconds == null) return null;
  const remaining = Math.ceil(etaSeconds - (Date.now() - createdAtMs) / 1000);
  return remaining > 0 ? remaining : null;
}

function formatSeconds(total: number): string {
  if (total < 60) return `${total}s`;
  return `${Math.floor(total / 60)}m ${total % 60}s`;
}

export function PendingTile({ job, ratio }: { job: FeedJob; ratio: string }) {
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
          {stageLabel(job.stage, job.status)}
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
              ? `Queue #${job.queuePosition}`
              : " "}
          </span>
          <span>{eta != null ? `~${formatSeconds(eta)}` : " "}</span>
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
  return (
    <div
      className="relative flex flex-col items-start justify-between overflow-hidden rounded-xl bg-card p-3"
      style={{ aspectRatio: ratio }}
    >
      <span className="flex items-center gap-1.5 rounded-full bg-destructive/15 px-2.5 py-1 text-[11px] font-medium text-destructive">
        <IconAlertTriangle className="size-3" stroke={2} />
        Failed
      </span>
      <div className="min-h-0">
        <p className="line-clamp-3 text-xs leading-5 text-white/75">
          {job.error ?? "Generation failed"}
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
        Retry
      </button>
    </div>
  );
}

async function downloadOutput(url: string, name: string) {
  try {
    const blob = await (await fetch(url)).blob();
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(url, "_blank");
  }
}

function HoverCaption({ job, index, total }: { job: FeedJob; index: number; total: number }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-3 pt-8 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
      <p className="line-clamp-2 text-xs leading-4 text-white/90">{job.prompt}</p>
      <p className="mt-1 text-[10px] text-white/55 tabular-nums">
        {total > 1 ? `${index + 1}/${total} · ` : ""}
        {timeAgo(job.createdAtMs)}
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
  const ratio =
    output.width && output.height
      ? `${output.width} / ${output.height}`
      : aspectRatioFromInput(job.input, "1 / 1");
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative block w-full overflow-hidden rounded-xl bg-card text-left"
      style={{ aspectRatio: ratio }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={output.url}
        alt={job.prompt}
        loading="lazy"
        className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.025]"
      />
      <HoverCaption job={job} index={index} total={total} />
      <span className="absolute top-2 right-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <span
          role="button"
          aria-label="Download"
          onClick={(event) => {
            event.stopPropagation();
            void downloadOutput(output.url, `${job.prompt.slice(0, 40) || "image"}.png`);
          }}
          className="flex size-8 items-center justify-center rounded-full bg-black/55 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/75 hover:text-white"
        >
          <IconDownload className="size-4" stroke={1.8} />
        </span>
      </span>
    </button>
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
  const videoRef = useRef<HTMLVideoElement>(null);
  return (
    <div
      className="group relative aspect-video cursor-pointer overflow-hidden rounded-xl bg-card"
      onClick={onOpen}
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
        src={output.url}
        muted
        loop
        playsInline
        preload="metadata"
        className="size-full object-cover"
      />
      <HoverCaption job={job} index={0} total={1} />
      <span className="absolute top-2 right-2 flex gap-1.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <span
          role="button"
          aria-label="Fullscreen"
          onClick={(event) => {
            event.stopPropagation();
            const el = videoRef.current;
            if (!el) return;
            el.controls = true;
            el.muted = false;
            void el.requestFullscreen?.();
            const restore = () => {
              if (!document.fullscreenElement) {
                el.controls = false;
                el.muted = true;
                document.removeEventListener("fullscreenchange", restore);
              }
            };
            document.addEventListener("fullscreenchange", restore);
          }}
          className="flex size-8 items-center justify-center rounded-full bg-black/55 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/75 hover:text-white"
        >
          <IconMaximize className="size-4" stroke={1.8} />
        </span>
        <span
          role="button"
          aria-label="Download"
          onClick={(event) => {
            event.stopPropagation();
            void downloadOutput(output.url, `${job.prompt.slice(0, 40) || "video"}.mp4`);
          }}
          className="flex size-8 items-center justify-center rounded-full bg-black/55 text-white/85 backdrop-blur-sm transition-colors hover:bg-black/75 hover:text-white"
        >
          <IconDownload className="size-4" stroke={1.8} />
        </span>
      </span>
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

export function FeedEmptyState({ message, hint }: { message: string; hint: string }) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center gap-2 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-muted">
        <IconClock className="size-6 text-white/30" stroke={1.5} />
      </span>
      <p className="mt-2 text-sm font-medium text-white/75">{message}</p>
      <p className="max-w-xs text-xs text-muted-foreground">{hint}</p>
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
