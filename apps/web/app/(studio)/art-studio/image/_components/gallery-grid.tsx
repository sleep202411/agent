"use client";

import {
  IconAlertTriangle,
  IconCircleDashed,
  IconDownload,
  IconRefresh,
} from "@tabler/icons-react";

export type GalleryItem =
  | {
      id: string;
      kind: "queued";
      prompt: string;
      ratio: string;
      createdAt: number;
      count?: number;
      stage?: string;
      queuePosition?: number | null;
      progress?: number | null;
      etaSeconds?: number | null;
    }
  | {
      id: string;
      kind: "done";
      url: string;
      prompt: string;
      ratio: string;
      createdAt: number;
    }
  | {
      id: string;
      kind: "error";
      prompt: string;
      ratio: string;
      message: string;
      createdAt: number;
    };

export type GalleryGridProps = {
  items: GalleryItem[];
  onRetry?: (id: string) => void;
  onOpen?: (id: string) => void;
  t: (key: string, fallback?: string) => string;
};

export function GalleryGrid({ items, onRetry, onOpen, t }: GalleryGridProps) {
  return (
    <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      {items.map((item) => (
        <GalleryCell key={item.id} item={item} onRetry={onRetry} onOpen={onOpen} t={t} />
      ))}
    </div>
  );
}

function GalleryCell({
  item,
  onRetry,
  onOpen,
  t,
}: {
  item: GalleryItem;
  onRetry?: (id: string) => void;
  onOpen?: (id: string) => void;
  t: (key: string, fallback?: string) => string;
}) {
  const aspect = aspectFromRatio(item.ratio);

  if (item.kind === "queued") {
    const stageLabel = labelForStage(item.stage, t);
    const detail = detailForQueued(item, t);
    const progress = clampProgress(item.progress);
    return (
      <div
        className="relative overflow-hidden rounded-xl bg-zinc-900"
        style={{ aspectRatio: aspect }}
      >
        {/* Subtle shimmer — lets the card "breathe" while polling. */}
        <div className="absolute inset-0 bg-[linear-gradient(110deg,rgba(255,255,255,0)_0%,rgba(255,255,255,0.04)_50%,rgba(255,255,255,0)_100%)] bg-[length:200%_100%] [animation:gallery-shimmer_2.4s_linear_infinite]" />

        {/* Top-left: stage pill */}
        <div className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-zinc-200 backdrop-blur">
          <IconCircleDashed className="size-3.5 animate-spin" />
          <span>{stageLabel}</span>
        </div>

        {/* Top-right: ×N badge when batching */}
        {item.count && item.count > 1 && (
          <div className="absolute right-3 top-3 rounded-full bg-black/60 px-2 py-1 text-[11px] font-medium tabular-nums text-zinc-200 backdrop-blur">
            ×{item.count}
          </div>
        )}

        {/* Center: queue position OR progress OR eta */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 text-center">
          {detail && (
            <span className="text-sm font-semibold text-zinc-200 tabular-nums">{detail}</span>
          )}
        </div>

        {/* Bottom: progress bar (when known) + prompt preview */}
        {progress !== null && (
          <div className="absolute inset-x-3 bottom-9 h-1 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full bg-primary transition-[width] duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
        <div className="absolute inset-x-3 bottom-3 line-clamp-1 text-[11px] leading-4 text-zinc-500">
          {item.prompt}
        </div>
      </div>
    );
  }

  if (item.kind === "error") {
    return (
      <div
        className="group relative overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-inset ring-destructive/40"
        style={{ aspectRatio: aspect }}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center">
          <IconAlertTriangle className="size-5 text-destructive" />
          <p className="line-clamp-3 text-[11px] leading-4 text-zinc-300">{item.message}</p>
          {onRetry && (
            <button
              type="button"
              onClick={() => onRetry(item.id)}
              className="mt-1 inline-flex items-center gap-1 rounded-full bg-zinc-800 px-3 py-1 text-[11px] font-medium text-zinc-200 transition-colors hover:bg-zinc-700"
            >
              <IconRefresh className="size-3" />
              <span>{t("imageLab.cell.retry", "Retry")}</span>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen?.(item.id)}
      className="group relative block overflow-hidden rounded-xl bg-zinc-900 text-left"
      style={{ aspectRatio: aspect }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- OSS/Azure URLs vary; thumbnail grid doesn't benefit from optimization */}
      <img
        src={item.url}
        alt={item.prompt}
        loading="lazy"
        className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
      />
      {/* Hover overlay — prompt preview + quick actions */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/0 to-black/0 opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="pointer-events-none absolute inset-x-3 bottom-3 line-clamp-2 text-[11px] leading-4 text-white opacity-0 transition-opacity group-hover:opacity-100">
        {item.prompt}
      </div>
      <a
        href={item.url}
        download
        onClick={(e) => e.stopPropagation()}
        aria-label={t("imageLab.cell.download", "Download")}
        className="pointer-events-auto absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-full bg-black/60 text-white opacity-0 backdrop-blur transition-opacity hover:bg-black/80 group-hover:opacity-100"
      >
        <IconDownload className="size-3.5" />
      </a>
    </button>
  );
}

function aspectFromRatio(ratio: string): string {
  if (!ratio || ratio === "auto") return "1 / 1";
  const [w, h] = ratio.split(":").map(Number);
  if (!w || !h) return "1 / 1";
  return `${w} / ${h}`;
}

function labelForStage(
  stage: string | undefined,
  t: (key: string, fallback?: string) => string
): string {
  switch (stage) {
    case "running":
    case "provider_running":
      return t("imageLab.stage.running", "Running");
    case "uploading":
    case "oss_uploading":
      return t("imageLab.stage.uploading", "Uploading");
    case "fetching":
      return t("imageLab.stage.fetching", "Fetching");
    case "queued":
    default:
      return t("imageLab.cell.queued", "Queued");
  }
}

function detailForQueued(
  item: Extract<GalleryItem, { kind: "queued" }>,
  t: (key: string, fallback?: string) => string
): string | null {
  if (typeof item.queuePosition === "number" && item.queuePosition > 0) {
    return t("imageLab.queue.position", "#{n} in line").replace("{n}", String(item.queuePosition));
  }
  if (typeof item.etaSeconds === "number" && item.etaSeconds > 0) {
    return `~${formatSeconds(item.etaSeconds)}`;
  }
  return null;
}

function clampProgress(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !isFinite(value)) return null;
  if (value <= 0) return null;
  return Math.min(100, Math.max(0, value));
}

function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}
