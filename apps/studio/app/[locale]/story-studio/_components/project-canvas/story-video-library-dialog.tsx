"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconAlertTriangle,
  IconCheck,
  IconClock,
  IconLibrary,
  IconLoader2,
  IconMovie,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
} from "@tabler/icons-react";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  listStoryVideoLibrary,
  storyApiErrorMessage,
  type FilmClipSummary,
  type FilmCurrentVideo,
  type StoryVideoLibraryItem,
} from "@/lib/story-projects-api";
import {
  mergeStoryVideoLibraryItems,
  resolveStoryVideoLibraryItemState,
  storyVideoLibraryItemKey,
} from "./story-video-library-model";

const VIDEO_LIBRARY_PAGE_SIZE = 30;

export interface StoryVideoLibraryDialogProps {
  workspaceId: string;
  projectId: string;
  outputContract: FilmClipSummary["outputContract"];
  currentVideo: FilmCurrentVideo | null;
  disabled?: boolean;
  disabledReason?: string | null;
  onSelect: (item: StoryVideoLibraryItem) => Promise<void>;
}

/**
 * Shared Clip/Trailer history picker. It never swaps the visible current video
 * optimistically: the dialog remains open until the server's CAS mutation and
 * the caller's workbench refresh both succeed.
 */
export function StoryVideoLibraryDialog({
  workspaceId,
  projectId,
  outputContract,
  currentVideo,
  disabled = false,
  disabledReason,
  onSelect,
}: StoryVideoLibraryDialogProps) {
  const t = useTranslations("storyStudio.canvas.production.videoLibrary");
  const locale = useLocale();
  const requestEpochRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<StoryVideoLibraryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectingKey, setSelectingKey] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(
    () => () => {
      requestEpochRef.current += 1;
    },
    []
  );

  const loadPage = useCallback(
    async (cursor: string | undefined, replace: boolean) => {
      const epoch = ++requestEpochRef.current;
      if (replace) setInitialLoading(true);
      else setLoadingMore(true);
      setLoadError(null);
      try {
        const page = await listStoryVideoLibrary(workspaceId, projectId, {
          cursor,
          limit: VIDEO_LIBRARY_PAGE_SIZE,
        });
        if (requestEpochRef.current !== epoch) return;
        setItems((current) =>
          replace ? page.items : mergeStoryVideoLibraryItems(current, page.items)
        );
        setNextCursor(page.nextCursor);
      } catch (error) {
        if (requestEpochRef.current !== epoch) return;
        setLoadError(storyApiErrorMessage(error, t("errors.load")));
      } finally {
        if (requestEpochRef.current === epoch) {
          setInitialLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [projectId, t, workspaceId]
  );

  const currentSelection = currentVideo
    ? { assetId: currentVideo.asset.id, variantId: currentVideo.variantId }
    : null;

  const selectItem = async (item: StoryVideoLibraryItem) => {
    const itemKey = storyVideoLibraryItemKey(item);
    const state = resolveStoryVideoLibraryItemState(item, outputContract, currentSelection);
    if (!state.selectable || state.current || selectingKey) return;

    setSelectingKey(itemKey);
    setSelectionError(null);
    try {
      await onSelect(item);
      requestEpochRef.current += 1;
      setOpen(false);
    } catch (error) {
      setSelectionError(storyApiErrorMessage(error, t("errors.select")));
    } finally {
      setSelectingKey(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (selectingKey) return;
        if (nextOpen) {
          setItems([]);
          setNextCursor(null);
          setSelectionError(null);
          setOpen(true);
          void loadPage(undefined, true);
          return;
        }
        requestEpochRef.current += 1;
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="secondary"
          size="icon-lg"
          disabled={disabled}
          aria-label={t("trigger")}
          title={disabledReason ?? t("trigger")}
          className="size-10 rounded-xl bg-white/[0.08] text-white/72 hover:bg-white/[0.12] hover:text-white"
        >
          <IconLibrary className="size-4" stroke={1.8} />
          <span className="sr-only">{t("trigger")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[min(820px,calc(100vh-2rem))] w-[min(1080px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden rounded-[26px] bg-[oklch(0.19_0_0/0.98)] p-0 shadow-[0_34px_140px_rgba(0,0,0,0.72)] backdrop-blur-[48px]">
        <DialogHeader className="shrink-0 px-6 pt-6 pr-16 pb-5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-white/[0.08] text-white/72">
              <IconLibrary className="size-5" stroke={1.7} />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold text-white/92">
                {t("title")}
              </DialogTitle>
              <DialogDescription className="mt-1 max-w-2xl text-[11px] leading-5 text-white/42">
                {t("description", {
                  width: outputContract.width,
                  height: outputContract.height,
                  duration: formatDuration(outputContract.durationMs / 1_000),
                  tolerance: formatDuration(outputContract.durationToleranceMs / 1_000),
                })}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="h-px shrink-0 bg-white/[0.06]" />

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {selectionError ? (
            <StoryVideoLibraryError message={selectionError} className="mb-4" />
          ) : null}

          {initialLoading ? (
            <div
              className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
              role="status"
              aria-live="polite"
              aria-label={t("loading")}
            >
              {Array.from({ length: 6 }, (_, index) => (
                <div
                  key={index}
                  className="overflow-hidden rounded-[20px] bg-white/[0.045]"
                  aria-hidden="true"
                >
                  <div className="aspect-video animate-pulse bg-white/[0.055]" />
                  <div className="space-y-2 p-3">
                    <div className="h-3 w-2/3 animate-pulse rounded-full bg-white/[0.06]" />
                    <div className="h-8 animate-pulse rounded-xl bg-white/[0.05]" />
                  </div>
                </div>
              ))}
            </div>
          ) : items.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item, index) => (
                <StoryVideoLibraryCard
                  key={storyVideoLibraryItemKey(item)}
                  item={item}
                  index={index}
                  locale={locale}
                  outputContract={outputContract}
                  currentSelection={currentSelection}
                  selecting={selectingKey === storyVideoLibraryItemKey(item)}
                  selectionLocked={selectingKey !== null}
                  reducedMotion={reducedMotion}
                  onSelect={() => void selectItem(item)}
                />
              ))}
            </div>
          ) : loadError ? (
            <div className="grid min-h-64 place-items-center">
              <div className="max-w-sm text-center">
                <StoryVideoLibraryError message={loadError} />
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  className="mt-4 rounded-xl"
                  onClick={() => void loadPage(undefined, true)}
                >
                  <IconRefresh className="size-4" />
                  {t("retry")}
                </Button>
              </div>
            </div>
          ) : (
            <div
              className="grid min-h-64 place-items-center text-center"
              role="status"
              aria-live="polite"
            >
              <div className="max-w-sm">
                <span className="mx-auto grid size-12 place-items-center rounded-[18px] bg-white/[0.055] text-white/30">
                  <IconMovie className="size-5" stroke={1.6} />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-white/72">{t("empty.title")}</h3>
                <p className="mt-2 text-[11px] leading-5 text-white/38">{t("empty.description")}</p>
              </div>
            </div>
          )}

          {items.length > 0 && loadError ? (
            <StoryVideoLibraryError message={loadError} className="mt-4" />
          ) : null}
        </div>

        {nextCursor ? (
          <div className="shrink-0 px-6 pb-6 pt-2">
            <Button
              type="button"
              variant="secondary"
              size="xl"
              disabled={loadingMore || selectingKey !== null}
              className="w-full rounded-xl bg-white/[0.07]"
              onClick={() => void loadPage(nextCursor, false)}
            >
              {loadingMore ? <IconLoader2 className="size-4 animate-spin" /> : null}
              {loadingMore ? t("loadingMore") : t("loadMore")}
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function StoryVideoLibraryCard({
  item,
  index,
  locale,
  outputContract,
  currentSelection,
  selecting,
  selectionLocked,
  reducedMotion,
  onSelect,
}: {
  item: StoryVideoLibraryItem;
  index: number;
  locale: string;
  outputContract: FilmClipSummary["outputContract"];
  currentSelection: { assetId: string; variantId: string } | null;
  selecting: boolean;
  selectionLocked: boolean;
  reducedMotion: boolean;
  onSelect: () => void;
}) {
  const t = useTranslations("storyStudio.canvas.production.videoLibrary");
  const state = resolveStoryVideoLibraryItemState(item, outputContract, currentSelection);
  const primaryIssue = state.issues[0];
  const width = item.width ?? item.asset.width;
  const height = item.height ?? item.asset.height;
  const durationSeconds = item.durationSeconds ?? item.asset.durationSeconds;

  return (
    <article
      className={cn(
        "overflow-hidden rounded-[20px] bg-white/[0.045] transition-colors",
        state.current ? "bg-white/[0.105]" : "hover:bg-white/[0.07]"
      )}
    >
      <div className="relative aspect-video overflow-hidden bg-black/35">
        {item.asset.previewUrl ? (
          <StoryVideoLibraryPreview
            previewUrl={item.asset.previewUrl}
            playLabel={t("playPreview", { number: index + 1 })}
            pauseLabel={t("pausePreview", { number: index + 1 })}
            reducedMotion={reducedMotion}
          />
        ) : (
          <div className="grid size-full place-items-center text-white/26">
            <div className="text-center">
              <IconMovie className="mx-auto size-5" stroke={1.6} />
              <span className="mt-2 block text-[10px]">{t("previewUnavailable")}</span>
            </div>
          </div>
        )}
        {state.current ? (
          <span className="pointer-events-none absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/72 px-2 py-1 text-[9px] font-semibold text-white/88 backdrop-blur-md">
            <IconCheck className="size-3" stroke={2.2} />
            {t("current")}
          </span>
        ) : null}
        {!state.technicallyCompatible ? (
          <span className="pointer-events-none absolute top-2 right-2 flex items-center gap-1 rounded-full bg-black/72 px-2 py-1 text-[9px] font-semibold text-white/72 backdrop-blur-md">
            <IconAlertTriangle className="size-3" stroke={1.8} />
            {t("incompatible")}
          </span>
        ) : null}
      </div>

      <div className="p-3">
        <div className="flex items-center justify-between gap-3 text-[10px] text-white/48">
          <span className="truncate font-medium text-white/66">
            {new Intl.DateTimeFormat(locale, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(item.createdAt))}
          </span>
          <span className="shrink-0 tabular-nums">
            {width !== null && height !== null ? `${width}×${height}` : t("unknownDimensions")}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-1.5 text-[10px] text-white/38">
          <IconClock className="size-3" stroke={1.8} />
          <span className="tabular-nums">
            {durationSeconds === null ? t("unknownDuration") : formatDuration(durationSeconds)}
          </span>
          <span aria-hidden="true">·</span>
          <span className="truncate">{item.contentType}</span>
        </div>

        {primaryIssue ? (
          <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-4 text-white/44">
            <IconAlertTriangle className="mt-0.5 size-3 shrink-0" stroke={1.7} />
            <span>{t(`issues.${primaryIssue}`)}</span>
          </p>
        ) : null}

        <Button
          type="button"
          variant={state.current ? "ghost" : "secondary"}
          size="lg"
          disabled={!state.selectable || state.current || selectionLocked}
          className="mt-3 w-full rounded-xl"
          onClick={onSelect}
        >
          {selecting ? <IconLoader2 className="size-4 animate-spin" /> : null}
          {selecting
            ? t("selecting")
            : state.current
              ? t("current")
              : state.selectable
                ? t("select")
                : t("unavailable")}
        </Button>
      </div>
    </article>
  );
}

function StoryVideoLibraryPreview({
  previewUrl,
  playLabel,
  pauseLabel,
  reducedMotion,
}: {
  previewUrl: string;
  playLabel: string;
  pauseLabel: string;
  reducedMotion: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [explicitPlayback, setExplicitPlayback] = useState(false);

  const startPlayback = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused) {
      setPlaying(true);
      return;
    }
    try {
      await video.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
      setExplicitPlayback(false);
    }
  }, []);

  const stopPlayback = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    video.currentTime = 0;
    setPlaying(false);
  }, []);

  const startAutomaticPreview = () => {
    if (!reducedMotion) void startPlayback();
  };
  const stopAutomaticPreview = () => {
    if (!explicitPlayback) stopPlayback();
  };

  return (
    <button
      type="button"
      aria-label={playing ? pauseLabel : playLabel}
      aria-pressed={playing}
      className="group/preview relative size-full overflow-hidden text-white outline-none focus-visible:ring-2 focus-visible:ring-white/55 focus-visible:ring-inset"
      onPointerEnter={startAutomaticPreview}
      onPointerLeave={stopAutomaticPreview}
      onFocus={startAutomaticPreview}
      onBlur={() => {
        setExplicitPlayback(false);
        stopPlayback();
      }}
      onClick={() => {
        if (explicitPlayback) {
          setExplicitPlayback(false);
          stopPlayback();
          return;
        }
        setExplicitPlayback(true);
        void startPlayback();
      }}
    >
      <video
        ref={videoRef}
        src={previewUrl}
        muted
        loop
        playsInline
        preload="none"
        aria-hidden="true"
        className="size-full object-cover"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <span
        className={cn(
          "pointer-events-none absolute inset-0 grid place-items-center bg-black/12 transition-opacity",
          playing
            ? "opacity-0 group-hover/preview:opacity-100 group-focus-visible/preview:opacity-100"
            : "opacity-100"
        )}
      >
        <span className="grid size-9 place-items-center rounded-full bg-black/62 text-white/88 backdrop-blur-md">
          {playing ? (
            <IconPlayerPause className="size-4" fill="currentColor" />
          ) : (
            <IconPlayerPlay className="ml-0.5 size-4" fill="currentColor" />
          )}
        </span>
      </span>
    </button>
  );
}

function StoryVideoLibraryError({ message, className }: { message: string; className?: string }) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-2xl bg-destructive/10 px-3 py-2.5 text-[11px] leading-5 text-destructive",
        className
      )}
    >
      <IconAlertTriangle className="mt-0.5 size-4 shrink-0" stroke={1.8} />
      <span>{message}</span>
    </div>
  );
}

function formatDuration(seconds: number): string {
  const normalized = Math.max(0, seconds);
  return Number.isInteger(normalized) ? `${normalized}s` : `${normalized.toFixed(1)}s`;
}

function usePrefersReducedMotion(): boolean {
  const mediaQuery = "(prefers-reduced-motion: reduce)";
  const [reducedMotion, setReducedMotion] = useState(
    () => globalThis.window?.matchMedia?.(mediaQuery).matches ?? false
  );

  useEffect(() => {
    const media = globalThis.window?.matchMedia?.(mediaQuery);
    if (!media) return;
    const onChange = (event: MediaQueryListEvent) => setReducedMotion(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return reducedMotion;
}
