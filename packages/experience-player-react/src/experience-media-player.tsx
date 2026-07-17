"use client";

import {
  Gesture,
  MediaAnnouncer,
  MediaPlayer,
  MediaProvider,
  Poster,
  type MediaPlayerInstance,
  type PlayerSrc,
  type VideoMimeType,
} from "@vidstack/react";
import { useEffect, useMemo, useRef } from "react";
import { classNames } from "./class-names";
import type { ExperiencePlayerVideoCopy } from "./experience-player-copy";

const VIDEO_MIME_TYPES = new Set<VideoMimeType>([
  "video/mp4",
  "video/webm",
  "video/3gp",
  "video/ogg",
  "video/avi",
  "video/mpeg",
  "video/object",
]);

export interface ExperienceMediaPlaybackHandle {
  readonly playbackIdentity: string;
  play(): Promise<void>;
  pause(): void;
}

export function ExperienceMediaPlayer({
  source,
  title,
  poster,
  fit = "cover",
  autoPlay,
  muted,
  loop,
  durationSeconds,
  clipStartTime,
  onEnd,
  onTimeUpdate,
  onPlaybackError,
  onPlaybackHandle,
  playbackIdentity,
  copy,
}: {
  source: { src: string; type?: string | null };
  title: string;
  poster?: string;
  fit?: "cover" | "contain";
  autoPlay: boolean;
  muted: boolean;
  loop: boolean;
  durationSeconds: number;
  clipStartTime?: number;
  onEnd: () => void;
  onTimeUpdate: (seconds: number) => void;
  onPlaybackError: (message?: string) => void;
  onPlaybackHandle?: (handle: ExperienceMediaPlaybackHandle | null) => void;
  playbackIdentity: string;
  copy: ExperiencePlayerVideoCopy;
}) {
  const playerRef = useRef<MediaPlayerInstance>(null);
  const { src, type } = source;
  const playerSource = useMemo(() => normalizeVideoSource({ src, type }), [src, type]);
  useEffect(() => {
    const player = playerRef.current;
    if (player) synchronizePlayerContract(player, durationSeconds, muted);
  }, [durationSeconds, muted]);
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !onPlaybackHandle) return;
    onPlaybackHandle({
      playbackIdentity,
      play: () => playMediaPlayer(player),
      pause: () => pauseMediaPlayer(player),
    });
    return () => onPlaybackHandle(null);
  }, [onPlaybackHandle, playbackIdentity]);
  return (
    <MediaPlayer
      ref={playerRef}
      src={playerSource}
      title={title}
      ariaLabel={title}
      viewType="video"
      streamType="on-demand"
      controls={false}
      autoPlay={autoPlay}
      muted={muted}
      loop={loop}
      duration={durationSeconds}
      clipStartTime={clipStartTime ?? 0}
      playsInline
      preload="metadata"
      load="eager"
      poster={poster}
      posterLoad="eager"
      keyTarget="player"
      logLevel="silent"
      onCanPlay={() => {
        const player = playerRef.current;
        if (player) synchronizePlayerContract(player, durationSeconds, muted);
      }}
      onEnd={onEnd}
      onTimeUpdate={(detail) => emitValidTimeUpdate(onTimeUpdate, detail.currentTime)}
      onError={(detail) => onPlaybackError(detail.message)}
      onPlayFail={(detail) => onPlaybackError(detail.message)}
      onAutoPlayFail={(detail) => onPlaybackError(detail.error.message)}
      className="group/experience-video relative flex size-full overflow-hidden bg-black outline-none data-[fullscreen]:fixed data-[fullscreen]:inset-0 data-[fullscreen]:z-[9999] data-[fullscreen]:h-screen data-[fullscreen]:w-screen"
      data-experience-video-player=""
    >
      <MediaProvider
        className="absolute inset-0 flex size-full items-center overflow-hidden bg-black"
        mediaProps={{
          className: classNames(
            "block size-full select-none",
            fit === "cover" ? "object-cover" : "object-contain",
            "group-data-[fullscreen]/experience-video:object-contain"
          ),
          draggable: false,
        }}
      >
        {poster ? (
          <Poster
            src={poster}
            alt={title}
            draggable={false}
            className={classNames(
              "pointer-events-none absolute inset-0 size-full select-none",
              fit === "cover" ? "object-cover" : "object-contain",
              "group-data-[fullscreen]/experience-video:object-contain"
            )}
          />
        ) : null}
      </MediaProvider>
      <ExperienceVideoSurface copy={copy} />
    </MediaPlayer>
  );
}

function ExperienceVideoSurface({ copy }: { copy: ExperiencePlayerVideoCopy }) {
  // Interactive-film playback is story-driven: no scrub bar, no time readout,
  // no fullscreen chrome (the shell is already full-bleed). Tap toggles
  // pause; the announcer keeps assistive tech informed.
  return (
    <>
      <MediaAnnouncer
        className="sr-only"
        translations={{
          Play: copy.play,
          Pause: copy.pause,
          Mute: copy.mute,
          Volume: copy.volume,
          "Enter Fullscreen": copy.enterFullscreen,
          "Exit Fullscreen": copy.exitFullscreen,
          "Seek Forward": copy.seekForward,
          "Seek Backward": copy.seekBackward,
        }}
      />
      <Gesture
        event="pointerup"
        action="toggle:paused"
        className="absolute inset-0 z-10"
        aria-hidden="true"
      />
    </>
  );
}

function normalizeVideoSource(source: { src: string; type?: string | null }): PlayerSrc {
  const normalizedType = source.type?.split(";", 1)[0]?.trim().toLowerCase();
  if (normalizedType && VIDEO_MIME_TYPES.has(normalizedType as VideoMimeType)) {
    return { src: source.src, type: normalizedType as VideoMimeType };
  }
  return source.src;
}

function playMediaPlayer(player: MediaPlayerInstance): Promise<void> {
  const provider = player.provider;
  if (
    provider?.type === "video" ||
    provider?.type === "audio" ||
    provider?.type === "hls" ||
    provider?.type === "dash"
  ) {
    return provider.media.play();
  }
  return player.play();
}

function pauseMediaPlayer(player: MediaPlayerInstance): void {
  const provider = player.provider;
  if (
    provider?.type === "video" ||
    provider?.type === "audio" ||
    provider?.type === "hls" ||
    provider?.type === "dash"
  ) {
    provider.media.pause();
    return;
  }
  void player.pause();
}

function emitValidTimeUpdate(onTimeUpdate: (seconds: number) => void, seconds: number): void {
  if (Number.isFinite(seconds) && seconds >= 0) onTimeUpdate(seconds);
}

function synchronizePlayerContract(
  player: MediaPlayerInstance,
  durationSeconds: number,
  muted: boolean
): void {
  player.duration = durationSeconds;
  player.muted = muted;
  const provider = player.provider;
  if (
    provider?.type === "video" ||
    provider?.type === "audio" ||
    provider?.type === "hls" ||
    provider?.type === "dash"
  ) {
    provider.media.muted = muted;
  }
}
