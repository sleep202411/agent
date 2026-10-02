"use client";

import {
  MediaAnnouncer,
  MediaPlayer,
  MediaProvider,
  Poster,
  type MediaPlayerInstance,
  type MediaProviderInstance,
  type PlayerSrc,
} from "@vidstack/react";
import type Hls from "hls.js";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { classNames } from "./class-names";
import {
  ExperiencePlaybackDeliveryContext,
  configureExperienceMediaProvider,
  experiencePrefersNativeHls,
  type ExperienceDeclaredSource,
  type ExperiencePlaybackSource,
} from "./experience-playback-delivery";
import type { ExperiencePlayerVideoCopy } from "./experience-player-copy";
import { EXPERIENCE_VIDEO_LOADERS, normalizeVideoSource } from "./experience-video-source";

export interface ExperienceMediaPlaybackHandle {
  readonly playbackIdentity: string;
  /**
   * Plays the element now, synchronously, for the user activation that calls
   * this: WebKit lets an element play later only once a `play()` ran inside one.
   * Null when there is nothing to play — no element, or a clip at its end.
   */
  playInGesture(): Promise<void> | null;
  play(): Promise<void>;
  pause(): void;
  seek(seconds: number): void;
  /** Mute state applied straight to the element. The host calls this from the
   *  unmute click itself so the change rides the user activation instead of
   *  waiting for a render + effect. */
  setMuted(muted: boolean): void;
  /** Whether the clip has played to its end: playing it again would start it over. */
  ended(): boolean;
  /** The element the clip is on; a still has none. */
  element(): HTMLMediaElement | null;
}

interface MediaReadinessWaiter {
  resolve: () => void;
  reject: (reason: unknown) => void;
}

/**
 * A source-scoped readiness latch for imperative playback.
 *
 * Vidstack deliberately rejects `player.play()` before `can-play`. The host,
 * however, can receive a playback handle before Vidstack has attached its
 * native provider, especially when the viewer presses Start immediately. That
 * is loading, not failure: callers wait here until the source becomes playable.
 * A source swap aborts the old wait so a stale clip can never start later.
 */
export class ExperienceMediaReadinessGate {
  private key: string;
  private ready = false;
  private failure: unknown = null;
  private readonly waiters = new Set<MediaReadinessWaiter>();

  constructor(key: string) {
    this.key = key;
  }

  wait(key: string): Promise<void> {
    if (key !== this.key) return Promise.reject(mediaReadinessAbort());
    if (this.failure !== null) return Promise.reject(this.failure);
    if (this.ready) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      this.waiters.add({ resolve, reject });
    });
  }

  markReady(key: string): void {
    if (key !== this.key || this.ready || this.failure !== null) return;
    this.ready = true;
    this.settleWaiters((waiter) => waiter.resolve());
  }

  fail(key: string, error: unknown): void {
    if (key !== this.key || this.failure !== null) return;
    this.failure = error;
    this.settleWaiters((waiter) => waiter.reject(error));
  }

  reset(key: string): void {
    if (key === this.key) {
      // React Strict Mode replays layout-effect setup after immediately running
      // its cleanup. The cleanup must reject a pending play on real unmount,
      // but the replay is the same live source and must reopen that cancelled
      // latch or every later play request will inherit the synthetic abort.
      if (this.failure instanceof MediaReadinessAbortError) {
        this.ready = false;
        this.failure = null;
      }
      return;
    }
    this.cancel(this.key);
    this.key = key;
    this.ready = false;
    this.failure = null;
  }

  cancel(key: string): void {
    if (key !== this.key || this.failure !== null) return;
    const error = mediaReadinessAbort();
    this.failure = error;
    this.settleWaiters((waiter) => waiter.reject(error));
  }

  private settleWaiters(settle: (waiter: MediaReadinessWaiter) => void): void {
    this.waiters.forEach(settle);
    this.waiters.clear();
  }
}

