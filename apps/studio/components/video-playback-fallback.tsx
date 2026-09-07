"use client";

import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from "react";
import { useTranslations } from "next-intl";
import { IconDownload, IconRefresh, IconVideoOff } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

/**
 * Tracks real MediaErrors, retries transient network failures twice, and clears
 * the failure when playback recovers. Never gates playback on canPlayType:
 * that advisory check can reject streams the browser can actually play.
 */
export function useVideoPlaybackError(src: string | undefined): {
  failed: boolean;
  errorCode: number | undefined;
  onError: (event: SyntheticEvent<HTMLVideoElement>) => void;
  onCanPlay: () => void;
  reset: () => void;
} {
  // Failure is stamped with the src it happened for and derived by comparison,
  // so a src change resets the state automatically (no effect needed).
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<number>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const attempts = useRef(0);
  const failedVideo = useRef<HTMLVideoElement | null>(null);

  const reset = useCallback(() => {
    clearTimeout(timer.current);
    setFailedSrc(null);
    setErrorCode(undefined);
  }, []);

  useEffect(() => {
    attempts.current = 0;
    return () => {
      clearTimeout(timer.current);
      failedVideo.current?.removeEventListener("canplay", reset);
    };
  }, [src, reset]);

  const onError = useCallback(
    (event: SyntheticEvent<HTMLVideoElement>) => {
      // Only a real MediaError counts — React also forwards error events fired
      // when a source is detached (no `error` object), which is not a failure.
      const video = event.currentTarget;
      if (!video.error) return;
      const code = video.error.code;
      failedVideo.current?.removeEventListener("canplay", reset);
      failedVideo.current = video;
      video.addEventListener("canplay", reset, { once: true });
      setErrorCode(code);
      setFailedSrc(src ?? "");
      // A stalled network is recoverable. Never loop on a codec/format error.
      if (code === 2 && attempts.current < 2) {
        const delay = 500 * 2 ** attempts.current++;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          if (video.isConnected) video.load();
        }, delay);
      }
    },
    [src, reset]
  );

  return {
    failed: failedSrc != null && failedSrc === src,
    errorCode,
    onError,
    onCanPlay: reset,
    reset,
  };
}

/**
 * Recoverable playback failure. Only explicit codec errors claim that the
 * browser cannot decode the file. Mount it only when
 * `useVideoPlaybackError` reports failure, inside the video's `relative`
 * container.
 *
 * - `compact`: small tiles / thumbnails — icon + short label, pointer-events
 *   pass through so the tile's own click/hover affordances keep working.
 * - default (large surfaces): frosted panel with the full one-line message and
 *   a Download action — pass `onDownload` to reuse the surface's download
 *   helper, or `downloadUrl` (+ optional `downloadName`) for a plain anchor.
 */
export function VideoPlaybackFallback({
  compact = false,
  onDownload,
  downloadUrl,
  downloadName,
  className,
  onRetry,
  errorCode,
  message,
}: {
  compact?: boolean;
  onDownload?: () => void;
  downloadUrl?: string;
  downloadName?: string;
  className?: string;
  onRetry?: () => void;
  errorCode?: number;
  message?: string;
}) {
  const t = useTranslations("generation");
  const tc = useTranslations("common");
  const retryAction = onRetry ? (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onRetry();
      }}
      className="pointer-events-auto flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-xs text-white/85"
    >
      <IconRefresh className="size-3.5" />
      {tc("retry")}
    </button>
  ) : null;

  if (compact) {
    return (
      <div
        className={cn(
          "pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/55 backdrop-blur-sm",
          className
        )}
      >
        <IconVideoOff className="size-5 text-white/55" stroke={1.6} />
        <span className="px-3 text-center text-[11px] leading-4 text-white/65">
          {message || t("previewUnsupported")}
        </span>
        {retryAction}
      </div>
    );
  }

  const downloadAction = onDownload ? (
    <button
      type="button"
      onClick={onDownload}
      className="pointer-events-auto flex h-8 items-center gap-1.5 rounded-full bg-white/[0.08] px-3 text-xs font-medium text-white/85 transition-colors hover:bg-white/[0.14] hover:text-white"
    >
      <IconDownload className="size-3.5" stroke={2} />
      {t("download")}
    </button>
  ) : downloadUrl ? (
    <a
      href={downloadUrl}
      download={downloadName ?? true}
      className="pointer-events-auto flex h-8 items-center gap-1.5 rounded-full bg-white/[0.08] px-3 text-xs font-medium text-white/85 transition-colors hover:bg-white/[0.14] hover:text-white"
    >
      <IconDownload className="size-3.5" stroke={2} />
      {t("download")}
    </a>
  ) : null;

  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 flex items-center justify-center p-6",
        className
      )}
    >
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl bg-white/[0.06] px-6 py-5 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur-xl">
        <IconVideoOff className="size-7 text-white/50" stroke={1.5} />
        <p className="text-sm leading-relaxed text-white/70">
          {message || t(errorCode === 3 ? "previewUnsupportedHint" : "previewLoadFailed")}
        </p>
        {retryAction}
        {downloadAction}
      </div>
    </div>
  );
}
