"use client";

/**
 * Narrative background music — two decks, one crossfade.
 *
 * The runtime cues music by story node: `play` a track, or (the common case)
 * say nothing at all. This hook is the browser half of that:
 * it holds two `HTMLAudioElement` decks, plays the incoming track on the idle
 * one while ramping the outgoing one to silence, and never lets an audio
 * failure reach the run. A 404 track, a decode error or a blocked autoplay all
 * end the same way — the story keeps going in silence.
 *
 * Deliberately NOT the Web Audio graph the cinematic player uses
 * (`@repo/experience-player-react`): that one is manifest-driven, with buses,
 * ducking and integrity-checked buffers. A narrative run has one looping bed at
 * a time, and two plain audio elements are both enough and cheaper — no
 * AudioContext to unlock, no whole-file decode before the first note.
 *
 * A story with no music never reaches any of this: `enabled` is false, no deck
 * is created and no network request is made.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { StoryMusicConfig, StoryMusicCue, StoryMusicTrack } from "../_lib/story-narrative-api";

/** Namespaced so it cannot collide with any other player's local settings. */
const MUTE_STORAGE_KEY = "fizzdragon.play.narrative.music.muted";
/**
 * One shared ticker drives every in-flight ramp. An interval (not rAF) on
 * purpose: a backgrounded tab throttles it to ~1s instead of freezing it, so a
 * stop fade still finishes and a hidden tab cannot be left playing forever.
 */
const RAMP_TICK_MS = 40;

type Deck = { el: HTMLAudioElement; trackId: string | null };

type Ramp = {
  deck: Deck;
  from: number;
  to: number;
  startedAt: number;
  durationMs: number;
  pauseAtEnd: boolean;
};

export interface NarrativeMusicControls {
  /** False when the story ships no music: render no control, run no audio. */
  enabled: boolean;
  /** What the control must claim: audio the player can actually hear. */
  soundOn: boolean;
  /** The browser refused playback; only another user gesture can change that. */
  blocked: boolean;
  /** Must be called from inside a real click. See `primeDecks`. */
  unlock: () => void;
  /** Also a click-only entry point: unmuting doubles as an unlock attempt. */
  toggleSound: () => void;
  applyCue: (cue: StoryMusicCue | undefined) => void;
}

function readStoredMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_STORAGE_KEY) === "1";
  } catch {
    // Private mode / storage disabled: the preference simply does not persist.
    return false;
  }
}

function persistMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? "1" : "0");
  } catch {
    // Same as above — a preference we cannot store is not an error worth having.
  }
}

/**
 * No `crossOrigin`: these decks only ever play the bytes. Asking for CORS would
 * make a media host that does not answer with the header fail a track that
 * plays perfectly well without it.
 */
function createDeck(muted: boolean): Deck {
  const el = new Audio();
  el.loop = true;
  el.muted = muted;
  el.volume = 0;
  el.preload = "auto";
  return { el, trackId: null };
}

function releaseElement(el: HTMLAudioElement): void {
  el.pause();
  el.removeAttribute("src");
  // Tells the browser to abandon any in-flight fetch for the old source.
  el.load();
}

function setDeckVolume(el: HTMLAudioElement, value: number): void {
  el.volume = Math.min(1, Math.max(0, value));
}

/**
 * The only playback failure a control can honestly report. A missing file or a
 * decode error is not something a second click fixes, so it stays silent.
 */
function isAutoplayRefusal(error: unknown): boolean {
  return error instanceof DOMException && error.name === "NotAllowedError";
}

