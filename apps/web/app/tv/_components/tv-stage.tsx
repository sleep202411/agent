"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import videojs from "video.js";
import type Player from "video.js/dist/types/player";
import simplifiedChinese from "video.js/dist/lang/zh-CN.json";
import traditionalChinese from "video.js/dist/lang/zh-TW.json";
import { IconPhotoOff, IconRefresh } from "@tabler/icons-react";
import { useLocale, useTranslations } from "@/src/i18n/i18n";
import type { TvItem } from "../_hooks/types";
import "video.js/dist/video-js.css";
import styles from "./tv-stage.module.css";

interface TvStageProps {
  item: TvItem;
  onPlaybackChange: (playing: boolean, source?: string) => void;
  onNext?: () => void;
  advancing: boolean;
  navigationError: string | null;
  onRefreshSource?: () => void;
}

export function TvStage(props: TvStageProps) {
  const { item, onNext, advancing, navigationError } = props;
  const t = useTranslations("tv");
  const locale = useLocale();
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const latest = useRef({ ...props, locale });
  useLayoutEffect(() => {
    latest.current = { ...props, locale };
  });
  const visible = useRef(false);
  const autoplayPending = useRef(false);
  const [playerElement, setPlayerElement] = useState<Element | null>(null);
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ src: string; message: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const coverAvailable = Boolean(item.cover) && failedCover !== item.cover;
  const failed = failure?.src === item.trailer;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const video = document.createElement("video-js");
    video.classList.add("vjs-big-play-centered");
    container.appendChild(video);
    const player = videojs(video, {
      controls: true,
      autoplay: false,
      muted: true,
      playsinline: true,
      preload: "metadata",
      fill: true,
      language: latest.current.locale,
      errorDisplay: false,
      languages: { "zh-CN": simplifiedChinese, "zh-HK": traditionalChinese },
      userActions: { doubleClick: false },
      controlBar: {
        children: [
          "playToggle",
          "volumePanel",
          "currentTimeDisplay",
          "progressControl",
          "durationDisplay",
          "fullscreenToggle",
        ],
      },
    });
    playerRef.current = player;
    setPlayerElement(player.el());
    const paused = () => latest.current.onPlaybackChange(false);
    const playIfPending = () => {
      if (visible.current && !document.hidden && autoplayPending.current) {
        autoplayPending.current = false;
        // Browser autoplay refusal leaves the play button available.
        void player.play()?.catch(() => {});
      }
    };
    player.on("playing", () => {
      if (!visible.current || document.hidden) player.pause();
      else latest.current.onPlaybackChange(true, player.currentSrc());
    });
    player.on(["pause", "waiting", "emptied"], paused);
    player.on("ended", () => {
      paused();
      if (visible.current && !document.hidden) latest.current.onNext?.();
    });
    player.on("error", () => {
      autoplayPending.current = false;
      player.pause();
      paused();
      const src = player.currentSrc();
      if (src === latest.current.item.trailer) {
        setFailure({ src, message: player.localize(player.error()?.message || "") });
      }
    });
    player.on("loadstart", playIfPending);
    const observer = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting;
      if (!entry.isIntersecting) player.pause();
      else playIfPending();
    });
    observer.observe(container);
    const onVisibilityChange = () => {
      if (document.hidden) player.pause();
      else playIfPending();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      autoplayPending.current = false;
      player.pause();
      playerRef.current = null;
      player.dispose();
    };
    // A channel/locale refresh must not discard volume or playback state.
  }, []);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    player.language(locale);
  }, [locale]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    latest.current.onPlaybackChange(false);
    setFailure(null);
    // Stop and release the old media before attempting source selection. If the
    // next source is unsupported, Video.js can otherwise retain the old tech
    // and its audible stream underneath the new channel's error overlay.
    autoplayPending.current = false;
    const volume = player.volume();
    const muted = player.muted();
    const poster = player.poster();
    player.pause();
    player.reset();
    player.poster(poster);
    if (volume !== undefined) player.volume(volume);
    if (muted !== undefined) player.muted(muted);
    if (!item.trailer) return;
    autoplayPending.current = true;
    // Let Video.js infer its MOV alias when this browser rejects QuickTime's
    // MIME hint. The original URL/bytes remain unchanged; codec support is
    // still decided by the native decoder. Preserve browsers accepting it.
    const inferMovType =
      item.trailerType?.toLowerCase() === "video/quicktime" &&
      /\.mov(?:[?#]|$)/i.test(item.trailer) &&
      !document.createElement("video").canPlayType(item.trailerType);
    player.src({
      src: item.trailer,
      type: inferMovType
        ? undefined
        : item.trailerType &&
            /^(video\/|application\/(?:vnd\.apple\.mpegurl|x-mpegurl))/i.test(item.trailerType)
          ? item.trailerType
          : /\.m3u8(?:[?#]|$)/i.test(item.trailer)
            ? "application/x-mpegURL"
            : /\.webm(?:[?#]|$)/i.test(item.trailer)
              ? "video/webm"
              : "video/mp4",
    });
    if (visible.current && !document.hidden) {
      autoplayPending.current = false;
      void player.play()?.catch(() => {});
    }
  }, [item.id, item.trailer, item.trailerType, retry]);

  useEffect(() => {
    playerRef.current?.poster(coverAvailable ? item.cover : "");
  }, [item.cover, coverAvailable]);

  return (
    <div
      ref={containerRef}
      className={styles.stage}
      data-has-video={Boolean(item.trailer) && !failed}
    >
      {playerElement &&
        createPortal(
          <>
            {(!item.trailer || failed) && (
              <div className="absolute inset-0 z-10 bg-[#0c0e13]">
                {coverAvailable && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.cover}
                    alt=""
                    onError={() => setFailedCover(item.cover)}
                    className="size-full object-contain"
                  />
                )}
                {(!coverAvailable || failed) && (
                  <div
                    role="status"
                    className="absolute inset-0 flex flex-col items-center gap-3 overflow-y-auto bg-black/60 px-6 py-3 text-center text-sm text-white/70 [justify-content:safe_center]"
                  >
                    <IconPhotoOff
                      aria-hidden
                      className="hidden size-10 shrink-0 text-white/30 sm:block"
                    />
                    <p>
                      {item.trailer
                        ? failure?.message || t("videoUnavailable")
                        : t("previewUnavailable")}
                    </p>
                    {item.trailer && (
                      <button
                        type="button"
                        onClick={() => {
                          latest.current.onRefreshSource?.();
                          setRetry((value) => value + 1);
                        }}
                        className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full bg-white/10 px-4 text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white"
                      >
                        <IconRefresh aria-hidden className="size-4" />
                        {t("retry")}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
            {advancing && (
              <div
                role="status"
                className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/30 text-sm text-white"
              >
                {t("loadingChannel")}
              </div>
            )}
            {navigationError && (
              <div
                role="alert"
                className="absolute inset-x-3 bottom-20 z-20 flex items-center gap-3 rounded-lg bg-black/85 p-3 text-sm text-white"
              >
                <span>{navigationError}</span>
                <button type="button" onClick={onNext} className="min-h-11 shrink-0 px-2 underline">
                  {t("retry")}
                </button>
              </div>
            )}
          </>,
          playerElement
        )}
    </div>
  );
}
