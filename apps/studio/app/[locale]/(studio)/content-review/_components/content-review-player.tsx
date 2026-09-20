"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  IconLoader2,
  IconMessagePlus,
  IconPlayerPause,
  IconPlayerPlay,
  IconX,
} from "@tabler/icons-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useMediaPlaybackSource } from "@/components/media/use-media-playback-source";
import {
  findingsNearTime,
  formatReviewTimecode,
  type ReviewFinding,
} from "@/lib/content-review-findings";

export function ContentReviewPlayer({
  src,
  mediaAssetId,
  findings,
  selectedId,
  onSelect,
  onDuration,
  onTime,
  onCommentRequest,
  onRemove,
  canRemove,
  canComment,
}: {
  src: string;
  mediaAssetId?: string | null;
  findings: ReviewFinding[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDuration: (seconds: number | null) => void;
  onTime?: (seconds: number) => void;
  onCommentRequest?: () => void;
  onRemove: () => void;
  canRemove: boolean;
  canComment?: boolean;
}) {
  const t = useTranslations("studioModes.contentReview");
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const playback = useMediaPlaybackSource(
    mediaAssetId ? `/aurora/media/assets/${encodeURIComponent(mediaAssetId)}/access` : src,
    Boolean(mediaAssetId),
    mediaAssetId ?? undefined
  );
  const videoSrc = mediaAssetId ? playback.src : src;

  const selected = findings.find((finding) => finding.id === selectedId) ?? null;
  const nearby = findingsNearTime(findings, current);
  const overlay = playing
    ? nearby
    : selected && selected.seconds != null
      ? [selected, ...nearby.filter((finding) => finding.id !== selected.id)]
      : nearby;
  const timed = findings.filter((finding) => finding.seconds != null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || selected?.seconds == null) return;
    video.currentTime = selected.seconds;
    video.pause();
    setPlaying(false);
    setCurrent(selected.seconds);
    onTime?.(selected.seconds);
  }, [selected?.id, selected?.seconds]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  };

  const seekRatio = (ratio: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(duration) || duration <= 0) return;
    const next = Math.min(duration, Math.max(0, ratio * duration));
    video.currentTime = next;
    setCurrent(next);
  };

  return (
    <div className="relative flex min-h-[min(62dvh,760px)] max-h-[min(82dvh,920px)] items-center justify-center overflow-hidden rounded-xl bg-black">
      {mediaAssetId && playback.error ? (
        <div className="px-6 text-center text-sm text-white/70">{t("playbackFailed")}</div>
      ) : mediaAssetId && !videoSrc ? (
        <div className="text-white/70">
          <IconLoader2 className="size-6 animate-spin" stroke={1.8} />
          <span className="sr-only">{t("playbackLoading")}</span>
        </div>
      ) : (
        <video
          ref={videoRef}
          src={videoSrc ?? undefined}
          className="max-h-[min(82dvh,920px)] w-full object-contain"
          onClick={togglePlay}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) => {
            const next = event.currentTarget.currentTime;
            setCurrent(next);
            onTime?.(next);
          }}
          onLoadedMetadata={(event) => {
            const next = event.currentTarget.duration;
            if (Number.isFinite(next) && next > 0) {
              setDuration(next);
              onDuration(Math.max(1, Math.ceil(next)));
            } else {
              setDuration(0);
              onDuration(null);
            }
          }}
        />
      )}

      {overlay.length > 0 ? (
        <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-col items-start gap-2">
          {overlay.map((finding) => (
            <div
              key={finding.id}
              className="max-w-[min(100%,28rem)] rounded-lg bg-black/70 px-2.5 py-1.5 text-left text-xs text-white"
            >
              <p className="font-medium">
                {finding.seconds != null ? formatReviewTimecode(finding.seconds) : t("untimed")}
                {finding.label ? ` · ${finding.label}` : ""}
              </p>
              {finding.description ? (
                <p className="mt-0.5 line-clamp-2 text-white/75">{finding.description}</p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {canRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={t("remove")}
          className="absolute top-3 right-3 z-10 flex size-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
        >
          <IconX className="size-4" stroke={1.8} />
        </button>
      ) : null}

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-3 pt-10 pb-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? t("pause") : t("play")}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/16"
          >
            {playing ? (
              <IconPlayerPause className="size-4" stroke={1.8} />
            ) : (
              <IconPlayerPlay className="size-4" stroke={1.8} />
            )}
          </button>
          <span className="w-10 shrink-0 text-[11px] tabular-nums text-white/70">
            {formatReviewTimecode(current)}
          </span>
          <div
            className="relative h-6 min-w-0 flex-1"
            onClick={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              if (rect.width <= 0) return;
              seekRatio((event.clientX - rect.left) / rect.width);
            }}
          >
            <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-white/80"
                style={{
                  width: duration > 0 ? `${Math.min(100, (current / duration) * 100)}%` : "0%",
                }}
              />
            </div>
            {timed.map((finding, index) => {
              const left = duration > 0 ? ((finding.seconds ?? 0) / duration) * 100 : 0;
              const active = finding.id === selectedId;
              const title =
                finding.label?.trim() || finding.description?.trim() || t("findingUntitled");
              return (
                <Tooltip key={finding.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={t("seekFinding", {
                        index: index + 1,
                        time: formatReviewTimecode(finding.seconds ?? 0),
                      })}
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelect(finding.id);
                      }}
                      className={cn(
                        "absolute top-1/2 flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center",
                        active ? "z-10" : "z-0"
                      )}
                      style={{ left: `${left}%` }}
                    >
                      <span
                        className={cn(
                          "size-2.5 rounded-full",
                          active
                            ? "bg-primary"
                            : finding.source === "comment"
                              ? "bg-[var(--brand-blue)]"
                              : "bg-[var(--brand-yellow)]"
                        )}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent
                    side="top"
                    sideOffset={8}
                    className="flex max-w-64 flex-col items-start gap-0.5 py-2 text-left"
                  >
                    <p className="font-medium">
                      {formatReviewTimecode(finding.seconds ?? 0)}
                      {` · ${title}`}
                    </p>
                    <p className="text-muted-foreground">{sourceLabel(finding.source, t)}</p>
                    {finding.description && finding.label ? (
                      <p className="line-clamp-3 text-white/70">{finding.description}</p>
                    ) : null}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
          <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-white/70">
            {formatReviewTimecode(duration)}
          </span>
          {canComment ? (
            <button
              type="button"
              onClick={() => {
                const video = videoRef.current;
                if (video && !video.paused) video.pause();
                onCommentRequest?.();
              }}
              aria-label={t("commentAt", { time: formatReviewTimecode(current) })}
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/16"
            >
              <IconMessagePlus className="size-4" stroke={1.8} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function sourceLabel(
  source: ReviewFinding["source"],
  t: ReturnType<typeof useTranslations>
): string {
  if (source === "audio") return t("sourceAudio");
  if (source === "frame") return t("sourceFrame");
  if (source === "comment") return t("sourceComment");
  return t("sourceOther");
}
