"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import { IconVolume, IconVolumeOff } from "@tabler/icons-react";

/**
 * Full-bleed hero background: a muted, looping UI-showcase video (webm with mp4
 * fallback) under a legibility scrim. The soundtrack is a separate looping audio
 * track (longer than the video) toggled by an unmute button — browsers require
 * muted autoplay, so sound is opt-in. Reduced-motion users get the still poster.
 */

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(REDUCED_MOTION_QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false
  );
}

export function HeroVideo() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [soundOn, setSoundOn] = useState(false);
  const reduce = usePrefersReducedMotion();

  const toggleSound = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (soundOn) {
      audio.pause();
      setSoundOn(false);
    } else {
      void audio
        .play()
        .then(() => setSoundOn(true))
        .catch(() => {});
    }
  };

  return (
    <div className="absolute inset-0">
      {reduce ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src="/hero-poster.jpg" alt="" className="size-full object-cover" />
      ) : (
        <video
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster="/hero-poster.jpg"
          aria-hidden="true"
          className="size-full object-cover"
        >
          <source src="/hero.webm" type="video/webm" />
          <source src="/hero.mp4" type="video/mp4" />
        </video>
      )}

      {/* Soundtrack — separate looping track, opt-in via the button. */}
      <audio ref={audioRef} src="/hero-audio.mp3" loop preload="none" />

      {/* Legibility scrim — darker toward the left where the hero text sits. */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-black/20" />

      {!reduce && (
        <button
          type="button"
          onClick={toggleSound}
          aria-label={soundOn ? "Mute soundtrack" : "Play soundtrack"}
          className="absolute right-4 bottom-4 z-20 flex size-9 items-center justify-center rounded-full bg-black/40 text-white/90 backdrop-blur-md transition-colors hover:bg-black/60"
        >
          {soundOn ? (
            <IconVolume className="size-4" stroke={1.8} />
          ) : (
            <IconVolumeOff className="size-4" stroke={1.8} />
          )}
        </button>
      )}
    </div>
  );
}
