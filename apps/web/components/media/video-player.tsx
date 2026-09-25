"use client";

import { useEffect, useRef } from "react";
import videojs from "video.js";
import type Player from "video.js/dist/types/player";
import "video.js/dist/video-js.css";

interface VideoPlayerProps {
  src: string;
  /** "video" | "audio" */
  type?: "video" | "audio";
  className?: string;
  autoplay?: boolean;
  /** Fill a parent with an explicit size instead of adopting the source ratio. */
  fillParent?: boolean;
  /** Fired once on the first play of the current src (e.g. a view signal). */
  onFirstPlay?: () => void;
}

export function VideoPlayer({
  src,
  type = "video",
  className,
  autoplay = true,
  fillParent = false,
  onFirstPlay,
}: VideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  // Ref so a changing callback identity never re-creates the player.
  const onFirstPlayRef = useRef(onFirstPlay);
  onFirstPlayRef.current = onFirstPlay;

  useEffect(() => {
    if (!containerRef.current) return;

    const videoEl = document.createElement("video-js");
    videoEl.classList.add("vjs-big-play-centered");
    containerRef.current.appendChild(videoEl);

    const isAudio = type === "audio";
    // HLS streams (ABR `master.m3u8`, e.g. CN IP episodes transcoded by IMM)
    // MUST be advertised with an HLS MIME type so video.js's bundled VHS engine
    // takes over. Labelling an .m3u8 as "video/mp4" leaves it on the native
    // <video> tech, which only Safari/iOS can decode — Chrome/Android/WeChat
    // play nothing. video.js only auto-derives the type from the extension when
    // none is given, so we must set it explicitly here.
    const isHls = !isAudio && /\.m3u8(?:[?#]|$)/i.test(src);
    const mimeType = isAudio ? "audio/mpeg" : isHls ? "application/x-mpegURL" : "video/mp4";

    playerRef.current = videojs(videoEl, {
      controls: true,
      autoplay,
      fluid: !isAudio && !fillParent,
      fill: !isAudio && fillParent,
      audioOnlyMode: isAudio,
      sources: [{ src, type: mimeType }],
    });

    let firstPlayFired = false;
    playerRef.current.on("play", () => {
      if (firstPlayFired) return;
      firstPlayFired = true;
      onFirstPlayRef.current?.();
    });

    return () => {
      if (playerRef.current) {
        playerRef.current.dispose();
        playerRef.current = null;
      }
    };
  }, [src, type, autoplay, fillParent]);

  return <div ref={containerRef} className={className} />;
}
