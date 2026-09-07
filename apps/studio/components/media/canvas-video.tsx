"use client";

import { useEffect, useRef, useState, type MouseEventHandler } from "react";
import { IconLoader2, IconPhotoOff, IconPlayerPlay } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { useVideoPlaybackError, VideoPlaybackFallback } from "@/components/video-playback-fallback";
import { cn } from "@/lib/utils";
import { useCanvasDocumentId } from "@/components/canvas/authoring/canvas-document-context";
import { useVideoPoster } from "./use-video-poster";
import { useMediaPlaybackSource } from "./use-media-playback-source";

let playingVideo: { element: HTMLVideoElement; stop: () => void } | null = null;

/** Posters outlive playback; only an explicit preview owns a live player. */
export function CanvasVideo({
  src,
  assetId,
  documentId,
  thumbnail = false,
  autoPlay = false,
  muted = !autoPlay,
  className,
  onLoadedRatio,
  onDoubleClick,
}: {
  src: string;
  assetId?: string;
  documentId?: string | null;
  thumbnail?: boolean;
  autoPlay?: boolean;
  muted?: boolean;
  className?: string;
  onLoadedRatio?: (ratio: string) => void;
  onDoubleClick?: MouseEventHandler<HTMLDivElement>;
}) {
  const t = useTranslations("canvasNodes");
  const container = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(autoPlay);
  const [active, setActive] = useState(autoPlay);
  const [shouldPlay, setShouldPlay] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [failedPoster, setFailedPoster] = useState<string | null>(null);
  const position = useRef(0);
  const ratioCallback = useRef(onLoadedRatio);
  useEffect(() => {
    ratioCallback.current = onLoadedRatio;
  }, [onLoadedRatio]);
  const inheritedDocumentId = useCanvasDocumentId();
  const poster = useVideoPoster(src, assetId, documentId ?? inheritedDocumentId, visible);
  const posterUrl = poster.data?.status === "ready" ? poster.data.url : undefined;
  const posterFailed = posterUrl
    ? failedPoster === posterUrl
    : poster.isError || poster.data?.status === "failed";
  const source = useMediaPlaybackSource(
    src,
    visible && active,
    assetId,
    documentId ?? inheritedDocumentId
  );
  const playback = useVideoPlaybackError(source.src);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting);
      if (!entry.isIntersecting) {
        setActive(false);
      }
    });
    if (container.current) observer.observe(container.current);
    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const hide = () => {
      if (document.hidden) {
        setActive(false);
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => document.removeEventListener("visibilitychange", hide);
  }, []);

  useEffect(() => {
    position.current = 0;
  }, [src]);

  useEffect(() => {
    const element = video.current;
    return () => {
      if (!element) return;
      if (element.readyState >= 1) position.current = element.currentTime;
      if (playingVideo?.element === element) playingVideo = null;
      element.pause();
      element.removeAttribute("src");
      element.load();
    };
  }, [visible, active, source.src, attempt]);

  const retry = async () => {
    playback.reset();
    setFailedPoster(null);
    void poster.refetch();
    await source.refresh();
    setAttempt((value) => value + 1);
    setShouldPlay(true);
    if (!thumbnail) setActive(true);
  };

  return (
    <div
      ref={container}
      data-media-asset-id={assetId}
      data-media-error-code={playback.failed ? playback.errorCode : undefined}
      className={cn("relative overflow-hidden bg-black/20", className)}
      onDoubleClick={onDoubleClick}
    >
      {posterUrl && !posterFailed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={posterUrl}
          alt=""
          draggable={false}
          onError={() => setFailedPoster(posterUrl)}
          className="pointer-events-none absolute inset-0 size-full object-contain"
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalWidth && image.naturalHeight)
              ratioCallback.current?.(`${image.naturalWidth} / ${image.naturalHeight}`);
          }}
        />
      ) : (
        <span className="pointer-events-none absolute inset-0 flex items-end justify-start p-3 text-white/40">
          {posterFailed ? (
            <IconPhotoOff aria-label={t("media.previewUnavailable")} className="size-4" />
          ) : (
            <IconLoader2 aria-label={t("media.preparingPreview")} className="size-4 animate-spin" />
          )}
        </span>
      )}
      {!thumbnail && !active && (
        <button
          type="button"
          aria-label={t("media.preview")}
          className="nodrag nopan absolute top-1/2 left-1/2 z-10 grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white/85 focus-visible:outline-2 focus-visible:outline-white"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (posterFailed) {
              setFailedPoster(null);
              void poster.refetch();
            }
            setShouldPlay(true);
            setActive(true);
          }}
        >
          <IconPlayerPlay className="size-5" />
        </button>
      )}
      {visible && active && source.src && (
        <video
          key={`${source.src}:${attempt}`}
          ref={video}
          src={source.src}
          poster={posterFailed ? undefined : posterUrl}
          autoPlay={shouldPlay}
          controls
          muted={muted}
          playsInline
          preload="metadata"
          draggable={false}
          className="nodrag nopan nowheel absolute inset-0 size-full object-contain"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onError={playback.onError}
          onCanPlay={playback.onCanPlay}
          onTimeUpdate={(event) => {
            if (event.currentTarget === video.current && event.currentTarget.readyState >= 1)
              position.current = event.currentTarget.currentTime;
          }}
          onLoadedMetadata={(event) => {
            const media = event.currentTarget;
            if (position.current && Number.isFinite(media.duration))
              media.currentTime = Math.min(position.current, media.duration);
            if (media.videoWidth && media.videoHeight)
              ratioCallback.current?.(`${media.videoWidth} / ${media.videoHeight}`);
          }}
          onPlay={(event) => {
            setShouldPlay(true);
            const previous = playingVideo;
            if (previous?.element === event.currentTarget) return;
            playingVideo = { element: event.currentTarget, stop: () => setActive(false) };
            previous?.element.pause();
            previous?.stop();
          }}
          onPause={(event) => {
            if (event.currentTarget === video.current) setShouldPlay(false);
          }}
        />
      )}
      {(playback.failed || source.error) && (
        <VideoPlaybackFallback
          compact
          className="nodrag nopan"
          onRetry={thumbnail ? undefined : () => void retry()}
          errorCode={playback.errorCode}
          message={source.error?.message}
        />
      )}
    </div>
  );
}
