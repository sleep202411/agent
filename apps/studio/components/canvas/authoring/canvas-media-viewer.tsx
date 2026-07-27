"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import { IconDownload, IconMinus, IconPlus, IconRefresh, IconX } from "@tabler/icons-react";
import { useVideoPlaybackError, VideoPlaybackFallback } from "@/components/video-playback-fallback";

export function CanvasMediaViewer({
  alt,
  downloadName,
  onClose,
  src,
  title,
  type,
}: {
  alt: string;
  downloadName?: string;
  onClose: () => void;
  src: string;
  title?: string;
  type: "image" | "video";
}) {
  const tc = useTranslations("common");
  const tg = useTranslations("generation");
  const [scale, setScale] = useState(1);
  const { failed: videoFailed, onError: onVideoError } = useVideoPlaybackError(
    type === "video" ? src : undefined
  );

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (type === "image" && (event.metaKey || event.ctrlKey)) {
        if (event.key === "=" || event.key === "+") {
          event.preventDefault();
          setScale((value) => Math.min(4, value + 0.25));
        } else if (event.key === "-") {
          event.preventDefault();
          setScale((value) => Math.max(0.5, value - 0.25));
        } else if (event.key === "0") {
          event.preventDefault();
          setScale(1);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, type]);

  const download = async () => {
    try {
      const blob = await (await fetch(src)).blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = downloadName ?? (type === "video" ? "video.mp4" : "image.png");
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      window.open(src, "_blank");
    }
  };

  const buttonClass =
    "flex size-10 items-center justify-center rounded-xl bg-white/10 text-white/80 backdrop-blur-md transition-colors hover:bg-white/20 hover:text-white";

  return createPortal(
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/94 backdrop-blur-sm">
      <div className="flex h-16 shrink-0 items-center justify-between gap-4 px-5">
        <div className="min-w-0">
          {title ? <p className="truncate text-sm font-medium text-white/90">{title}</p> : null}
          {type === "image" ? (
            <p className="text-xs text-white/45 tabular-nums">{Math.round(scale * 100)}%</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {type === "image" ? (
            <>
              <button
                type="button"
                aria-label={tg("zoomOut")}
                className={buttonClass}
                onClick={() => setScale((value) => Math.max(0.5, value - 0.25))}
              >
                <IconMinus className="size-5" stroke={1.8} />
              </button>
              <button
                type="button"
                aria-label={tg("resetZoom")}
                className={buttonClass}
                onClick={() => setScale(1)}
              >
                <IconRefresh className="size-5" stroke={1.8} />
              </button>
              <button
                type="button"
                aria-label={tg("zoomIn")}
                className={buttonClass}
                onClick={() => setScale((value) => Math.min(4, value + 0.25))}
              >
                <IconPlus className="size-5" stroke={1.8} />
              </button>
            </>
          ) : null}
          <button
            type="button"
            aria-label={tg("download")}
            className={buttonClass}
            onClick={() => void download()}
          >
            <IconDownload className="size-5" stroke={1.8} />
          </button>
          <button type="button" aria-label={tc("close")} className={buttonClass} onClick={onClose}>
            <IconX className="size-5" stroke={1.8} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-5 pb-5">
        {type === "video" ? (
          <div className="relative flex size-full items-center justify-center">
            <video
              src={src}
              controls
              autoPlay
              playsInline
              onError={onVideoError}
              className="max-h-full max-w-full rounded-xl"
            />
            {videoFailed && <VideoPlaybackFallback onDownload={() => void download()} />}
          </div>
        ) : (
          <div
            className="flex min-h-full items-center justify-center"
            onWheel={(event) => {
              if (!event.metaKey && !event.ctrlKey) return;
              event.preventDefault();
              setScale((value) =>
                Math.min(4, Math.max(0.5, value + (event.deltaY > 0 ? -0.15 : 0.15)))
              );
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt}
              draggable={false}
              className="max-h-[calc(100vh-7rem)] max-w-full rounded-xl object-contain transition-transform duration-150 select-none"
              style={{ transform: `scale(${scale})` }}
            />
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
