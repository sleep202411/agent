"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RuntimeImageAsset, RuntimeVideoAsset } from "../domain/release-manifest";
import { StableVideo, type StableVideoFrameHandler } from "./stable-video";
import {
  selectResponsiveVisualVariant,
  visualOrientationForViewport,
  type VisualOrientation,
} from "./responsive-media";

export type FilmStageState =
  | "poster"
  | "loading"
  | "ready"
  | "playing"
  | "holding"
  | "ended"
  | "autoplay-blocked"
  | "error";

export type FilmStageError = {
  code: "MEDIA_LOAD_FAILED" | "AUTOPLAY_BLOCKED";
  message: string;
};

type FilmStageProps = {
  clip: RuntimeVideoAsset;
  poster: RuntimeImageAsset;
  playbackId: string | number;
  reduceMotion: boolean;
  muted: boolean;
  loop: boolean;
  tailLoopSeconds?: number;
  fit?: "cover" | "contain";
  className?: string;
  resumeLabel: string;
  onStateChange?: (state: FilmStageState) => void;
  onVideoFrame?: StableVideoFrameHandler;
  onEnded?: () => void;
  onError: (error: FilmStageError) => void;
};

function useViewportOrientation(): VisualOrientation | null {
  const [orientation, setOrientation] = useState<VisualOrientation | null>(null);

  useEffect(() => {
    const update = () =>
      setOrientation(visualOrientationForViewport(window.innerWidth, window.innerHeight));
    update();
    window.addEventListener("resize", update, { passive: true });
    return () => window.removeEventListener("resize", update);
  }, []);

  return orientation;
}

function playbackErrorName(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("name" in error)) return null;
  return typeof error.name === "string" ? error.name : null;
}

function playbackErrorMessage(error: unknown, assetId: string): string {
  if (error instanceof Error && error.message) return error.message;
  return `Unable to play required film asset ${assetId}.`;
}

/**
 * Video-first visual stage. The poster is a required authored asset, used
 * while media loads and as the complete reduced-motion experience. Media
 * failure is surfaced to the product; this component never swaps in an
 * unrelated clip or silently falls back to WebGL.
 */
export function FilmStage({
  clip,
  poster,
  playbackId,
  reduceMotion,
  muted,
  loop,
  tailLoopSeconds,
  fit = "cover",
  className,
  resumeLabel,
  onStateChange,
  onVideoFrame,
  onEnded,
  onError,
}: FilmStageProps) {
  const orientation = useViewportOrientation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const tailLoopStartedForKeyRef = useRef<string | null>(null);
  const onStateChangeRef = useRef(onStateChange);
  const videoVariant = useMemo(
    () => (orientation ? selectResponsiveVisualVariant(clip, orientation) : null),
    [clip, orientation]
  );
  const posterVariant = useMemo(
    () => (orientation ? selectResponsiveVisualVariant(poster, orientation) : null),
    [orientation, poster]
  );
  const initialState: FilmStageState = reduceMotion ? "poster" : "loading";
  const mediaStateKey = `${String(playbackId)}:${reduceMotion ? "poster" : (videoVariant?.src ?? "pending")}`;
  const [stateSnapshot, setStateSnapshot] = useState<{
    key: string;
    value: FilmStageState;
  }>(() => ({ key: mediaStateKey, value: initialState }));
  const state = stateSnapshot.key === mediaStateKey ? stateSnapshot.value : initialState;

  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  useEffect(() => {
    tailLoopStartedForKeyRef.current = null;
  }, [mediaStateKey]);

  useEffect(() => {
    onStateChangeRef.current?.(initialState);
  }, [initialState, mediaStateKey]);

  const transition = (next: FilmStageState) => {
    setStateSnapshot({ key: mediaStateKey, value: next });
    onStateChangeRef.current?.(next);
  };

  const resume = () => {
    const video = videoRef.current;
    if (!video) return;
    void video.play().then(
      () => transition("playing"),
      (error: unknown) => {
        const name = playbackErrorName(error);
        if (name === "AbortError") return;
        if (name === "NotAllowedError") {
          transition("autoplay-blocked");
          onError({
            code: "AUTOPLAY_BLOCKED",
            message: "The browser requires a user gesture before video playback can continue.",
          });
          return;
        }
        transition("error");
        onError({ code: "MEDIA_LOAD_FAILED", message: playbackErrorMessage(error, clip.assetId) });
      }
    );
  };

  return (
    <div
      className={className}
      data-film-stage-state={state}
      data-film-stage-orientation={orientation}
    >
      {posterVariant ? (
        <div
          aria-hidden
          className="absolute inset-0 bg-black bg-center bg-no-repeat"
          style={{
            backgroundImage: `url(${JSON.stringify(posterVariant.src)})`,
            backgroundSize: fit,
          }}
        />
      ) : null}

      {!reduceMotion && videoVariant ? (
        <StableVideo
          ref={videoRef}
          src={videoVariant.src}
          playbackId={playbackId}
          muted={muted}
          loop={loop}
          playsInline
          preload="auto"
          className={`absolute inset-0 size-full transition-opacity duration-500 ${
            fit === "contain" ? "object-contain" : "object-cover"
          } ${state === "ready" || state === "playing" || state === "holding" || state === "ended" ? "opacity-100" : "opacity-0"}`}
          onVideoFrame={onVideoFrame}
          onCanPlay={() => transition("ready")}
          onPlaying={() =>
            transition(tailLoopStartedForKeyRef.current === mediaStateKey ? "holding" : "playing")
          }
          onEnded={() => {
            const video = videoRef.current;
            if (tailLoopSeconds && video && Number.isFinite(video.duration)) {
              const firstTailLoop = tailLoopStartedForKeyRef.current !== mediaStateKey;
              tailLoopStartedForKeyRef.current = mediaStateKey;
              transition("holding");
              if (firstTailLoop) onEnded?.();
              video.currentTime = Math.max(0, video.duration - tailLoopSeconds);
              void video.play().catch((error: unknown) => {
                transition("error");
                onError({
                  code: "MEDIA_LOAD_FAILED",
                  message: playbackErrorMessage(error, clip.assetId),
                });
              });
              return;
            }
            transition("ended");
            onEnded?.();
          }}
          onAutoplayBlocked={() => {
            transition("autoplay-blocked");
            onError({
              code: "AUTOPLAY_BLOCKED",
              message: "The browser requires a user gesture before video playback can continue.",
            });
          }}
          onPlaybackError={(error) => {
            transition("error");
            onError({
              code: "MEDIA_LOAD_FAILED",
              message: playbackErrorMessage(error, clip.assetId),
            });
          }}
          onMediaError={(mediaError) => {
            transition("error");
            onError({
              code: "MEDIA_LOAD_FAILED",
              message: mediaError?.message || `Unable to load required film asset ${clip.assetId}.`,
            });
          }}
        />
      ) : null}

      {state === "autoplay-blocked" ? (
        <button
          type="button"
          onClick={resume}
          className="absolute inset-0 z-10 grid min-h-11 place-items-center bg-black/24 text-sm tracking-[0.12em] text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#a52a2e] focus-visible:ring-inset"
        >
          {resumeLabel}
        </button>
      ) : null}
    </div>
  );
}
