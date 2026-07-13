"use client";

import { useCallback, useState, type SyntheticEvent } from "react";
import { useTranslations } from "next-intl";
import { IconDownload, IconVideoOff } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

/**
 * Detects that a <video> failed to play back (e.g. 4K 10-bit H.265 output the
 * browser has no decoder for — Firefox, software-decode Chrome). The reliable
 * signal is the element's `error` MediaError via onError; `canPlayType` is
 * advisory only (returns "" even for playable streams), so we never gate the
 * playback attempt on it. Resets whenever `src` changes.
 */
export function useVideoPlaybackError(src: string | undefined): {
  failed: boolean;
  onError: (event: SyntheticEvent<HTMLVideoElement>) => void;
} {
  // Failure is stamped with the src it happened for and derived by comparison,
  // so a src change resets the state automatically (no effect needed).
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  const onError = useCallback(
    (event: SyntheticEvent<HTMLVideoElement>) => {
      // Only a real MediaError counts — React also forwards error events fired
      // when a source is detached (no `error` object), which is not a failure.
      if (event.currentTarget.error) setFailedSrc(src ?? "");
    },
    [src]
  );

  return { failed: failedSrc != null && failedSrc === src, onError };
}

/**
 * Overlay shown over a <video> whose stream the browser cannot decode — the
 * file itself is fine and downloadable. Mount it only when
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
}: {
  compact?: boolean;
  onDownload?: () => void;
  downloadUrl?: string;
  downloadName?: string;
  className?: string;
}) {
  const t = useTranslations("generation");

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
          {t("previewUnsupported")}
        </span>
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
        <p className="text-sm leading-relaxed text-white/70">{t("previewUnsupportedHint")}</p>
        {downloadAction}
      </div>
    </div>
  );
}
