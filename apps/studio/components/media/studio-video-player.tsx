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
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type MutableRefObject,
} from "react";
import { useTranslations } from "next-intl";
import { VideoPlaybackFallback } from "@/components/video-playback-fallback";
import { cn } from "@/lib/utils";
import type { MediaManualPlaybackLease } from "./media-preview-coordinator";
import {
  resolveStudioVideoControlGeometry,
  resolveStudioVideoManualInteraction,
  type StudioVideoControlDensity,
} from "./studio-video-player-model";

const VIDEO_MIME_TYPES = new Set<VideoMimeType>([
  "video/mp4",
  "video/webm",
  "video/3gp",
  "video/ogg",
  "video/avi",
  "video/mpeg",
  "video/object",
]);

const CONTROL_BUTTON_CLASS =
  "grid size-[var(--studio-video-control-size)] shrink-0 place-items-center rounded-full text-white/82 outline-none transition-colors hover:bg-white/[0.12] hover:text-white focus-visible:bg-white/[0.12] focus-visible:text-white focus-visible:ring-2 focus-visible:ring-white/55 disabled:pointer-events-none disabled:opacity-35 motion-reduce:transition-none";

export type StudioVideoSource = {
  src: string;
  type?: string | null;
};

export type StudioVideoPlayerProps = {
  source: StudioVideoSource;
  ariaLabel: string;
  controlDensity: StudioVideoControlDensity | null;
  autoPreviewActive?: boolean;
  manualPlaybackOwned?: boolean;
  onManualPlaybackStart?: () => MediaManualPlaybackLease | null;
  onManualPlaybackStop?: (lease: MediaManualPlaybackLease) => void;
  poster?: string;
  fit?: "cover" | "contain";
  autoPlay?: boolean;
  muted?: boolean;
  loop?: boolean;
  clipStartTime?: number;
  onEnd?: () => void;
  onTimeUpdate?: (currentTimeSeconds: number) => void;
  onPlaybackError?: () => void;
  renderScale?: number;
  className?: string;
};

function normalizeVideoSource(source: StudioVideoSource): PlayerSrc {
  const normalizedType = source.type?.split(";", 1)[0]?.trim().toLowerCase();
  if (normalizedType && VIDEO_MIME_TYPES.has(normalizedType as VideoMimeType)) {
    return { src: source.src, type: normalizedType as VideoMimeType };
  }
  return source.src;
}

