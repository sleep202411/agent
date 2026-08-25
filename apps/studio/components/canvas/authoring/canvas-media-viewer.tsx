"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { createPortal } from "react-dom";
import { IconDownload, IconMinus, IconPlus, IconRefresh, IconX } from "@tabler/icons-react";
import { useVideoPlaybackError, VideoPlaybackFallback } from "@/components/video-playback-fallback";
import { IconAudioWaveform } from "@/components/icons/icon-audio-waveform";
import { downloadCanvasMedia } from "./download-media";

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
  type: "image" | "video" | "audio";
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
    await downloadCanvasMedia(src, downloadName ?? type, type);
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
        ) : type === "audio" ? (
          <div className="flex size-full items-center justify-center">
            <div className="flex w-full max-w-xl flex-col items-center gap-5 rounded-3xl bg-white/[0.055] px-8 py-10 shadow-2xl shadow-black/40">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-white/[0.08] text-white/72">
                <IconAudioWaveform className="size-6" stroke={1.7} />
              </span>
              {title ? <p className="max-w-full truncate text-sm text-white/82">{title}</p> : null}
              <audio
                src={src}
                controls
                autoPlay
                preload="metadata"
                className="h-10 w-full [color-scheme:dark]"
              />
            </div>
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
