"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { gsap } from "gsap";
import { Flip } from "gsap/Flip";
import { useGSAP } from "@gsap/react";
import {
  IconAlertTriangle,
  IconCircleDashed,
  IconDownload,
  IconRefresh,
} from "@tabler/icons-react";

// `useGSAP` handles plugin registration timing safely and is Strict-
// Mode safe (auto-reverts on cleanup). We still register Flip once
// at module load — `registerPlugin` is idempotent.
gsap.registerPlugin(useGSAP, Flip);

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

// JS masonry — pure CSS `grid-template-rows: masonry` is Safari-only
// as of 2026Q2 (Chrome ships a different proposal); the value is
// silently ignored on Chrome and the grid collapses into rectangular
// rows. We compute layout ourselves: choose column count from
// container width, walk items in submission order, drop each into
// the currently shortest column. Heights come from each item's
// known aspect ratio so no DOM measurement is needed.
const CELL_TARGET_WIDTH = 240;
const CELL_GAP_PX = 6;
const CONTAINER_MAX_WIDTH = 1800;
const CONTAINER_PADDING_X = 80;

interface PositionedItem {
  item: GalleryItem;
  left: number;
  top: number;
  width: number;
  height: number;
}

function parseRatio(ratio: string): number {
  if (!ratio || ratio === "auto") return 1;
  const [w, h] = ratio.split(":").map(Number);
  if (!w || !h) return 1;
  return w / h;
}

function useMeasuredWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export function GalleryGrid({ items, onRetry, onOpen, t }: GalleryGridProps) {
  const [containerRef, containerWidth] = useMeasuredWidth();
  // Scope ref for useGSAP — all selector strings ("[data-flip-id]")
  // resolve relative to this element; cleanup runs scoped too, so
  // we never touch animations from sibling components.
  const scope = useRef<HTMLDivElement | null>(null);
  // Track previous item ID set to know whether positions are about
  // to change (insert / remove / re-order / resize → new layout).
  const prevItemKeyRef = useRef<string>("");
  // Cache the Flip state captured *before* a positions change. We
  // grab it during render (synchronously) so the DOM still reflects
  // old positions; the next useGSAP run consumes it.
  const pendingFlipStateRef = useRef<ReturnType<typeof Flip.getState> | null>(null);

  const { positioned, totalHeight } = useMemo(() => {
    if (!containerWidth || items.length === 0) {
      return { positioned: [] as PositionedItem[], totalHeight: 0 };
    }
    const maxByWidth = Math.max(
      1,
      Math.floor((containerWidth + CELL_GAP_PX) / (CELL_TARGET_WIDTH + CELL_GAP_PX))
    );
    const cols = Math.max(1, Math.min(items.length, maxByWidth));
    const colWidth = (containerWidth - (cols - 1) * CELL_GAP_PX) / cols;
    const colHeights = new Array<number>(cols).fill(0);
    const placed: PositionedItem[] = items.map((item) => {
      const ratio = parseRatio(item.ratio);
      const h = colWidth / ratio;
      let shortest = 0;
      for (let i = 1; i < cols; i++) {
        if (colHeights[i] < colHeights[shortest]) shortest = i;
      }
      const left = shortest * (colWidth + CELL_GAP_PX);
      const top = colHeights[shortest];
      colHeights[shortest] = top + h + CELL_GAP_PX;
      return { item, left, top, width: colWidth, height: h };
    });
    return {
      positioned: placed,
      totalHeight: Math.max(0, ...colHeights) - CELL_GAP_PX,
    };
  }, [items, containerWidth]);

  const itemKey = positioned.map((p) => p.item.id).join("|");
  // Capture old bounding rects *now*, before React commits the new
  // positions. We're inside render but only reading DOM (no writes /
  // no state updates) — this is the standard Flip pattern. The
  // captured state is consumed in the useGSAP block below.
  if (scope.current && prevItemKeyRef.current !== "" && prevItemKeyRef.current !== itemKey) {
    const cells = scope.current.querySelectorAll<HTMLElement>("[data-flip-id]");
    if (cells.length > 0) {
      pendingFlipStateRef.current = Flip.getState(cells);
    }
  }

  useGSAP(
    () => {
      const cells = gsap.utils.toArray<HTMLElement>("[data-flip-id]");
      if (cells.length === 0) return;

      const isFirstPaint = prevItemKeyRef.current === "";
      prevItemKeyRef.current = itemKey;

      if (isFirstPaint) {
        // Initial mount: staggered fade-up entry.
        gsap.from(cells, {
          opacity: 0,
          y: 18,
          scale: 0.96,
          duration: 0.45,
          ease: "power2.out",
          stagger: 0.04,
        });
        return;
      }

      // Layout change: tween every cell from old bbox to new bbox.
      const state = pendingFlipStateRef.current;
      pendingFlipStateRef.current = null;
      if (!state) return;
      Flip.from(state, {
        duration: 0.5,
        ease: "power2.out",
        absolute: false,
        scale: false,
        onEnter: (els) =>
          gsap.from(els, {
            opacity: 0,
            scale: 0.92,
            duration: 0.35,
            ease: "power2.out",
          }),
        onLeave: (els) =>
          gsap.to(els, {
            opacity: 0,
            scale: 0.92,
            duration: 0.25,
            ease: "power2.in",
          }),
      });
    },
    // Re-run when the item set or layout changes. `useGSAP` reverts
    // any previously-created tweens on cleanup, so re-runs don't
    // stack ghost animations.
    { scope, dependencies: [itemKey, containerWidth] }
  );

  return (
    <div
      className="mx-auto w-full"
      style={{
        maxWidth: `${CONTAINER_MAX_WIDTH}px`,
        paddingInline: `${CONTAINER_PADDING_X}px`,
      }}
    >
      <div
        ref={(el) => {
          containerRef.current = el;
          scope.current = el;
        }}
        className="relative w-full"
        style={{ height: `${totalHeight}px` }}
      >
        {positioned.map(({ item, left, top, width, height }) => (
          <div
            key={item.id}
            data-flip-id={item.id}
            className="absolute"
            style={{ left, top, width, height }}
          >
            <GalleryCell item={item} onRetry={onRetry} onOpen={onOpen} t={t} />
          </div>
        ))}
      </div>
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
  if (item.kind === "queued") {
    const stageLabel = labelForStage(item.stage, t);
    const detail = detailForQueued(item, t);
    const progress = clampProgress(item.progress);
    return (
      <div className="relative block size-full overflow-hidden rounded-xl bg-zinc-900">
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
      <div className="group relative block size-full overflow-hidden rounded-xl bg-zinc-900 ring-1 ring-inset ring-destructive/40">
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
      className="group relative block size-full overflow-hidden rounded-xl bg-zinc-900 text-left"
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

function labelForStage(
  stage: string | undefined,
  t: (key: string, fallback?: string) => string
): string {
  // Stage names mirror server's AiJobStage enum. Grouping rationale:
  //   queued / created           → user-visible "排队中"
  //   validating .. generating   → "生成中" (the long-running phase
  //                                 the user actually waits for)
  //   fetching_output            → "拉取中"
  //   uploading_to_oss           → "上传中"
  switch (stage) {
    case "validating":
    case "calling_provider":
    case "provider_queued":
    case "generating":
    case "running":
    case "provider_running":
      return t("imageLab.stage.running", "Generating");
    case "fetching_output":
    case "fetching":
      return t("imageLab.stage.fetching", "Fetching");
    case "uploading_to_oss":
    case "uploading":
    case "oss_uploading":
      return t("imageLab.stage.uploading", "Uploading");
    case "created":
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