export function StudioVideoPlayer({
  source,
  ariaLabel,
  controlDensity,
  autoPreviewActive = false,
  manualPlaybackOwned = false,
  onManualPlaybackStart,
  onManualPlaybackStop,
  poster,
  fit = "cover",
  autoPlay = false,
  muted = false,
  loop = false,
  clipStartTime,
  onEnd,
  onTimeUpdate,
  onPlaybackError,
  renderScale = 1,
  className,
}: StudioVideoPlayerProps) {
  const { src, type } = source;
  const playerRef = useRef<MediaPlayerInstance>(null);
  const autoPreviewPlayRequestRef = useRef<number | null>(null);
  const manualLeaseRef = useRef<MediaManualPlaybackLease | null>(null);
  const playerSource = useMemo(() => normalizeVideoSource({ src, type }), [src, type]);
  const controlGeometry = resolveStudioVideoControlGeometry(renderScale);
  const controlStyle = {
    "--studio-video-control-size": `${controlGeometry.controlSize}px`,
    "--studio-video-time-size": `${controlGeometry.timeFontSize}px`,
  } as CSSProperties & Record<`--${string}`, string | number>;

  const acquireManualPlayback = useCallback(() => {
    if (manualLeaseRef.current) return true;
    const lease = onManualPlaybackStart?.() ?? null;
    if (!lease) return false;
    manualLeaseRef.current = lease;
    return true;
  }, [onManualPlaybackStart]);
  const releaseManualPlayback = useCallback(() => {
    const lease = manualLeaseRef.current;
    if (!lease) return;
    manualLeaseRef.current = null;
    onManualPlaybackStop?.(lease);
  }, [onManualPlaybackStop]);

  useEffect(() => {
    if (!manualPlaybackOwned) manualLeaseRef.current = null;
  }, [manualPlaybackOwned]);

  useEffect(() => () => releaseManualPlayback(), [releaseManualPlayback]);

  return (
    <MediaPlayer
      ref={playerRef}
      src={playerSource}
      title={ariaLabel}
      ariaLabel={ariaLabel}
      viewType="video"
      streamType="on-demand"
      controls={false}
      autoPlay={autoPlay}
      muted={muted}
      loop={loop}
      clipStartTime={clipStartTime ?? 0}
      playsInline
      preload="metadata"
      load="visible"
      poster={poster}
      posterLoad="visible"
      keyTarget="player"
      controlsDelay={1800}
      style={controlStyle}
      onPointerDownCapture={(event) => {
        if (event.button !== 0) return;
        const target = event.target instanceof Element ? event.target : null;
        const interaction = resolveStudioVideoManualInteraction({
          paused: playerRef.current?.paused ?? true,
          togglesPlayback: Boolean(target?.closest("[data-studio-play-toggle]")),
        });
        if (interaction.cancelAutoPlayRequest) {
          autoPreviewPlayRequestRef.current = null;
        }
        if (interaction.claimManualPlayback) acquireManualPlayback();
      }}
      onKeyDownCapture={(event) => {
        if (!MANUAL_MEDIA_KEYS.has(event.code)) return;
        const interaction = resolveStudioVideoManualInteraction({
          paused: playerRef.current?.paused ?? true,
          togglesPlayback: MANUAL_PLAY_TOGGLE_KEYS.has(event.code),
        });
        if (interaction.cancelAutoPlayRequest) {
          autoPreviewPlayRequestRef.current = null;
        }
        if (interaction.claimManualPlayback) acquireManualPlayback();
      }}
      onPlay={() => {
        if (autoPreviewPlayRequestRef.current === null) acquireManualPlayback();
      }}
      onPause={releaseManualPlayback}
      onEnd={() => {
        releaseManualPlayback();
        onEnd?.();
      }}
      onTimeUpdate={(detail) => emitValidTimeUpdate(onTimeUpdate, detail.currentTime)}
      onPlayFail={releaseManualPlayback}
      onError={() => {
        releaseManualPlayback();
        onPlaybackError?.();
      }}
      className={cn(
        "group/studio-video relative flex size-full overflow-hidden bg-black outline-none data-[fullscreen]:fixed data-[fullscreen]:inset-0 data-[fullscreen]:z-[9999] data-[fullscreen]:h-screen data-[fullscreen]:w-screen data-[fullscreen]:rounded-none",
        controlDensity === null && "pointer-events-none",
        className
      )}
      data-studio-video-player=""
      data-canvas-fullscreen-owner=""
      data-control-density={controlDensity ?? "hidden"}
      data-auto-preview={autoPreviewActive ? "true" : undefined}
      data-playback-owner={manualPlaybackOwned ? "manual" : autoPreviewActive ? "hover" : undefined}
    >
      <MediaProvider
        className="absolute inset-0 flex size-full items-center overflow-hidden bg-black"
        mediaProps={{
          className: cn(
            "block size-full select-none",
            fit === "cover" ? "object-cover" : "object-contain",
            "group-data-[fullscreen]/studio-video:object-contain"
          ),
          draggable: false,
        }}
      >
        {poster ? (
          <Poster
            src={poster}
            alt={ariaLabel}
            draggable={false}
            className={cn(
              "pointer-events-none absolute inset-0 size-full select-none",
              fit === "cover" ? "object-cover" : "object-contain",
              "group-data-[fullscreen]/studio-video:object-contain"
            )}
          />
        ) : null}
      </MediaProvider>
      <StudioVideoPlaybackController
        playerRef={playerRef}
        active={autoPreviewActive}
        manualOwned={manualPlaybackOwned}
        playRequestRef={autoPreviewPlayRequestRef}
      />
      <StudioVideoSurface controlDensity={controlDensity} />
    </MediaPlayer>
  );
}

