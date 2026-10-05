"use client";

import { useEffect, useRef, useState } from "react";

/** Promotional URL already resolved by the IP API; never derive storage URLs. */
export function IpHoverPreview({ src, active }: { src?: string; active: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const element = video.current;
    if (!element || !src || !active) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    const stop = () => {
      element.pause();
      setPlaying(false);
    };
    const sync = () => {
      if (document.hidden || motion.matches) {
        stop();
        return;
      }
      element.muted = true;
      void element
        .play()
        .then(() => {
          if (disposed || document.hidden || motion.matches) element.pause();
        })
        .catch(() => {
          if (!disposed) setPlaying(false);
        });
    };
    document.addEventListener("visibilitychange", sync);
    motion.addEventListener("change", sync);
    sync();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", sync);
      motion.removeEventListener("change", sync);
      element.pause();
    };
  }, [src, active]);
  if (!src || !active) return null;
  return (
    <video
      ref={video}
      src={src}
      muted
      loop
      playsInline
      preload="none"
      aria-hidden="true"
      onPlaying={() => setPlaying(true)}
      onError={() => setPlaying(false)}
      className={`pointer-events-none absolute inset-0 size-full object-cover ${playing ? "opacity-100" : "opacity-0"}`}
    />
  );
}
