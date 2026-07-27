"use client";

import {
  MediaAnnouncer,
  MediaPlayer,
  MediaProvider,
  Poster,
  type MediaPlayerInstance,
  type PlayerSrc,
  type VideoMimeType,
} from "@vidstack/react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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

/**
 * The clip the element is sourced from. Held in state, one render behind the
 * props, because `source` is the load-bearing field: writing it blanks the
 * element, so the outgoing frame has to be copied off the element before the
 * write lands. `poster`, `clipStartTime` and `durationSeconds` travel with it so
 * the element is never described by one clip and sourced from another, and the
 * `uri` travels with it because that — not `identity`, and not the `source`
 * object, which is rebuilt whenever any of these change — is what says the
 * element is about to be blanked.
 */
interface MediaClip {
  readonly identity: string;
  readonly uri: string;
  readonly source: PlayerSrc;
  readonly poster?: string;
  readonly clipStartTime?: number;
  readonly durationSeconds?: number;
}

/**
 * Renders one clip on one media element, and covers each cut with a still frame.
 *
 * Two constraints meet here.
 *
 * A media element shows nothing between the moment its source changes and the
 * moment the new source has decoded a frame, so the stage falls through to the
 * black backdrop on every cut. Preloading cannot fix it — the bytes are already
 * there, the element simply has not painted them yet.
 *
 * And the element cannot be doubled, swapped or remounted to hide that. WebKit
 * grants audible playback to the ELEMENT a user gesture played, and every clip
 * after the first is started from an effect, so a second element — or a
 * remounted one — is refused sound from the cut onwards and the viewer is handed
 * the Unmute button again at every cut.
 *
 * So the frame the outgoing clip painted is copied to a canvas stacked over the
 * element, in the same commit that swaps the source, and taken down when the new
 * source reports `playing` — the point at which it is producing pixels of its
 * own. Nothing is timed: a clip that takes a while holds the previous frame for
 * as long as it needs, and a hold reads as a held shot where a hole reads as a
 * bug. A frame that cannot be copied leaves the cut uncovered, which is the
 * backdrop flash this replaced and never worse than it.
 */
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
  durationSeconds?: number;
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
  const { src, type } = source;
  const clip = useMemo<MediaClip>(
    () => ({
      identity: playbackIdentity,
      uri: src,
      source: normalizeVideoSource({ src, type }),
      poster,
      clipStartTime,
      durationSeconds,
    }),
    [clipStartTime, durationSeconds, playbackIdentity, poster, src, type]
  );
  const playerRef = useRef<MediaPlayerInstance>(null);
  const stillFrameRef = useRef<HTMLCanvasElement>(null);
  // Live mute authority for the element. `muted` is the host's declared intent;
  // the autoplay fallback below can mute AHEAD of it, and a late `canplay` must
  // not undo that with a prop value React has not re-rendered yet — Chrome
  // pauses a video that is unmuted without user activation.
  const mutedRef = useRef(muted);
  const [rendered, setRendered] = useState(clip);
  const [stillFrameHeld, setStillFrameHeld] = useState(false);
  const { durationSeconds: renderedDuration } = rendered;
  useLayoutEffect(() => {
    if (rendered === clip) return;
    // A layout effect because of what is still true at this point: the DOM holds
    // the outgoing source, so there is a frame to copy — and the state written
    // here is flushed into the same pre-paint commit as the source swap, so the
    // browser never gets a frame in which the element has been blanked and
    // nothing covers it.
    //
    // Only a new source blanks anything. A clip that keeps its URI and moves
    // `clipStartTime` — the tail wait loop — seeks instead, and a seeking element
    // goes on showing the frame it already has; covering that would be a freeze,
    // because a seek inside a buffered source need not report `playing` again.
    if (clip.uri !== rendered.uri) {
      const capture = captureStillFrame(stillFrameRef.current, providerVideo(playerRef.current));
      setStillFrameHeld((held) => holdsStillFrame(capture, held));
    }
    setRendered(clip);
  }, [clip, rendered]);
  useEffect(() => {
    mutedRef.current = muted;
    const player = playerRef.current;
    if (player) synchronizePlayerContract(player, renderedDuration, muted);
  }, [muted, renderedDuration]);
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !onPlaybackHandle) return;
    // Keyed on the clip the element is SOURCED from, not the prop: the host
    // answers a registration by playing it, and a handle offered while the
    // element still holds the outgoing source would play the clip the viewer
    // just left.
    //
    // Keyed on the source as well as the identity, because a source is what a
    // write to `src` stops: rotating the device re-resolves the same clip to its
    // other orientation, and without a fresh registration nothing would start
    // the newly loaded source — leaving a still frame over a stalled element
    // with no `playing` coming to take it down.
    onPlaybackHandle({
      playbackIdentity: rendered.identity,
      play: () => playWithSoundFallback(soundFallbackTarget(player), mutedRef, onSoundBlocked),
      pause: () => pauseMediaPlayer(player),
      setMuted: (nextMuted) => {
        mutedRef.current = nextMuted;
        applyPlayerMuted(player, nextMuted);
      },
    });
    return () => onPlaybackHandle(null);
  }, [onPlaybackHandle, onSoundBlocked, rendered.identity, rendered.uri]);
  return (
    <MediaPlayer
      ref={playerRef}
      src={rendered.source}
      title={title}
      ariaLabel={title}
      viewType="video"
      streamType="on-demand"
      controls={false}
      autoPlay={autoPlay}
      muted={muted}
      loop={loop}
      duration={renderedDuration}
      clipStartTime={rendered.clipStartTime ?? 0}
      playsInline
      preload="metadata"
      load="eager"
      poster={rendered.poster}
      posterLoad="eager"
      keyTarget="player"
      logLevel="silent"
      onCanPlay={() => {
        const player = playerRef.current;
        if (player) synchronizePlayerContract(player, renderedDuration, mutedRef.current);
      }}
      // Takes the still frame down, and the reason none of this is on a timer.
      // `playing` is the earliest event that means the element is presenting the
      // source it was just given: `can-play` only promises decodable data, and
      // `time-update` is dispatched off seeks and while paused too, so either one
      // can uncover a cut that has not been composited yet.
      onPlaying={() => setStillFrameHeld(false)}
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
        {rendered.poster ? (
          <Poster
            src={rendered.poster}
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
      {/* The cut cover. Ordered after the provider because DOM order is paint
          order for absolute siblings with no z-index, so this has to come last
          to sit over the blank element and over the incoming clip's poster. It
          stays mounted while off stage — `hidden` keeps the captured bitmap,
          unmounting would throw away the ref the next capture draws into — and
          takes its box from the same fit rules as the element, so the frame is
          cropped exactly as the clip it froze. */}
      <canvas
        ref={stillFrameRef}
        hidden={!stillFrameHeld}
        aria-hidden="true"
        data-experience-still-frame=""
        className={classNames(
          "pointer-events-none absolute inset-0 size-full select-none",
          fit === "cover" ? "object-cover" : "object-contain",
          "group-data-[fullscreen]/experience-video:object-contain"
        )}
      />
      <ExperienceVideoSurface copy={copy} />
    </MediaPlayer>
  );
}

function ExperienceVideoSurface({ copy }: { copy: ExperiencePlayerVideoCopy }) {
  // Interactive-film playback is story-driven: no scrub bar, no time readout,
  // no fullscreen chrome (the shell is already full-bleed), and no pause.
  //
  // A tap used to toggle pause, which fights the medium: the surface is also
  // where choices and anchored interactions are read, so the gesture that means
  // "act on the story" and the gesture that means "stop the story" were the
  // same one. A paused scene also stalls the exit that advances it, because
  // advancement is driven by the clip ending. The announcer stays — assistive
  // tech still needs to hear what playback is doing.
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

/**
 * What copying the outgoing frame achieved. Three-way because the two ways it
 * can fail mean opposite things to the cover: `unavailable` never touched the
 * canvas, so a frame copied at an earlier cut is still on it; `refused` cleared
 * the canvas on the way to failing, so there is nothing left to show.
 */
type StillFrameCapture = "captured" | "unavailable" | "refused";

/**
 * Copy the frame the element is showing into the cover canvas.
 *
 * Clips are delivered by a redirect from our own API to signed storage, so the
 * frame is cross-origin and the canvas ends up tainted. That costs nothing here:
 * the canvas is only ever composited, never read back, and asking for CORS mode
 * instead — a `crossOrigin` attribute — would fail the load outright against a
 * storage host that answers without `Access-Control-Allow-Origin`. An engine
 * that refuses to draw the frame at all is still reported, because the resize
 * that precedes the draw has already cleared the bitmap.
 */
function captureStillFrame(
  canvas: HTMLCanvasElement | null,
  media: HTMLVideoElement | null
): StillFrameCapture {
  if (!canvas || !media || media.readyState < media.HAVE_CURRENT_DATA) return "unavailable";
  const { videoWidth, videoHeight } = media;
  if (videoWidth <= 0 || videoHeight <= 0) return "unavailable";
  const context = canvas.getContext("2d");
  if (!context) return "unavailable";
  try {
    canvas.width = videoWidth;
    canvas.height = videoHeight;
    context.drawImage(media, 0, 0);
    return "captured";
  } catch {
    return "refused";
  }
}

/** Whether the still frame covers the stage once a capture has been attempted. */
function holdsStillFrame(capture: StillFrameCapture, held: boolean): boolean {
  if (capture === "captured") return true;
  // Nothing was drawn, so a frame copied at an earlier cut is still on the
  // canvas — and while the incoming clip has yet to paint, still worth showing.
  if (capture === "unavailable") return held;
  return false;
}

/** The `<video>` the provider drives, when the provider has a frame to give.
 *  Audio and the embedded providers do not, and this player only loads `video/*`
 *  anyway, so anything else is treated as nothing to copy. */
function providerVideo(player: MediaPlayerInstance | null): HTMLVideoElement | null {
  const provider = player?.provider;
  if (provider?.type === "video" || provider?.type === "hls" || provider?.type === "dash") {
    return provider.video;
  }
  return null;
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
  durationSeconds: number | undefined,
  muted: boolean
): void {
  if (durationSeconds !== undefined) player.duration = durationSeconds;
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