const MANUAL_MEDIA_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "Enter",
  "KeyF",
  "KeyK",
  "KeyM",
  "Space",
]);

const MANUAL_PLAY_TOGGLE_KEYS = new Set(["Enter", "KeyK", "Space"]);

type PreviewPlaybackSnapshot = {
  currentTime: number;
  muted: boolean;
};

function StudioVideoPlaybackController({
  playerRef,
  active,
  manualOwned,
  playRequestRef,
}: {
  playerRef: MutableRefObject<MediaPlayerInstance | null>;
  active: boolean;
  manualOwned: boolean;
  playRequestRef: MutableRefObject<number | null>;
}) {
  const canPlay = useMediaState("canPlay");
  const interactionEpochRef = useRef(0);
  const activeRef = useRef(active);
  const manualOwnedRef = useRef(manualOwned);
  const wasManualOwnedRef = useRef(manualOwned);
  const previewSnapshotRef = useRef<PreviewPlaybackSnapshot | null>(null);
  const restoredSnapshotRef = useRef<PreviewPlaybackSnapshot | null>(null);

  useEffect(() => {
    activeRef.current = active;
    manualOwnedRef.current = manualOwned;
  }, [active, manualOwned]);

  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    const epoch = ++interactionEpochRef.current;

    if (manualOwned) {
      wasManualOwnedRef.current = true;
      const snapshot = previewSnapshotRef.current;
      if (snapshot) setPlayerMuted(player, snapshot.muted);
      previewSnapshotRef.current = null;
      restoredSnapshotRef.current = null;
      return;
    }

    if (wasManualOwnedRef.current) {
      wasManualOwnedRef.current = false;
      previewSnapshotRef.current = null;
      restoredSnapshotRef.current = null;
      void player.pause().catch(() => {});
      return;
    }

    if (!active) {
      const snapshot = previewSnapshotRef.current;
      if (!snapshot) return;
      previewSnapshotRef.current = null;
      restoredSnapshotRef.current = snapshot;
      void player.pause().catch(() => {});
      player.currentTime = snapshot.currentTime;
      setPlayerMuted(player, snapshot.muted);
      return;
    }

    if (!previewSnapshotRef.current) {
      previewSnapshotRef.current = {
        currentTime: player.currentTime,
        muted: player.muted,
      };
    }
    restoredSnapshotRef.current = null;
    setPlayerMuted(player, true);
    player.currentTime = 0;
    if (!canPlay) {
      player.startLoading();
      return;
    }

    playRequestRef.current = epoch;
    void player
      .play()
      .then(() => {
        if (activeRef.current && !manualOwnedRef.current) return;
        if (manualOwnedRef.current) return;

        void player.pause().catch(() => {});
        const restored = restoredSnapshotRef.current;
        if (restored) {
          player.currentTime = restored.currentTime;
          setPlayerMuted(player, restored.muted);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (playRequestRef.current === epoch) playRequestRef.current = null;
      });
  }, [active, canPlay, manualOwned, playRequestRef, playerRef]);

  return null;
}

