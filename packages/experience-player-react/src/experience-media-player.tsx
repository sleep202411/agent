"use client";

import {
  Controls,
  FullscreenButton,
  Gesture,
  MediaAnnouncer,
  MediaPlayer,
  MediaProvider,
  MuteButton,
  PlayButton,
  Poster,
  Time,
  TimeSlider,
  VolumeSlider,
  useMediaState,
  type MediaPlayerInstance,
  type PlayerSrc,
  type VideoMimeType,
} from "@vidstack/react";
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconPlayerPause,
  IconPlayerPlay,
  IconVolume,
  IconVolumeOff,
} from "@tabler/icons-react";
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

const CONTROL_BUTTON =
  "grid size-11 shrink-0 place-items-center rounded-full text-white/88 outline-none transition-colors hover:bg-white/[0.14] focus-visible:bg-white/[0.14] focus-visible:ring-2 focus-visible:ring-white/60 disabled:pointer-events-none disabled:opacity-35 motion-reduce:transition-none";

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
      controlsDelay={1800}
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
  const paused = useMediaState("paused");
  const muted = useMediaState("muted");
  const fullscreen = useMediaState("fullscreen");

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
      <Controls.Root
        hideDelay={1800}
        className="pointer-events-none invisible absolute inset-0 z-20 flex flex-col justify-end bg-linear-to-t from-black/76 via-black/10 to-black/10 opacity-0 transition-opacity duration-150 data-[visible]:visible data-[visible]:opacity-100 motion-reduce:transition-none"
      >
        <Controls.Group className="pointer-events-auto flex items-center gap-1 px-3 pb-1 sm:px-5">
          <PlayButton className={CONTROL_BUTTON} aria-label={paused ? copy.play : copy.pause}>
            {paused ? (
              <IconPlayerPlay className="size-5 fill-current" />
            ) : (
              <IconPlayerPause className="size-5 fill-current" />
            )}
          </PlayButton>
          <div className="ml-1 flex items-center gap-1 font-mono text-xs tabular-nums text-white/88">
            <Time type="current" />
            <span className="text-white/42">/</span>
            <Time type="duration" />
          </div>
          <div className="ml-auto flex items-center gap-1">
            <MuteButton className={CONTROL_BUTTON} aria-label={muted ? copy.unmute : copy.mute}>
              {muted ? <IconVolumeOff className="size-5" /> : <IconVolume className="size-5" />}
            </MuteButton>
            <VolumeSlider.Root className="group/volume relative hidden h-11 w-24 cursor-pointer touch-none select-none items-center sm:flex">
              <VolumeSlider.Track className="relative h-1 w-full rounded-full bg-white/24">
                <VolumeSlider.TrackFill className="absolute h-full rounded-full bg-white" />
              </VolumeSlider.Track>
              <VolumeSlider.Thumb className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 transition-opacity group-hover/volume:opacity-100 group-focus-within/volume:opacity-100" />
            </VolumeSlider.Root>
            <FullscreenButton
              className={CONTROL_BUTTON}
              aria-label={fullscreen ? copy.exitFullscreen : copy.enterFullscreen}
            >
              {fullscreen ? (
                <IconArrowsMinimize className="size-5" />
              ) : (
                <IconArrowsMaximize className="size-5" />
              )}
            </FullscreenButton>
          </div>
        </Controls.Group>
        <Controls.Group className="pointer-events-auto px-4 pb-3 sm:px-6 sm:pb-5">
          <TimeSlider.Root className="group/time relative flex h-5 w-full cursor-pointer touch-none select-none items-center outline-none">
            <TimeSlider.Track className="relative h-1 w-full rounded-full bg-white/25 transition-[height] group-hover/time:h-1.5 group-focus-visible/time:h-1.5">
              <TimeSlider.TrackFill className="absolute h-full rounded-full bg-white" />
            </TimeSlider.Track>
            <TimeSlider.Thumb className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 transition-opacity group-hover/time:opacity-100 group-focus-visible/time:opacity-100" />
          </TimeSlider.Root>
        </Controls.Group>
      </Controls.Root>
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
