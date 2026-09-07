"use client";

import { useEffect, useRef, useState, type MouseEventHandler } from "react";
import { IconPlayerPlay } from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import { useVideoPlaybackError, VideoPlaybackFallback } from "@/components/video-playback-fallback";
import { cn } from "@/lib/utils";
import { useCanvasDocumentId } from "@/components/canvas/authoring/canvas-document-context";
import { acquireVideoPoster } from "./video-poster";
import { useMediaPlaybackSource } from "./use-media-playback-source";

let playingVideo: { element: HTMLVideoElement; stop: () => void } | null = null;

/** First frames are images; only an explicit/hover preview owns a live player. */
export function CanvasVideo({
  src,
  assetId,
  documentId,
  thumbnail = false,
  hoverPlay = false,
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
  hoverPlay?: boolean;
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
  const [poster, setPoster] = useState<{ src: string; url: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [posterFailure, setPosterFailure] = useState<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const position = useRef(0);
  const ratioCallback = useRef(onLoadedRatio);
  useEffect(() => {
    ratioCallback.current = onLoadedRatio;
  }, [onLoadedRatio]);
  const inheritedDocumentId = useCanvasDocumentId();
  const source = useMediaPlaybackSource(src, visible, assetId, documentId ?? inheritedDocumentId);
  const playback = useVideoPlaybackError(source.src);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      setVisible(entry.isIntersecting);
      if (!entry.isIntersecting) {
        clearTimeout(hoverTimer.current);
        setActive(false);
      }
    });
    if (container.current) observer.observe(container.current);
    return () => {
      observer.disconnect();
      clearTimeout(hoverTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!visible || !source.src || active) return;
    let cancelled = false;
    const request = acquireVideoPoster(source.src);
    request.promise
      .then((image) => {
        if (cancelled) return;
        setPoster({ src, url: image.url });
        setPosterFailure(null);
        ratioCallback.current?.(`${image.width} / ${image.height}`);
      })
      .catch(() => {
        if (!cancelled) setPosterFailure(src);
      });
    return () => {
      cancelled = true;
      request.release();
    };
  }, [visible, source.src, src, attempt, active]);

  useEffect(() => {
    const hide = () => {
      if (document.hidden) {
        clearTimeout(hoverTimer.current);
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
      if (playingVideo?.element === element) playingVideo = null;
      element.pause();
      element.removeAttribute("src");
      element.load();
    };
  }, [visible, active, source.src, attempt]);

  const retry = async () => {
    playback.reset();
    setPosterFailure(null);
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
      onMouseEnter={() => {
        if (hoverPlay && !thumbnail)
          hoverTimer.current = setTimeout(() => {
            setShouldPlay(true);
            setActive(true);
          }, 260);
      }}
      onMouseLeave={() => {
        clearTimeout(hoverTimer.current);
        if (hoverPlay) setActive(false);
      }}
    >
      {poster?.src === src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={poster.url}
          alt=""
          draggable={false}
          className="absolute inset-0 size-full object-contain"
        />
      ) : (
        <span className="absolute inset-0 grid place-items-center text-white/40">
          <IconPlayerPlay className="size-6" />
        </span>
      )}
      {!thumbnail && !active && (
        <button
          type="button"
          aria-label={t("media.preview")}
          className="nodrag absolute inset-0 grid place-items-center text-white/85"
          onClick={(event) => {
            event.stopPropagation();
            setShouldPlay(true);
            setActive(true);
          }}
        >
          <span className="grid size-9 place-items-center rounded-full bg-black/45">
            <IconPlayerPlay className="size-5" />
          </span>
        </button>
      )}
      {visible && active && source.src && (
        <video
          key={`${source.src}:${attempt}`}
          ref={video}
          src={source.src}
          autoPlay={shouldPlay}
          controls
          muted={muted}
          playsInline
          loop={hoverPlay}
          preload="metadata"
          draggable={false}
          className="nodrag nowheel absolute inset-0 size-full object-contain"
          onError={playback.onError}
          onCanPlay={playback.onCanPlay}
          onTimeUpdate={(event) => {
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
      {(playback.failed || source.error || (thumbnail && posterFailure === src)) && (
        <VideoPlaybackFallback
          compact
          onRetry={thumbnail ? undefined : () => void retry()}
          errorCode={playback.errorCode}
          message={source.error?.message}
        />
      )}
    </div>
  );
}