function setPlayerMuted(player: MediaPlayerInstance, muted: boolean): void {
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

function emitValidTimeUpdate(
  onTimeUpdate: StudioVideoPlayerProps["onTimeUpdate"],
  seconds: number
): void {
  if (Number.isFinite(seconds) && seconds >= 0) onTimeUpdate?.(seconds);
}

function StudioVideoSurface({
  controlDensity,
}: {
  controlDensity: StudioVideoControlDensity | null;
}) {
  const t = useTranslations("videoPlayer");
  const error = useMediaState("error");

  if (error) return <VideoPlaybackFallback compact />;
  if (controlDensity === null) return null;

  return (
    <>
      <MediaAnnouncer
        className="sr-only"
        translations={{
          Play: t("play"),
          Pause: t("pause"),
          Mute: t("mute"),
          Volume: t("volume"),
          "Enter Fullscreen": t("enterFullscreen"),
          "Exit Fullscreen": t("exitFullscreen"),
          "Seek Forward": t("seekForward"),
          "Seek Backward": t("seekBackward"),
        }}
      />
      <Gesture
        event="pointerup"
        action="toggle:paused"
        data-studio-play-toggle=""
        className="absolute inset-0 z-10"
        aria-hidden="true"
      />
      {controlDensity === "compact" ? <CompactControls /> : <FullControls />}
    </>
  );
}

function CompactControls() {
  const t = useTranslations("videoPlayer");
  const paused = useMediaState("paused");

  return (
    <Controls.Root
      hideDelay={1600}
      className="pointer-events-none invisible absolute inset-0 z-20 flex items-center justify-center opacity-0 transition-opacity duration-150 data-[visible]:visible data-[visible]:opacity-100 motion-reduce:transition-none"
    >
      <Controls.Group className="pointer-events-auto flex items-center justify-center">
        <PlayButton
          data-studio-play-toggle=""
          aria-label={paused ? t("play") : t("pause")}
          title={paused ? t("play") : t("pause")}
          className="grid size-12 place-items-center rounded-full bg-black/66 text-white shadow-[0_10px_32px_rgba(0,0,0,0.36)] outline-none backdrop-blur-sm transition-colors hover:bg-black/78 focus-visible:ring-2 focus-visible:ring-white/65 motion-reduce:transition-none"
        >
          {paused ? (
            <IconPlayerPlay className="size-5" stroke={2.2} />
          ) : (
            <IconPlayerPause className="size-5" stroke={2.2} />
          )}
        </PlayButton>
      </Controls.Group>
    </Controls.Root>
  );
}

function FullControls() {
  const t = useTranslations("videoPlayer");
  const paused = useMediaState("paused");
  const muted = useMediaState("muted");
  const volume = useMediaState("volume");
  const fullscreen = useMediaState("fullscreen");
  const silent = muted || volume === 0;

  return (
    <Controls.Root
      hideDelay={1800}
      className="pointer-events-none invisible absolute inset-0 z-20 flex items-end opacity-0 transition-opacity duration-150 data-[visible]:visible data-[visible]:opacity-100 motion-reduce:transition-none"
    >
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/88 via-black/48 to-transparent" />
      <Controls.Group className="pointer-events-auto relative flex h-[var(--studio-video-control-size)] w-full items-center gap-1 px-2 pb-1">
        <PlayButton
          data-studio-play-toggle=""
          aria-label={paused ? t("play") : t("pause")}
          title={paused ? t("play") : t("pause")}
          className={CONTROL_BUTTON_CLASS}
        >
          {paused ? (
            <IconPlayerPlay className="size-4" stroke={2.2} />
          ) : (
            <IconPlayerPause className="size-4" stroke={2.2} />
          )}
        </PlayButton>

        <TimeSlider.Root
          noSwipeGesture
          pauseWhileDragging
          aria-label={t("seek")}
          className="nowheel group/time-slider relative flex h-[var(--studio-video-control-size)] min-w-0 flex-1 touch-none items-center outline-none aria-hidden:hidden focus-visible:ring-2 focus-visible:ring-white/45"
        >
          <TimeSlider.Track className="relative h-[3px] w-full overflow-hidden rounded-full bg-white/20 transition-[height] group-data-[dragging]/time-slider:h-1 group-focus-visible/time-slider:h-1 group-hover/time-slider:h-1 motion-reduce:transition-none">
            <TimeSlider.Progress
              className="absolute inset-y-0 left-0 rounded-full bg-white/30"
              style={{ width: "var(--slider-progress)" }}
            />
            <TimeSlider.TrackFill
              className="absolute inset-y-0 left-0 rounded-full bg-white/88"
              style={{ width: "var(--slider-fill)" }}
            />
          </TimeSlider.Track>
          <TimeSlider.Thumb
            className="pointer-events-none absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow-[0_0_0_3px_rgba(255,255,255,0.18)] transition-opacity group-data-[dragging]/time-slider:opacity-100 group-focus-visible/time-slider:opacity-100 group-hover/time-slider:opacity-100 motion-reduce:transition-none"
            style={{ left: "var(--slider-fill)" }}
          />
        </TimeSlider.Root>

        <div className="flex shrink-0 items-center gap-0.5 whitespace-nowrap text-[length:var(--studio-video-time-size)] leading-none font-medium tabular-nums text-white/72">
          <Time type="current" />
          <span aria-hidden="true" className="text-white/32">
            /
          </span>
          <Time type="duration" />
        </div>

        <div className="group/volume relative size-[var(--studio-video-control-size)] shrink-0">
          <div className="absolute right-0 bottom-0 flex h-[var(--studio-video-control-size)] w-[var(--studio-video-control-size)] items-center justify-end rounded-full transition-[width,background-color,box-shadow] duration-150 group-hover/volume:w-28 group-hover/volume:bg-black/82 group-hover/volume:shadow-[0_8px_28px_rgba(0,0,0,0.34)] group-focus-within/volume:w-28 group-focus-within/volume:bg-black/82 group-focus-within/volume:shadow-[0_8px_28px_rgba(0,0,0,0.34)] motion-reduce:transition-none">
            <MuteButton
              aria-label={silent ? t("unmute") : t("mute")}
              title={silent ? t("unmute") : t("mute")}
              className={cn(CONTROL_BUTTON_CLASS, "order-2")}
            >
              {silent ? (
                <IconVolumeOff className="size-4" stroke={2} />
              ) : (
                <IconVolume className="size-4" stroke={2} />
              )}
            </MuteButton>

            <VolumeSlider.Root
              aria-label={t("volume")}
              className="nowheel group/volume-slider order-1 invisible relative flex h-[var(--studio-video-control-size)] w-0 touch-none items-center opacity-0 outline-none transition-[width,margin,opacity] duration-150 aria-hidden:hidden group-hover/volume:visible group-hover/volume:mr-1 group-hover/volume:ml-2 group-hover/volume:w-14 group-hover/volume:opacity-100 group-focus-within/volume:visible group-focus-within/volume:mr-1 group-focus-within/volume:ml-2 group-focus-within/volume:w-14 group-focus-within/volume:opacity-100 focus-visible:ring-2 focus-visible:ring-white/45 motion-reduce:transition-none"
            >
              <VolumeSlider.Track className="relative h-[3px] w-full overflow-hidden rounded-full bg-white/20">
                <VolumeSlider.TrackFill
                  className="absolute inset-y-0 left-0 rounded-full bg-white/78"
                  style={{ width: "var(--slider-fill)" }}
                />
              </VolumeSlider.Track>
              <VolumeSlider.Thumb
                className="pointer-events-none absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 transition-opacity group-data-[dragging]/volume-slider:opacity-100 group-focus-visible/volume-slider:opacity-100 group-hover/volume-slider:opacity-100 motion-reduce:transition-none"
                style={{ left: "var(--slider-fill)" }}
              />
            </VolumeSlider.Root>
          </div>
        </div>

        <FullscreenButton
          target="prefer-media"
          aria-label={fullscreen ? t("exitFullscreen") : t("enterFullscreen")}
          title={fullscreen ? t("exitFullscreen") : t("enterFullscreen")}
          className={cn(CONTROL_BUTTON_CLASS, "aria-hidden:hidden")}
        >
          {fullscreen ? (
            <IconArrowsMinimize className="size-4" stroke={2} />
          ) : (
            <IconArrowsMaximize className="size-4" stroke={2} />
          )}
        </FullscreenButton>
      </Controls.Group>
    </Controls.Root>
  );
}
