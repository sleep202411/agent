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
  /** Fired once on the first play of the current src (e.g. a view signal). */
  onFirstPlay?: () => void;
}

export function VideoPlayer({
  src,
  type = "video",
  className,
  autoplay = true,
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
    const mimeType = isAudio ? "audio/mpeg" : "video/mp4";

    playerRef.current = videojs(videoEl, {
      controls: true,
      autoplay,
      fluid: !isAudio,
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
  }, [src, type, autoplay]);

  return <div ref={containerRef} className={className} />;
}