export function useNarrativeMusic(config: StoryMusicConfig | null): NarrativeMusicControls {
  const enabled = Boolean(config?.enabled && config.tracks.length > 0);

  const [muted, setMuted] = useState<boolean>(
    () => typeof window !== "undefined" && readStoredMuted()
  );
  const [blocked, setBlocked] = useState(false);

  const decksRef = useRef<[Deck, Deck] | null>(null);
  const tracksRef = useRef<Map<string, StoryMusicTrack>>(new Map());
  const rampsRef = useRef<Ramp[]>([]);
  const tickerRef = useRef<number | null>(null);
  const activeRef = useRef(0);
  const currentTrackIdRef = useRef<string | null>(null);
  const primedRef = useRef(false);
  const mutedRef = useRef(muted);
  // Mirrors `blocked` for the click handlers, which must read it in the same
  // tick they change it — state alone would still hold the previous render's.
  const blockedRef = useRef(false);

  const markBlocked = useCallback((value: boolean) => {
    blockedRef.current = value;
    setBlocked(value);
  }, []);

  const stopTicker = useCallback(() => {
    if (tickerRef.current === null) return;
    window.clearInterval(tickerRef.current);
    tickerRef.current = null;
  }, []);

  const runTick = useCallback(() => {
    const now = performance.now();
    const remaining: Ramp[] = [];
    for (const ramp of rampsRef.current) {
      const progress =
        ramp.durationMs <= 0 ? 1 : Math.min(1, (now - ramp.startedAt) / ramp.durationMs);
      setDeckVolume(ramp.deck.el, ramp.from + (ramp.to - ramp.from) * progress);
      if (progress < 1) {
        remaining.push(ramp);
        continue;
      }
      if (ramp.pauseAtEnd) ramp.deck.el.pause();
    }
    rampsRef.current = remaining;
    if (remaining.length === 0) stopTicker();
  }, [stopTicker]);

  const runTickRef = useRef(runTick);
  useEffect(() => {
    runTickRef.current = runTick;
  }, [runTick]);

  const ensureTicker = useCallback(() => {
    if (tickerRef.current !== null) return;
    tickerRef.current = window.setInterval(() => runTickRef.current(), RAMP_TICK_MS);
  }, []);

  /**
   * A cue arriving mid-fade replaces the ramp instead of stacking one on top of
   * it: the element's current volume is already the truth (every tick writes
   * it), so the new ramp simply starts from wherever the old one got to.
   */
  const scheduleRamp = useCallback(
    (deck: Deck, to: number, durationMs: number, pauseAtEnd: boolean) => {
      const others = rampsRef.current.filter((ramp) => ramp.deck !== deck);
      if (durationMs <= 0) {
        rampsRef.current = others;
        setDeckVolume(deck.el, to);
        if (pauseAtEnd) deck.el.pause();
        if (others.length === 0) stopTicker();
        return;
      }
      rampsRef.current = [
        ...others,
        { deck, from: deck.el.volume, to, startedAt: performance.now(), durationMs, pauseAtEnd },
      ];
      ensureTicker();
    },
    [ensureTicker, stopTicker]
  );

  const cancelRamps = useCallback(() => {
    rampsRef.current = [];
    stopTicker();
  }, [stopTicker]);

  const safePlay = useCallback(
    (deck: Deck) => {
      const started = deck.el.play();
      // Pre-promise browsers return undefined; assume playback started.
      if (!started) return;
      started.then(
        () => markBlocked(false),
        (error: unknown) => {
          if (isAutoplayRefusal(error)) {
            primedRef.current = false;
            markBlocked(true);
          }
        }
      );
    },
    [markBlocked]
  );

  /**
   * AUTOPLAY POLICY, and the ONLY place a deck is blessed.
   *
   * Browsers refuse programmatic playback until the document has seen a user
   * gesture, and the refusal is silent — `play()` rejects, no sound, no error
   * anywhere the player would notice. A gesture blesses the ELEMENT it played,
   * never the page, so BOTH decks have to be played inside a real click (the
   * setup Start button, or the mute control) or the first crossfade that reaches
   * the other one is refused — permanently, since no further gesture is coming.
   * That is the invariant: the two decks are blessed together, and every
   * gesture-bound entry point (`unlock`, `toggleSound`) ends up here so no path
   * can bless one and leave the other behind.
   *
   * Priming plays each deck and pauses it synchronously in the same tick, which
   * blesses it without ever being audible. The resulting promise rejects with
   * AbortError — expected, and ignored; only a NotAllowedError means the gesture
   * did not count, and that is what `blocked` reports. A deck that is already
   * playing is skipped rather than touched: it is blessed by definition, and
   * pausing it would silence the sound this very gesture is starting.
   */
  const primeDecks = useCallback(() => {
    const decks = decksRef.current;
    if (!decks || primedRef.current) return;
    const seed = tracksRef.current.values().next().value;
    // An element with no source cannot be primed at all.
    if (!seed) return;
    primedRef.current = true;
    // A fresh attempt is underway, so stop claiming the last one was refused;
    // the rejection below puts it back if this gesture did not count either.
    markBlocked(false);

    for (const deck of decks) {
      // Never interrupt a deck that is genuinely playing — it is already blessed.
      if (!deck.el.paused) continue;
      if (!deck.trackId) {
        deck.el.src = seed.url;
        deck.trackId = seed.trackId;
      }
      deck.el.volume = 0;
      const primed = deck.el.play();
      deck.el.pause();
      primed?.then(
        () => markBlocked(false),
        (error: unknown) => {
          if (isAutoplayRefusal(error)) {
            primedRef.current = false;
            markBlocked(true);
          }
        }
      );
    }
  }, [markBlocked]);

  const playTrack = useCallback(
    (trackId: string, fadeMs: number) => {
      const decks = decksRef.current;
      const track = tracksRef.current.get(trackId);
      // A cue naming a track the manifest never listed: nothing to crossfade to,
      // so the current bed keeps playing rather than cutting to silence.
      if (!decks || !track) return;
      // The session dedupes re-entries server-side; this is the local backstop
      // that keeps a repeated cue from restarting a theme mid-bar.
      if (currentTrackIdRef.current === trackId) return;

      cancelRamps();
      const outgoing = decks[activeRef.current];
      const incoming = decks[1 - activeRef.current];

      if (incoming.trackId !== trackId) {
        incoming.el.src = track.url;
        incoming.trackId = trackId;
      }
      incoming.el.loop = true;
      incoming.el.muted = mutedRef.current;
      setDeckVolume(incoming.el, 0);
      try {
        incoming.el.currentTime = 0;
      } catch {
        // Not seekable yet — a freshly assigned source already starts at zero.
      }
      safePlay(incoming);

      scheduleRamp(incoming, track.gain, fadeMs, false);
      if (!outgoing.el.paused) scheduleRamp(outgoing, 0, fadeMs, true);

      activeRef.current = 1 - activeRef.current;
      currentTrackIdRef.current = trackId;
    },
    [cancelRamps, safePlay, scheduleRamp]
  );

  /** Everything down, elements released. Used on unmount and on run discard. */
  const hardStop = useCallback(() => {
    cancelRamps();
    const decks = decksRef.current;
    decksRef.current = null;
    currentTrackIdRef.current = null;
    activeRef.current = 0;
    primedRef.current = false;
    decks?.forEach((deck) => releaseElement(deck.el));
  }, [cancelRamps]);

  useEffect(() => {
    if (!enabled || !config) return;

    tracksRef.current = new Map(config.tracks.map((track) => [track.trackId, track]));
    // Sourceless decks: `new Audio()` with no `src` opens no connection, so
    // this effect stays free even though it runs the moment `enter` resolves —
    // on the setup screen, before the player has committed to the run. NOTHING
    // is fetched until a gesture assigns a source (`primeDecks`) or a cue does
    // (`playTrack`). There is deliberately no separate warm-up pass: it used to
    // pull up to four WHOLE tracks here, which spent a muted player's bandwidth,
    // and a player who never pressed Start paid for a run that never happened.
    // Nothing was bought for it either — the decks carry `preload="auto"`, the
    // URLs are ordinary cacheable public media, and the first cue fades in over
    // 1.5s from silence, which is the buffer.
    decksRef.current = [createDeck(mutedRef.current), createDeck(mutedRef.current)];

    return () => {
      hardStop();
      tracksRef.current = new Map();
    };
    // `config` is the run's own enter payload: a new run (or a discarded one,
    // which nulls it) tears the whole deck down.
  }, [config, enabled, hardStop]);

  const applyCue = useCallback(
    (cue: StoryMusicCue | undefined) => {
      // Absent is the common case and must stay this cheap.
      if (!cue || !decksRef.current) return;
      try {
        playTrack(cue.trackId, cue.fadeMs);
      } catch {
        // The contract of this hook is that audio never breaks the run, and the
        // caller applies cues inside the turn's own try/catch — whose catch owns
        // the run-discard path. A media-element throw must die here, not cost a
        // player the turn that just landed.
      }
    },
    [playTrack]
  );

  const toggleSound = useCallback(() => {
    // The control reads OFF for two different reasons — the player muted it, or
    // the browser refused playback. A click on an OFF control always means "turn
    // it on", so a refused run retries instead of flipping a mute it never set.
    const turningOn = mutedRef.current || blockedRef.current;
    const nextMuted = !turningOn;
    mutedRef.current = nextMuted;
    setMuted(nextMuted);
    persistMuted(nextMuted);
    const decks = decksRef.current;
    decks?.forEach((deck) => {
      deck.el.muted = nextMuted;
    });
    if (!turningOn || !decks) return;

    // Turning it on happens inside a click, which is also the gesture the
    // browser was waiting for — so this is an unlock path, and it owes the same
    // invariant as any other: BOTH decks blessed before the click is over. A
    // deck already carrying the current track is resumed here rather than by
    // `primeDecks`, which would pause the very sound this click is starting;
    // `play()` clears `paused` synchronously, so the prime below skips it and
    // blesses the idle one. Stopping at the resume would leave that idle deck
    // unblessed, and the next crossfade would play into an element the browser
    // never allowed — silence for the rest of the run, with no gesture left to
    // recover it.
    const active = decks[activeRef.current];
    if (currentTrackIdRef.current && active.trackId === currentTrackIdRef.current) {
      if (active.el.paused) safePlay(active);
      // Already running (it was only muted): whatever refusal we were showing is
      // stale, and audible sound is the proof.
      else markBlocked(false);
    }
    primeDecks();
  }, [markBlocked, primeDecks, safePlay]);

  return {
    enabled,
    soundOn: enabled && !muted && !blocked,
    blocked,
    unlock: primeDecks,
    toggleSound,
    applyCue,
  };
}