class MediaReadinessAbortError extends Error {
  override readonly name = "AbortError";
}

function mediaReadinessAbort(): Error {
  return new MediaReadinessAbortError("Media source changed before playback became ready.");
}

/**
 * The clip the element is sourced from. Held in state, one render behind the
 * props, because `source` is the load-bearing field: writing it blanks the
 * element, so the outgoing frame has to be copied off the element before the
 * write lands. `poster`, `clipStartTime`, `durationSeconds` and `loop` travel
 * with it so the element is never described by one clip and sourced from
 * another, and the `uri` travels with it because that — not `identity`, and not
 * the `source` object, which is rebuilt whenever any of these change — is what
 * says the element is about to be blanked. `playback` is the answer the clip
 * is played from: what the element loads (`uri` — a negotiated HLS master, or
 * the declared file), how it is delivered, and the manifest URI it stands in for.
 */
interface MediaClip {
  readonly identity: string;
  readonly uri: string;
  readonly playback: ExperiencePlaybackSource;
  readonly source: PlayerSrc;
  readonly poster?: string;
  readonly clipStartTime?: number;
  readonly durationSeconds?: number;
  readonly loop: boolean;
}

/** A declared clip played as it is, for players outside any delivery. */
function declaredPlayback(declared: ExperienceDeclaredSource): ExperiencePlaybackSource {
  return {
    src: declared.src,
    type: declared.type,
    delivery: "progressive",
    declaredSrc: declared.src,
  };
}

/**
 * Hands the media element back to the provider after its loader changed.
 *
 * Vidstack (1.15) runs a loader only when it is given the media element, which
 * its React outlet does once, when the element is created. hls.js and native
 * playback both render a `<video>`, so a cut between an HLS clip and a
 * progressive one — a film whose clips are not all transcoded yet, or a
 * QuickTime upload next to an MP4 — changes the loader on the same element: the
 * old provider is torn down and nothing builds the new one, leaving the element
 * empty. Loading again runs the new loader on that same element, so the
 * audible-playback grant WebKit tied to it survives the cut.
 */
function reloadProvider(provider: MediaProviderInstance | null): void {
  const media = provider?.el?.querySelector<HTMLMediaElement>("video, audio");
  if (provider && media) provider.load(media);
}

/**
 * `playsinline` on the `<video>` from its first render, not once Vidstack is
 * ready: a play before that would open iPhone's native fullscreen player.
 * Vidstack spreads `mediaProps` onto the element, but types them for any media
 * element, and `playsInline` belongs to video alone.
 */
const INLINE_PLAYBACK = { playsInline: true } as const;

/** `onProviderChange` for a player outside any delivery. */
function configureStandaloneProvider(
  provider: Parameters<typeof configureExperienceMediaProvider>[0]
): void {
  configureExperienceMediaProvider(provider, null);
}

function negotiationErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return String(error);
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
 *
 * Under a delivery (see ExperiencePlaybackDelivery) the declared clip may first
 * have to be negotiated into what the element actually loads. Until that answer
 * is in, the element keeps the clip it has — paused on the outgoing frame, with
 * no handle offered for it and nothing it reports passed on — so a pending cut
 * is one more held beat, never a blank or the wrong clip played.
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
  onPlaybackInterrupted,
  onPlaybackRefused,
  onSoundBlocked,
  onContentSize,
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
  /** Something other than the player — the system, the OS media controls —
   *  paused the clip while it was playing as the player asked. */
  onPlaybackInterrupted?: () => void;
  /** The browser refused a play Vidstack started on its own — a loop, the play
   *  after a seek to the end — while the player wanted the clip playing. The
   *  player's own plays report a refusal through their promise instead. */
  onPlaybackRefused?: () => void;
  /** Called once when the browser refused audible playback and the clip had to
   *  fall back to muted, so the host can offer to turn sound on. */
  onSoundBlocked?: () => void;
  /** Decoded frame size, used when the manifest omits technical dimensions. */
  onContentSize?: (size: { width: number; height: number }) => void;
  playbackIdentity: string;
  copy: ExperiencePlayerVideoCopy;
}) {
  const { src, type } = source;
  const delivery = useContext(ExperiencePlaybackDeliveryContext);
  const declared = useMemo<ExperienceDeclaredSource>(
    () => ({ src, type: type ?? null }),
    [src, type]
  );
  const asDeclared = useMemo(() => declaredPlayback(declared), [declared]);
  // The answer the element is sourced from, pinned for as long as the props
  // name that clip. The delivery may evict or forget it (a fatal stream error
  // does); that changes what the next player to load the clip is told, never
  // what this one is playing — asking again is a restart's job, not a retry
  // hidden behind the error the viewer is looking at.
  const [pinned, setPinned] = useState<ExperiencePlaybackSource | null>(
    () => delivery?.peek(declared) ?? null
  );
  const playback =
    pinned?.declaredSrc === src ? pinned : delivery ? delivery.peek(declared) : asDeclared;
  // Read through a ref so a host re-render — which hands over a new callback —
  // cannot restart a negotiation that already failed.
  const onPlaybackErrorRef = useRef(onPlaybackError);
  onPlaybackErrorRef.current = onPlaybackError;
  useEffect(() => {
    if (!delivery || playback) return;
    let cancelled = false;
    delivery.resolve(declared).then(
      (resolved) => {
        if (!cancelled) setPinned(resolved);
      },
      (error: unknown) => {
        // Verbatim: a refused clip (403/410) names its own reason, and a broken
        // answer names the field it broke on. Nothing falls back to /content.
        if (!cancelled) onPlaybackErrorRef.current(negotiationErrorMessage(error));
      }
    );
    return () => {
      cancelled = true;
    };
  }, [declared, delivery, playback]);
  const clip = useMemo<MediaClip | null>(
    () =>
      playback
        ? {
            identity: playbackIdentity,
            uri: playback.src,
            playback,
            source: normalizeVideoSource(playback),
            poster,
            clipStartTime,
            durationSeconds,
            loop,
          }
        : null,
    [clipStartTime, durationSeconds, loop, playback, playbackIdentity, poster]
  );
  const playerRef = useRef<MediaPlayerInstance>(null);
  const providerRef = useRef<MediaProviderInstance>(null);
  const stillFrameRef = useRef<HTMLCanvasElement>(null);
  // Live mute authority for the element. `muted` is the host's declared intent;
  // the autoplay fallback below can mute AHEAD of it, and a late `canplay` must
  // not undo that with a prop value React has not re-rendered yet — Chrome
  // pauses a video that is unmuted without user activation.
  const mutedRef = useRef(muted);
  const [rendered, setRendered] = useState<MediaClip | null>(clip);
  const [stillFrameHeld, setStillFrameHeld] = useState(false);
  const renderedDuration = rendered?.durationSeconds;
  const renderedIdentity = rendered?.identity ?? null;
  const renderedUri = rendered?.uri ?? null;
  const readinessKey = rendered ? `${rendered.identity}\u0000${rendered.uri}` : null;
  const readinessRef = useRef<ExperienceMediaReadinessGate | null>(null);
  // Opened lazily: a clip still being negotiated on first mount has no key yet.
  if (!readinessRef.current && readinessKey !== null) {
    readinessRef.current = new ExperienceMediaReadinessGate(readinessKey);
  }
  // The source hls.js has already spent its one recovery on (see `onHlsError`),
  // and the source that has failed for good (see `failRendered`). Both count
  // per load: a clip that comes back to the element is loaded afresh.
  const hlsRecoveryRef = useRef<string | null>(null);
  const failedRef = useRef<string | null>(null);
  // Whether Vidstack has a provider on the element. A handle is offered only
  // then: a Start tap that lands earlier would play nothing inside the click,
  // and WebKit grants playback only to an element a click played.
  const [providerAttached, setProviderAttached] = useState(false);
  // What the player last asked of the element. It is the only party that starts
  // or stops a clip, so a play it did not ask for is stopped again (`onPlay`),
  // and a pause it did not ask for is someone else's (`onPause`).
  const intentRef = useRef<"play" | "pause">("pause");
  // Whether the clip on the element has played. A pause before that is the load.
  const reachedPlayingRef = useRef(false);
  // Vidstack pauses a playing element as the player disconnects, and that pause
  // can arrive before the passive cleanup withdraws the handle. It is the
  // player's own, so the intent drops here, in the layout cleanup, ahead of it.
  useLayoutEffect(
    () => () => {
      intentRef.current = "pause";
    },
    []
  );
  useLayoutEffect(() => {
    if (clip === null) {
      // Nothing to source yet: the element keeps the clip it has, and with it
      // the frame on screen, until the incoming clip's answer arrives. On a cut
      // that frame is held, not played on: the outgoing clip would go on
      // sounding under the viewer's choice, towards an end no longer its own.
      if (rendered !== null && rendered.identity !== playbackIdentity) {
        intentRef.current = "pause";
        providerMedia(playerRef.current)?.pause();
      }
      return;
    }
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
    if (rendered !== null && clip.uri !== rendered.uri) {
      const capture = captureStillFrame(stillFrameRef.current, providerVideo(playerRef.current));
      setStillFrameHeld((held) => holdsStillFrame(capture, held));
    }
    setPinned(clip.playback);
    setRendered(clip);
  }, [clip, playbackIdentity, rendered]);
  // A layout effect, so the clip is staged before the passive effects of the
  // commit that brought it: the host plans its look-ahead in one of those, and
  // must already find this clip taken. Keyed on the declared clip, so one still
  // being negotiated counts — it lands on this element once answered.
  useLayoutEffect(() => {
    delivery?.markStaged(src);
  }, [delivery, src]);
  useLayoutEffect(() => {
    hlsRecoveryRef.current = null;
    failedRef.current = null;
    // A clip new to the element has not played, and waits for the host to play it.
    intentRef.current = "pause";
    reachedPlayingRef.current = false;
    const readiness = readinessRef.current;
    if (!readiness || readinessKey === null) return;
    readiness.reset(readinessKey);
    return () => readiness.cancel(readinessKey);
  }, [readinessKey]);
  useEffect(() => {
    mutedRef.current = muted;
    const player = playerRef.current;
    if (player) synchronizePlayerContract(player, renderedDuration, muted);
  }, [muted, renderedDuration]);
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !providerAttached || !onPlaybackHandle || readinessKey === null) return;
    // Keyed on the clip the element is SOURCED from, not the prop: the host
    // answers a registration by playing it, and a handle offered while the
    // element still holds the outgoing source would play the clip the viewer
    // just left. That includes the wait for a negotiation: until the incoming
    // clip is on the element there is no handle at all.
    //
    // Keyed on the source as well as the identity, because a source is what a
    // write to `src` stops: rotating the device re-resolves the same clip to its
    // other orientation, and without a fresh registration nothing would start
    // the newly loaded source — leaving a still frame over a stalled element
    // with no `playing` coming to take it down.
    if (renderedIdentity !== playbackIdentity) return;
    let disposed = false;
    let playVersion = 0;
    onPlaybackHandle({
      playbackIdentity: renderedIdentity,
      playInGesture: () => {
        const media = providerMedia(player);
        if (disposed || !media || clipEnded(player, media) || finishAtEnd(player, media)) {
          return null;
        }
        intentRef.current = "play";
        return media.play();
      },
      play: () => {
        const version = ++playVersion;
        const assertActive = () => {
          if (disposed || version !== playVersion) throw mediaReadinessAbort();
        };
        if (!disposed) intentRef.current = "play";
        return playWithSoundFallback(
          soundFallbackTarget(player, readinessRef.current!, readinessKey, assertActive),
          mutedRef,
          onSoundBlocked
        );
      },
      pause: () => {
        if (disposed) return;
        intentRef.current = "pause";
        playVersion++;
        pauseMediaPlayer(player);
      },
      seek: (seconds) => {
        if (!disposed) seekMediaPlayer(player, seconds);
      },
      setMuted: (nextMuted) => {
        if (disposed) return;
        mutedRef.current = nextMuted;
        applyPlayerMuted(player, nextMuted);
      },
      ended: () => {
        const media = providerMedia(player);
        return media !== null && clipEnded(player, media);
      },
      element: () => (disposed ? null : providerMedia(player)),
    });
    return () => {
      disposed = true;
      playVersion++;
      // Nothing the player holds no handle for is a clip it wants playing.
      intentRef.current = "pause";
      onPlaybackHandle(null);
    };
  }, [
    onPlaybackHandle,
    onSoundBlocked,
    playbackIdentity,
    providerAttached,
    readinessKey,
    renderedIdentity,
    renderedUri,
  ]);
  if (rendered === null || readinessKey === null) {
    // First mount of a clip whose answer is still out: there is no element to
    // keep yet, so the poster holds the frame and no handle is offered — the
    // host's Start waits for one.
    return (
      <div
        data-experience-video-pending=""
        aria-busy="true"
        aria-label={title}
        className="relative size-full bg-black"
      >
        {poster ? (
          <img
            src={poster}
            alt=""
            draggable={false}
            className={classNames(
              "pointer-events-none absolute inset-0 size-full select-none",
              fit === "cover" ? "object-cover" : "object-contain"
            )}
          />
        ) : null}
      </div>
    );
  }
  // Whether the element holds the clip the props describe. Not while a cut
  // waits on its negotiation: the element still holds the outgoing clip, but
  // every callback below already belongs to the incoming one, which must hear
  // nothing of the outgoing clip's time, end, size or failure.
  const current = rendered.identity === playbackIdentity;
  // Whether what the element reports still belongs to the story. Not once its
  // clip has failed: the element can play on through what it had buffered, to
  // an end the story must not take behind the error. Asked when the event
  // arrives, because a failure lands between renders.
  const live = () => current && failedRef.current !== readinessKey;
  // The clip on the element failed for good, which only its first failure
  // says: what the dying element reports after it would bury the cause. Its
  // answer is retired — a restart asks the server again instead of replaying
  // the master that just failed — a play waiting on it gives up, and if it is
  // the current clip, the element stops and the host is told.
  const failRendered = (message: string) => {
    if (failedRef.current === readinessKey) return;
    failedRef.current = readinessKey;
    if (rendered.playback.delivery === "hls") delivery?.forget(rendered.playback.declaredSrc);
    readinessRef.current?.fail(readinessKey, new Error(message));
    if (!current) return;
    intentRef.current = "pause";
    providerMedia(playerRef.current)?.pause();
    onPlaybackError(message);
  };
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
      loop={rendered.loop}
      duration={renderedDuration}
      clipStartTime={rendered.clipStartTime ?? 0}
      playsInline
      // The entry clip buffers behind the title card, so Start begins on media
      // that is already there; every later clip was opened by the look-ahead.
      preload="auto"
      load="eager"
      preferNativeHLS={experiencePrefersNativeHls()}
      onProviderChange={(provider) => {
        (delivery ? delivery.configureProvider : configureStandaloneProvider)(provider);
        setProviderAttached(provider !== null);
      }}
      onProviderLoaderChange={() => reloadProvider(providerRef.current)}
      poster={rendered.poster}
      posterLoad="eager"
      // The story owns playback: no key may toggle, seek, mute or fullscreen
      // the clip (Space, k, arrows, j/l, digits, m, f, i, < and >).
      keyDisabled
      logLevel="silent"
      onCanPlay={() => {
        readinessRef.current?.markReady(readinessKey);
        const player = playerRef.current;
        if (player) synchronizePlayerContract(player, renderedDuration, mutedRef.current);
        if (live()) reportDecodedContentSize(playerRef.current, onContentSize);
      }}
      // Takes the still frame down, and the reason none of this is on a timer.
      // `playing` is the earliest event that means the element is presenting the
      // source it was just given: `can-play` only promises decodable data, and
      // `time-update` is dispatched off seeks and while paused too, so either one
      // can uncover a cut that has not been composited yet.
      onPlaying={() => {
        reachedPlayingRef.current = true;
        setStillFrameHeld(false);
      }}
      // A play the player did not ask for — a browser resuming background media,
      // Vidstack playing on after a seek into the last second, the OS media
      // controls — is stopped again: the story decides when its clip runs.
      onPlay={() => {
        if (live() && intentRef.current === "pause") providerMedia(playerRef.current)?.pause();
      }}
      // A pause the player did not ask for, of a clip that was playing and had
      // not reached its end: the system (a call, headphones out) or the OS
      // controls stopped it, and the story stops with it. Vidstack also
      // announces a pause of its own as a clip ends, so only an element that is
      // really paused short of its end counts.
      onPause={() => {
        const player = playerRef.current;
        const media = providerMedia(player);
        if (!live() || intentRef.current !== "play" || !reachedPlayingRef.current) return;
        if (!player || !media || !media.paused || clipEnded(player, media)) return;
        intentRef.current = "pause";
        onPlaybackInterrupted?.();
      }}
      onEnd={() => {
        if (live()) onEnd();
      }}
      onTimeUpdate={(detail) => {
        if (!live()) return;
        reportDecodedContentSize(playerRef.current, onContentSize);
        emitValidTimeUpdate(onTimeUpdate, detail.currentTime);
      }}
      // The element's own decode/source failure. Always fatal, never routine:
      // `MediaErrorDetail` is not a DOM exception and carries no `name` to
      // classify, so it goes straight to the host. hls.js fatal errors arrive
      // here too — all but its media errors, which `onHlsError` takes.
      onError={(detail) => failRendered(detail.message)}
      // Vidstack answers every fatal hls.js media error with
      // `recoverMediaError()` and never reports it, so a stream this browser
      // cannot play would stall with no error shown. This runs just before that
      // recovery, so it decides: each load of a source gets one, codecs the
      // browser cannot decode get none, nor does a clip that has already
      // failed, and otherwise hls.js lets go of the element — leaving the
      // recovery nothing to re-attach — and the failure is reported as hls.js
      // wrote it.
      onHlsError={(detail) => {
        const provider = playerRef.current?.provider;
        const hls = provider?.type === "hls" ? provider.instance : null;
        if (!current || !hls || !detail.fatal) return;
        const { ErrorTypes, ErrorDetails } = hls.constructor as typeof Hls;
        if (detail.type !== ErrorTypes.MEDIA_ERROR) return;
        const undecodable =
          detail.details === ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR ||
          detail.details === ErrorDetails.BUFFER_INCOMPATIBLE_CODECS_ERROR;
        if (!undecodable && live() && hlsRecoveryRef.current !== readinessKey) {
          hlsRecoveryRef.current = readinessKey;
          return;
        }
        hls.detachMedia();
        failRendered(detail.error.message || detail.details);
      }}
      // `play-fail` re-delivers the rejected `play()` DOM exception, so the
      // WHOLE error is handed to the classifier. Reducing it to `.message`
      // first — what this did before — threw away the `name` the verdict is
      // made on and left only localized browser prose, which can never decide
      // anything. Without the filter an `AbortError` raised by the `src` swap
      // between two clips reaches the host as a runtime-error dialog. Genuine
      // decode/source failures are untouched — they are neither of those, and
      // `onError` above reports them anyway.
      //
      // Only a play made through Vidstack fails here, and the player's own plays
      // go straight to the element (see playMediaPlayerWhenReady), so a
      // `NotAllowedError` here is a play Vidstack started itself: the next turn
      // of a loop, the play after a seek to the end. Dropped, it would leave the
      // clip frozen with nothing to say why; while the player wants the clip
      // playing, it is the refusal it is.
      onPlayFail={(detail) => {
        if (!live()) return;
        if (isAutoplayPolicyRefusal(detail)) {
          if (intentRef.current === "play") onPlaybackRefused?.();
          return;
        }
        if (isSurfacedPlaybackEvent(detail)) onPlaybackError(detail.message);
      }}
      // Same taxonomy, one level down: this detail wraps the rejection in
      // `{ muted, error }`, so the classifier has to be handed `detail.error`.
      onAutoPlayFail={(detail) => {
        if (!live() || !isSurfacedPlaybackEvent(detail.error)) return;
        onPlaybackError(detail.error.message);
      }}
      className="group/experience-video relative flex size-full overflow-hidden bg-black outline-none data-[fullscreen]:fixed data-[fullscreen]:inset-0 data-[fullscreen]:z-[9999] data-[fullscreen]:h-screen data-[fullscreen]:w-screen"
      data-experience-video-player=""
    >
      <MediaProvider
        ref={providerRef}
        loaders={EXPERIENCE_VIDEO_LOADERS}
        className="absolute inset-0 flex size-full items-center overflow-hidden bg-black"
        mediaProps={{
          className: classNames(
            "block size-full select-none",
            fit === "cover" ? "object-cover" : "object-contain",
            "group-data-[fullscreen]/experience-video:object-contain"
          ),
          draggable: false,
          ...INLINE_PLAYBACK,
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
  // no fullscreen chrome (the shell is already full-bleed), and no pause here.
  //
  // A tap on the clip does not pause it: the surface is also where choices and
  // anchored interactions are read, so the gesture that means "act on the
  // story" and the gesture that means "stop the story" would be the same one.
  // Pausing belongs to the host, which pauses the story — its clock, its timed
  // windows, its sound — and not just this clip, whose end drives the exit
  // that advances the scene. The announcer stays — assistive tech still needs
  // to hear what playback is doing.
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
function reportDecodedContentSize(
  player: MediaPlayerInstance | null,
  onContentSize: ((size: { width: number; height: number }) => void) | undefined
): void {
  const media = providerVideo(player);
  if (!onContentSize || !media || media.videoWidth <= 0 || media.videoHeight <= 0) return;
  onContentSize({ width: media.videoWidth, height: media.videoHeight });
}

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

function soundFallbackTarget(
  player: MediaPlayerInstance,
  readiness: ExperienceMediaReadinessGate,
  readinessKey: string,
  assertActive: () => void
): ExperienceSoundFallbackTarget {
  return {
    play: async () => {
      assertActive();
      try {
        await playMediaPlayerWhenReady(player, readiness, readinessKey, assertActive);
      } catch (error) {
        assertActive();
        throw error;
      }
      assertActive();
    },
    setMuted: (muted) => {
      assertActive();
      applyPlayerMuted(player, muted);
    },
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
 *
 * A refusal that outlives the muted retry is no failure either: WebKit plays an
 * element only once a `play()` ran inside a tap, and Low Power Mode refuses any
 * other. The host pauses the story on it (see resolveExperiencePlaybackRejection).
 */
export function isAutoplayPolicyRefusal(error: unknown): boolean {
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
 * The promise the host awaits is gated on this verdict. `play-fail` and
 * `auto-play-fail` go through `isSurfacedPlaybackEvent`, which also leaves out
 * `NotAllowedError`: a refusal is a pause, never a runtime error (see the
 * player's `onPlayFail`). The element's `error` event is neither — it reports
 * decode and source failures.
 *
 * Lives next to `isAutoplayPolicyRefusal` because this module owns the
 * DOM-exception taxonomy; the host consumes the verdict, never the `name`.
 */
export function isRoutinePlaybackInterruption(error: unknown): boolean {
  return domExceptionName(error) === "AbortError";
}

export function isSurfacedPlaybackEvent(error: unknown): boolean {
  return !isRoutinePlaybackInterruption(error) && !isAutoplayPolicyRefusal(error);
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

/**
 * Preserve playback intent across a source change.
 *
 * Vidstack keeps the native provider mounted while writing the next source, so
 * "provider exists" does not mean that source is playable. Calling native
 * `play()` in that interval can reject with AbortError when the load completes;
 * the interruption is routine, but without a queued retry the new clip remains
 * paused forever. The source-scoped latch is therefore authoritative even when
 * the provider already exists.
 *
 * A clip waiting within a breath of its end is ended rather than played (see
 * finishAtEnd), so a resume in its last frames does not start it over.
 */
export async function playMediaPlayerWhenReady(
  player: MediaPlayerInstance,
  readiness: ExperienceMediaReadinessGate,
  readinessKey: string,
  assertActive?: () => void
): Promise<void> {
  await readiness.wait(readinessKey);
  assertActive?.();
  const readyMedia = providerMedia(player);
  if (!readyMedia) return player.play();
  if (finishAtEnd(player, readyMedia)) return;
  return readyMedia.play();
}

/** Whether the clip has played to its end, by the element's account or by
 *  Vidstack's: a seek into its last second ends a clip for Vidstack too. */
function clipEnded(player: MediaPlayerInstance, media: HTMLMediaElement): boolean {
  return media.ended || player.state.ended;
}

/**
 * How near its end a paused clip may be played. Vidstack starts a clip over
 * when it is played within 0.1 s of its end; the margin covers a position it
 * has not heard of yet.
 */
const CLIP_END_MARGIN_SECONDS = 0.15;

/**
 * Takes a paused clip that is about to be played within a breath of its end to
 * its end instead, and says whether it did.
 *
 * Vidstack's `play` handler starts a clip over when it is played that close to
 * its end, judging by the position it last heard of — and WebKit dispatches
 * `play` before the `seeking` of a seek made just ahead of it, so stepping back
 * first cannot save the clip. A resume in its last frames would rewind it, and
 * the scene clock with it. Taken to its end, the clip ends the way playing on
 * would have: a few frames early, with the same `end` the story waits for.
 */
function finishAtEnd(player: MediaPlayerInstance, media: HTMLMediaElement): boolean {
  const { currentTime, duration, ended, seekableEnd } = player.state;
  if (ended || !media.paused || !(duration > 0) || !Number.isFinite(duration)) return false;
  if (duration - currentTime >= CLIP_END_MARGIN_SECONDS) return false;
  media.currentTime = seekableEnd;
  return true;
}

function pauseMediaPlayer(player: MediaPlayerInstance): void {
  const media = providerMedia(player);
  if (media) {
    media.pause();
    return;
  }
  // With no provider attached there is nothing playing yet. Calling Vidstack's
  // guarded pause here would manufacture the same not-ready error as play.
}

function seekMediaPlayer(player: MediaPlayerInstance, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds < 0) return;
  const provider = player.provider;
  if (
    provider?.type === "video" ||
    provider?.type === "audio" ||
    provider?.type === "hls" ||
    provider?.type === "dash"
  ) {
    provider.media.currentTime = seconds;
    return;
  }
  player.currentTime = seconds;
}

function emitValidTimeUpdate(onTimeUpdate: (seconds: number) => void, seconds: number): void {
  if (Number.isFinite(seconds) && seconds >= 0) onTimeUpdate(seconds);
}

function providerMedia(player: MediaPlayerInstance | null): HTMLMediaElement | null {
  if (!player) return null;
  const provider = player.provider;
  if (
    provider?.type === "video" ||
    provider?.type === "audio" ||
    provider?.type === "hls" ||
    provider?.type === "dash"
  ) {
    return provider.media;
  }
  return null;
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
