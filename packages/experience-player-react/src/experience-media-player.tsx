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
  /** Mute state applied straight to the element. The host calls this from the
   *  unmute click itself so the change rides the user activation instead of
   *  waiting for a render + effect. */
  setMuted(muted: boolean): void;
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
  onSoundBlocked,
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
  /** Called once when the browser refused audible playback and the clip had to
   *  fall back to muted, so the host can offer to turn sound on. */
  onSoundBlocked?: () => void;
  playbackIdentity: string;
  copy: ExperiencePlayerVideoCopy;
}) {
  const playerRef = useRef<MediaPlayerInstance>(null);
  // Live mute authority for the element. `muted` is the host's declared intent;
  // the autoplay fallback below can mute AHEAD of it, and a late `canplay` must
  // not undo that with a prop value React has not re-rendered yet — Chrome
  // pauses a video that is unmuted without user activation.
  const mutedRef = useRef(muted);
  const { src, type } = source;
  const playerSource = useMemo(() => normalizeVideoSource({ src, type }), [src, type]);
  useEffect(() => {
    mutedRef.current = muted;
    const player = playerRef.current;
    if (player) synchronizePlayerContract(player, durationSeconds, muted);
  }, [durationSeconds, muted]);
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !onPlaybackHandle) return;
    onPlaybackHandle({
      playbackIdentity,
      play: () => playWithSoundFallback(soundFallbackTarget(player), mutedRef, onSoundBlocked),
      pause: () => pauseMediaPlayer(player),
      setMuted: (nextMuted) => {
        mutedRef.current = nextMuted;
        applyPlayerMuted(player, nextMuted);
      },
    });
    return () => onPlaybackHandle(null);
  }, [onPlaybackHandle, onSoundBlocked, playbackIdentity]);
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
        if (player) synchronizePlayerContract(player, durationSeconds, mutedRef.current);
      }}
      onEnd={onEnd}
      onTimeUpdate={(detail) => emitValidTimeUpdate(onTimeUpdate, detail.currentTime)}
      // The element's own decode/source failure. Always fatal, never routine:
      // `MediaErrorDetail` is not a DOM exception and carries no `name` to
      // classify, so it goes straight to the host.
      onError={(detail) => onPlaybackError(detail.message)}
      // `play-fail` re-delivers the rejected `play()` DOM exception, so the
      // WHOLE error is handed to the classifier. Reducing it to `.message`
      // first — what this did before — threw away the `name` the verdict is
      // made on and left only localized browser prose, which can never decide
      // anything. Without the filter an `AbortError` raised by the `src` swap
      // between two clips reaches the host as a runtime-error dialog: the same
      // bug the handle-rejection path already fixes, arriving by the element's
      // own callback instead. Genuine decode/source failures are untouched —
      // they are not `AbortError`, and `onError` above reports them anyway.
      onPlayFail={(detail) => {
        if (isRoutinePlaybackInterruption(detail)) return;
        onPlaybackError(detail.message);
      }}
      // Same taxonomy, one level down: this detail wraps the rejection in
      // `{ muted, error }`, so the classifier has to be handed `detail.error`.
      onAutoPlayFail={(detail) => {
        if (isRoutinePlaybackInterruption(detail.error)) return;
        onPlaybackError(detail.error.message);
      }}
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

/** The only element surface the sound fallback needs, so the policy above can be
 *  reasoned about — and tested — without a media element. */
export interface ExperienceSoundFallbackTarget {
  play(): Promise<void>;
  setMuted(muted: boolean): void;
}

function soundFallbackTarget(player: MediaPlayerInstance): ExperienceSoundFallbackTarget {
  return {
    play: () => playMediaPlayer(player),
    setMuted: (muted) => applyPlayerMuted(player, muted),
  };
}

/**
 * `HTMLMediaElement.play()` rejects for several unrelated reasons and only one
 * of them is "the autoplay policy said no". Per spec that one is `NotAllowedError`.
 *
 * The others must NOT be answered by muting:
 *   - `AbortError` — a pending play was interrupted by a `src` swap or teardown.
 *     Routine during clip transitions; muting a run nobody blocked is a silent
 *     regression the viewer cannot explain, and the retry races the new source.
 *   - `NotSupportedError` — the source cannot be decoded. Muting changes nothing
 *     and swallows a real media failure the host needs to surface.
 */
function isAutoplayPolicyRefusal(error: unknown): boolean {
  return domExceptionName(error) === "NotAllowedError";
}

/**
 * Whether a rejected `play()` describes a *routine interruption* rather than a
 * failure of the experience.
 *
 * `AbortError` is the browser saying a pending `play()` was superseded — a `src`
 * swap, a teardown, a second `play()` — which is precisely what a normal clip
 * transition does. It carries no information the viewer could act on, so the
 * host must not answer it with a runtime-error dialog. Genuine media failures
 * (`NotSupportedError`, decode errors) are NOT routine and still reach the host.
 *
 * A rejected `play()` can arrive by two independent routes and BOTH are gated on
 * this verdict, or the dialog simply comes back on the ungated one: the promise
 * the host awaits through `ExperienceMediaPlaybackHandle.play`, and the
 * element's own `play-fail` / `auto-play-fail` callbacks above. The element's
 * `error` event is a third route and is deliberately NOT gated — it reports
 * decode/source failures, which are never routine.
 *
 * Lives next to `isAutoplayPolicyRefusal` because this module owns the
 * DOM-exception taxonomy; the host consumes the verdict, never the `name`.
 */
export function isRoutinePlaybackInterruption(error: unknown): boolean {
  return domExceptionName(error) === "AbortError";
}

/**
 * Read `name` off the object rather than testing `instanceof DOMException`, so a
 * rejection crossing a realm — iframe, worker, test double — is still classified
 * by what it says it is. Never look at `message`: it is browser prose and it is
 * localized.
 */
function domExceptionName(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("name" in error)) return undefined;
  const { name } = error as { name?: unknown };
  return typeof name === "string" ? name : undefined;
}

/**
 * Play with sound, and fall back to muted only when the browser refuses on
 * autoplay-policy grounds.
 *
 * There is no way to ask a browser up front whether audible playback is
 * allowed — the rejected `play()` IS the answer — so we always try with sound.
 * Every other rejection is rethrown to the host's playback-error path, where a
 * real failure belongs.
 *
 * The retry happens at most once, gated on the element's live mute state: if
 * the clip was already muted when playback was refused, muting cannot be the
 * fix, so the rejection propagates instead of looping.
 */
export async function playWithSoundFallback(
  target: ExperienceSoundFallbackTarget,
  mutedRef: { current: boolean },
  onSoundBlocked: (() => void) | undefined
): Promise<void> {
  try {
    await target.play();
  } catch (error) {
    if (!isAutoplayPolicyRefusal(error) || mutedRef.current) throw error;
    mutedRef.current = true;
    target.setMuted(true);
    onSoundBlocked?.();
    await target.play();
  }
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
  applyPlayerMuted(player, muted);
}

function applyPlayerMuted(player: MediaPlayerInstance, muted: boolean): void {
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
