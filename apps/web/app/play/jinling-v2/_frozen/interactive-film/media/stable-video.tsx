"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type VideoHTMLAttributes,
} from "react";

export type StableVideoFrameHandler = (
  video: HTMLVideoElement,
  now: DOMHighResTimeStamp,
  metadata?: VideoFrameCallbackMetadata
) => void;

export type StableVideoMediaErrorHandler = (
  error: MediaError | null,
  video: HTMLVideoElement
) => void;

export type StableVideoPlaybackErrorHandler = (error: unknown, video: HTMLVideoElement) => void;

export type StableVideoProps = Omit<
  VideoHTMLAttributes<HTMLVideoElement>,
  "src" | "muted" | "loop" | "volume" | "onError"
> & {
  src: string;
  /**
   * Identity of the logical playback instance. Changing this rewinds the
   * existing element without reloading the source, which keeps same-source
   * story nodes deterministic.
   */
  playbackId?: string | number;
  muted?: boolean;
  volume?: number;
  loop?: boolean;
  onVideoFrame?: StableVideoFrameHandler;
  onMediaError: StableVideoMediaErrorHandler;
  onAutoplayBlocked?: (error: unknown, video: HTMLVideoElement) => void;
  onPlaybackError?: StableVideoPlaybackErrorHandler;
};

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 1;
  return Math.min(1, Math.max(0, volume));
}

function playbackErrorName(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("name" in error)) return null;
  return typeof error.name === "string" ? error.name : null;
}

/**
 * A stable HTMLVideoElement whose media lifecycle is controlled by source
 * identity rather than unrelated React prop changes.
 *
 * Muting, volume and looping update the existing element in place. The source
 * effect is the only normal playback path that calls load(), so toggling audio
 * or entering a wait loop never restarts the film. A playback identity change
 * rewinds without a network reload, while a false -> true loop change on an
 * already-ended clip explicitly resumes from frame zero.
 */
export const StableVideo = forwardRef<HTMLVideoElement, StableVideoProps>(function StableVideo(
  {
    src,
    playbackId,
    muted = true,
    volume = 1,
    loop = false,
    autoPlay = true,
    crossOrigin = "anonymous",
    onVideoFrame,
    onMediaError,
    onAutoplayBlocked,
    onPlaybackError,
    ...videoProps
  },
  forwardedRef
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const loadedSrcRef = useRef<string | null>(null);
  const previousPlaybackIdRef = useRef(playbackId);
  const previousLoopRef = useRef(loop);
  const autoPlayRef = useRef(autoPlay);
  const onVideoFrameRef = useRef(onVideoFrame);
  const onAutoplayBlockedRef = useRef(onAutoplayBlocked);
  const onPlaybackErrorRef = useRef(onPlaybackError);

  autoPlayRef.current = autoPlay;
  onVideoFrameRef.current = onVideoFrame;
  onAutoplayBlockedRef.current = onAutoplayBlocked;
  onPlaybackErrorRef.current = onPlaybackError;

  const handlePlayRejection = useCallback((error: unknown, video: HTMLVideoElement) => {
    const name = playbackErrorName(error);
    if (name === "AbortError") return;
    if (name === "NotAllowedError") {
      onAutoplayBlockedRef.current?.(error, video);
      return;
    }
    onPlaybackErrorRef.current?.(error, video);
  }, []);

  useImperativeHandle(forwardedRef, () => videoRef.current!, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = muted;
  }, [muted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = clampVolume(volume);
  }, [volume]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || loadedSrcRef.current === src) return;

    loadedSrcRef.current = src;
    video.src = src;
    video.load();

    if (autoPlayRef.current) {
      void video.play().catch((error) => handlePlayRejection(error, video));
    }
  }, [handlePlayRejection, src]);

  useEffect(() => {
    const video = videoRef.current;
    const previousPlaybackId = previousPlaybackIdRef.current;
    previousPlaybackIdRef.current = playbackId;

    if (!video || playbackId === undefined || Object.is(previousPlaybackId, playbackId)) return;

    video.currentTime = 0;
    if (autoPlayRef.current) {
      void video.play().catch((error) => handlePlayRejection(error, video));
    }
  }, [handlePlayRejection, playbackId]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const wasLooping = previousLoopRef.current;
    const wasEnded = video.ended;
    previousLoopRef.current = loop;
    video.loop = loop;

    if (!wasLooping && loop && wasEnded) {
      video.currentTime = 0;
      void video.play().catch((error) => handlePlayRejection(error, video));
    }
  }, [handlePlayRejection, loop]);

  const hasVideoFrameHandler = onVideoFrame !== undefined;
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hasVideoFrameHandler) return;

    if (typeof video.requestVideoFrameCallback !== "function") {
      const handleTimeUpdate = () => onVideoFrameRef.current?.(video, performance.now());
      video.addEventListener("timeupdate", handleTimeUpdate);
      return () => video.removeEventListener("timeupdate", handleTimeUpdate);
    }

    let cancelled = false;
    let callbackId: number | null = null;

    const handleFrame: VideoFrameRequestCallback = (now, metadata) => {
      if (cancelled) return;
      onVideoFrameRef.current?.(video, now, metadata);
      callbackId = video.requestVideoFrameCallback(handleFrame);
    };

    callbackId = video.requestVideoFrameCallback(handleFrame);

    return () => {
      cancelled = true;
      if (callbackId !== null && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(callbackId);
      }
    };
  }, [hasVideoFrameHandler]);

  return (
    <video
      {...videoProps}
      ref={videoRef}
      autoPlay={autoPlay}
      crossOrigin={crossOrigin}
      onError={(event) => onMediaError(event.currentTarget.error, event.currentTarget)}
    />
  );
});
