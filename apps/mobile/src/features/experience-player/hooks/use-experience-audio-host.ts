import { useCallback, useEffect, useRef } from "react";
import { createAudioPlayer, setAudioModeAsync, setIsAudioActiveAsync } from "expo-audio";
import type { AudioPlayer } from "expo-audio";
import type { ExperienceRuntimeEffect } from "@repo/experience-engine";
import type {
  ExperienceAudioAsset,
  ExperienceAudioCue,
  ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";

import { ensureAudioCached, maintainExperienceAudioCache } from "../lib/experience-audio-cache";

type AudioEffect = Extract<ExperienceRuntimeEffect, { kind: `audio.${string}` }>;

/**
 * The web host has a real node graph, where a cue's fade envelope and its bus
 * gain are separate nodes multiplied by the engine. RN only exposes one scalar
 * `volume` per player, so the two factors are tracked here and multiplied on
 * every write — otherwise a duck arriving mid fade-in would cancel the fade.
 */
type PlaybackGainFactor = "envelope" | "busGain";

type ActivePlayback = {
  key: string;
  publicId?: string;
  cue: ExperienceAudioCue;
  player: AudioPlayer;
  startedAt: number;
  stopping: boolean;
  /** Cue-level gain: fade in / fade out. */
  envelope: number;
  /** Product of the bus chain gains, including ducking. */
  busGain: number;
  ramps: {
    envelope: ReturnType<typeof setInterval> | null;
    busGain: ReturnType<typeof setInterval> | null;
  };
  statusSub: { remove: () => void } | null;
};

/** Volume ramp resolution — 50ms is inaudible as steps and cheap on the bridge. */
const FADE_STEP_MS = 50;

/**
 * `expo-audio`'s session is process-wide, so ownership, ordering and the one-off
 * mode configuration cannot live on a host instance. A chapter switch disposes
 * the outgoing host after the incoming one has already unlocked, and an
 * instance-scoped release would deactivate the session the new chapter is
 * playing through — every cue after the switch would be silent.
 */
let sessionOwner: ExperienceAudioHost | null = null;
let sessionChain: Promise<void> = Promise.resolve();
let sessionIntent: { host: ExperienceAudioHost; state: "active" | "suspended" } | null = null;
let sessionConfigured = false;

/** App-wide audio defaults — restored when the film host releases the session. */
const APP_AUDIO_MODE = {
  playsInSilentMode: false,
  shouldPlayInBackground: false,
  interruptionMode: "mixWithOthers" as const,
  allowsRecording: false,
};

async function restoreAppAudioSession(): Promise<void> {
  if (!sessionConfigured) return;
  await setAudioModeAsync(APP_AUDIO_MODE);
  sessionConfigured = false;
}

/** Serializes every native session call in the process, across hosts. */
function runSessionTransition(run: () => Promise<void>): Promise<void> {
  const transition = sessionChain.then(run);
  sessionChain = transition.catch(() => undefined);
  return transition;
}

/**
 * Native rewrite of the web `use-experience-audio-host` — Web Audio is unavailable
 * on RN, so bus gains / ducking are applied as per-player volume products, and
 * cues play through `expo-audio` players.
 */
export function useExperienceAudioHost(
  manifest: ExperienceRuntimeManifest,
  locale: string,
  onError: (message: string) => void
) {
  const hostRef = useRef<ExperienceAudioHost | null>(null);
  useEffect(() => {
    if (!manifest.audio) return;
    const host = new ExperienceAudioHost(manifest, locale, onError);
    hostRef.current = host;
    void maintainExperienceAudioCache();
    return () => {
      hostRef.current = null;
      void host.dispose();
    };
  }, [locale, manifest, onError]);

  const unlock = useCallback(async () => {
    await hostRef.current?.unlock();
  }, []);
  const suspend = useCallback(async () => {
    await hostRef.current?.suspend();
  }, []);
  const applyEffects = useCallback((effects: readonly ExperienceRuntimeEffect[]) => {
    const audioEffects = effects.filter((effect): effect is AudioEffect =>
      effect.kind.startsWith("audio.")
    );
    if (audioEffects.length > 0) hostRef.current?.enqueue(audioEffects);
  }, []);

  return { unlock, suspend, applyEffects };
}

class ExperienceAudioHost {
  readonly #manifest: ExperienceRuntimeManifest;
  readonly #locale: string;
  readonly #onError: (message: string) => void;
  readonly #parents = new Map<string, string | undefined>();
  readonly #busBaseGains = new Map<string, number>();
  readonly #active = new Map<string, ActivePlayback>();
  #queue: Promise<void> = Promise.resolve();
  #disposed = false;
  #unlocked = false;
  #suspended = false;

  constructor(
    manifest: ExperienceRuntimeManifest,
    locale: string,
    onError: (message: string) => void
  ) {
    this.#manifest = manifest;
    this.#locale = locale;
    this.#onError = onError;
    this.#initBuses();
  }

  unlock(): Promise<void> {
    return this.#transitionSession("active", async () => {
      if (!sessionConfigured) {
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: false,
          // The film's own video soundtrack shares this session; cues must layer
          // over it rather than take exclusive focus from it.
          interruptionMode: "mixWithOthers",
          allowsRecording: false,
        });
        sessionConfigured = true;
      }
      await setIsAudioActiveAsync(true);
      sessionOwner = this;
      this.#unlocked = true;
      this.#suspended = false;
      for (const playback of this.#active.values()) {
        if (playback.stopping) continue;
        playback.player.play();
      }
    });
  }

  suspend(): Promise<void> {
    return this.#transitionSession("suspended", async () => {
      if (this.#suspended) return;
      this.#suspended = true;
      for (const playback of this.#active.values()) {
        if (playback.player.playing) playback.player.pause();
      }
      // Pausing our own players is always ours to do; deactivating the shared
      // session is only ours while we hold it.
      if (sessionOwner !== this) return;
      sessionOwner = null;
      await setIsAudioActiveAsync(false);
    });
  }

  /**
   * Session transitions run one at a time and the newest intent wins. iOS reports
   * `inactive` for something as ordinary as a Control Center pull, so dismissing
   * it immediately produces suspend-then-unlock; if those two native calls
   * interleave, the session can end up inactive while the host believes it is
   * live, and every cue for the rest of the session is silent.
   */
  #transitionSession(state: "active" | "suspended", run: () => Promise<void>): Promise<void> {
    const intent = { host: this, state };
    sessionIntent = intent;
    return runSessionTransition(async () => {
      // Superseded while queued — by us or by the host taking over from us.
      if (this.#disposed || sessionIntent !== intent) return;
      await run();
    });
  }

  enqueue(effects: readonly AudioEffect[]): void {
    this.#queue = this.#queue
      .then(async () => {
        for (const effect of effects) await this.#apply(effect);
      })
      .catch((error: unknown) => {
        if (!this.#disposed) this.#onError(runtimeErrorMessage(error));
      });
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    for (const playback of [...this.#active.values()]) {
      this.#teardown(playback);
    }
    this.#active.clear();
    // Only release the session while this host still owns it — a chapter switch
    // disposes us after the incoming host has already unlocked, and the recheck
    // inside the queued transition covers it unlocking while we wait.
    // An in-flight unlock may acquire ownership after dispose starts. Always
    // queue this check behind it; the queued check also protects a newer host.
    await runSessionTransition(async () => {
      if (sessionOwner !== this) return;
      sessionOwner = null;
      await setIsAudioActiveAsync(false);
      await restoreAppAudioSession();
    });
  }

  #initBuses(): void {
    const definition = this.#manifest.audio;
    if (!definition) return;
    for (const bus of definition.buses) {
      this.#parents.set(bus.busId, bus.parentBusId);
      this.#busBaseGains.set(bus.busId, bus.defaultMuted ? 0 : bus.defaultGain);
    }
  }

  async #apply(effect: AudioEffect): Promise<void> {
    if (this.#disposed) return;
    if (effect.kind === "audio.play") {
      await this.#play(effect);
      return;
    }
    if (effect.kind === "audio.stop") {
      this.#stop(effect.target, effect.targetId, effect.fadeOutMs);
      return;
    }
    if (effect.kind === "audio.fade-bus") {
      this.#setBusGain(effect.busId, effect.gain, effect.durationMs);
      return;
    }
    const snapshot = this.#manifest.audio?.snapshots.find(
      (candidate) => candidate.snapshotId === effect.snapshotId
    );
    if (!snapshot) throw new Error(`Unknown audio snapshot ${effect.snapshotId}`);
    for (const [busId, gain] of Object.entries(snapshot.busGains)) {
      this.#setBusGain(busId, gain, snapshot.transitionMs);
    }
  }

  async #play(effect: Extract<AudioEffect, { kind: "audio.play" }>): Promise<void> {
    const cue = this.#manifest.audio?.cues.find((candidate) => candidate.cueId === effect.cueId);
    if (!cue) throw new Error(`Unknown audio cue ${effect.cueId}`);
    if (!this.#acceptConcurrency(cue, false)) return;
    const asset = this.#manifest.assets.find(
      (candidate): candidate is ExperienceAudioAsset =>
        candidate.assetId === effect.assetId && candidate.kind === "audio"
    );
    if (!asset) {
      throw new Error(`Audio cue ${cue.cueId} references missing asset ${effect.assetId}`);
    }
    const variant =
      asset.variants.find((candidate) => candidate.locale === this.#locale) ??
      asset.variants.find(
        (candidate) => candidate.locale === this.#manifest.localization.defaultLocale
      ) ??
      asset.variants[0];
    if (!variant) throw new Error(`Audio asset ${asset.assetId} has no playable variant`);

    if (!this.#unlocked) await this.unlock();
    if (this.#disposed) return;

    const localUri = await ensureAudioCached(variant.uri, variant.sha256);
    if (this.#disposed) return;
    // Replace an existing cue only once the incoming bytes are available.
    if (!this.#acceptConcurrency(cue)) return;

    const player = createAudioPlayer({ uri: localUri }, { updateInterval: 250 });
    player.loop = cue.loop;
    player.setPlaybackRate(effect.playbackRate);
    const key = `${cue.cueId}:${effect.playbackOrdinal}`;
    const playback: ActivePlayback = {
      key,
      ...(effect.playbackId ? { publicId: effect.playbackId } : {}),
      cue,
      player,
      startedAt: Date.now(),
      stopping: false,
      envelope: cue.fadeInMs > 0 ? 0 : cue.gain,
      busGain: this.#busChainLevel(cue.busId, this.#triggerBusIds()).gain,
      ramps: { envelope: null, busGain: null },
      statusSub: null,
    };
    this.#active.set(key, playback);
    playback.statusSub = player.addListener("playbackStatusUpdate", (status) => {
      if (!status.didJustFinish || cue.loop) return;
      this.#finishPlayback(key);
    });
    this.#writeVolume(playback);
    if (cue.fadeInMs > 0) {
      this.#ramp(playback, "envelope", cue.gain, cue.fadeInMs);
    }
    if (!this.#suspended) player.play();
    // This cue may itself be a ducking trigger — re-level everything else after
    // it joins the active set.
    this.#refreshDucking();
  }

  #acceptConcurrency(cue: ExperienceAudioCue, stopOverflow = true): boolean {
    const concurrency = cue.concurrency;
    if (!concurrency) return true;
    const group = [...this.#active.values()].filter(
      (playback) => !playback.stopping && playback.cue.concurrency?.groupId === concurrency.groupId
    );
    if (group.length < concurrency.maxInstances) return true;
    if (concurrency.overflowBehavior === "reject-new") return false;
    if (!stopOverflow) return true;
    const victim =
      concurrency.overflowBehavior === "stop-oldest"
        ? group.reduce((oldest, item) => (item.startedAt < oldest.startedAt ? item : oldest))
        : group.reduce((quietest, item) => (item.cue.gain < quietest.cue.gain ? item : quietest));
    this.#fadeAndStop(victim, victim.cue.fadeOutMs);
    return true;
  }

  #stop(target: "cue" | "playback", targetId: string, fadeOutMs?: number): void {
    for (const playback of [...this.#active.values()]) {
      const matches =
        target === "cue" ? playback.cue.cueId === targetId : playback.publicId === targetId;
      if (matches) this.#fadeAndStop(playback, fadeOutMs ?? playback.cue.fadeOutMs);
    }
  }

  #fadeAndStop(playback: ActivePlayback, durationMs: number): void {
    if (playback.stopping) return;
    playback.stopping = true;
    // A stopping playback no longer triggers ducking, so release its targets now
    // and let the fade-out run underneath.
    this.#refreshDucking();
    if (durationMs <= 0) {
      this.#teardown(playback);
      return;
    }
    this.#ramp(playback, "envelope", 0, durationMs, () => this.#teardown(playback));
  }

  #finishPlayback(key: string): void {
    const playback = this.#active.get(key);
    if (!playback || playback.stopping) return;
    this.#teardown(playback);
    this.#refreshDucking();
  }

  #teardown(playback: ActivePlayback): void {
    this.#cancelRamp(playback, "envelope");
    this.#cancelRamp(playback, "busGain");
    this.#active.delete(playback.key);
    for (const release of [
      () => playback.statusSub?.remove(),
      () => playback.player.pause(),
      () => playback.player.remove(),
    ]) {
      try {
        release();
      } catch {
        // A detached subscription/player must not prevent the other releases.
      }
    }
    playback.statusSub = null;
  }

  #setBusGain(busId: string, gain: number, durationMs: number): void {
    if (!this.#busBaseGains.has(busId)) throw new Error(`Unknown audio bus ${busId}`);
    this.#busBaseGains.set(busId, gain);
    this.#relevelBusGains(durationMs);
  }

  /**
   * Re-derive every playback's bus factor. Ducking transitions ramp over the
   * rule's own attack / release (a hard jump is audible as a click).
   */
  #refreshDucking(): void {
    this.#relevelBusGains();
  }

  #relevelBusGains(overrideDurationMs?: number): void {
    const triggers = this.#triggerBusIds();
    for (const playback of this.#active.values()) {
      const level = this.#busChainLevel(playback.cue.busId, triggers);
      if (Math.abs(level.gain - playback.busGain) < 1e-4) continue;
      this.#ramp(playback, "busGain", level.gain, overrideDurationMs ?? level.rampMs);
    }
  }

  /** Buses currently carrying a non-stopping playback — the ducking triggers. */
  #triggerBusIds(): ReadonlySet<string> {
    const triggers = new Set<string>();
    for (const playback of this.#active.values()) {
      if (!playback.stopping) triggers.add(playback.cue.busId);
    }
    return triggers;
  }

  #duckStateFor(busId: string, triggers: ReadonlySet<string>) {
    const definition = this.#manifest.audio;
    if (!definition) return null;
    const busRules = definition.duckingRules.filter((rule) => rule.targetBusId === busId);
    if (busRules.length === 0) return null;
    const activeRules = busRules.filter((rule) => triggers.has(rule.triggerBusId));
    if (activeRules.length === 0) {
      return {
        gain: undefined,
        durationMs: busRules.reduce((slowest, rule) => Math.max(slowest, rule.releaseMs), 0),
      };
    }
    return {
      gain: Math.min(...activeRules.map((rule) => rule.targetGain)),
      durationMs: Math.min(...activeRules.map((rule) => rule.attackMs)),
    };
  }

  #busChain(leafBusId: string): string[] {
    const chain: string[] = [];
    let busId: string | undefined = leafBusId;
    while (busId && !chain.includes(busId)) {
      chain.push(busId);
      busId = this.#parents.get(busId);
    }
    return chain;
  }

  /**
   * Gain of a cue's whole bus chain plus the ramp to reach it. A chain normally
   * has at most one ducked bus (music ducked by dialogue), so the ramp is that
   * rule's own attack / release; when several duck at once the slowest wins so
   * the chain never moves in visible steps.
   */
  #busChainLevel(leafBusId: string, triggers: ReadonlySet<string>) {
    let gain = 1;
    let rampMs = 0;
    for (const busId of this.#busChain(leafBusId)) {
      const base = this.#busBaseGains.get(busId) ?? 1;
      const duck = this.#duckStateFor(busId, triggers);
      gain *= duck?.gain === undefined ? base : Math.min(base, duck.gain);
      if (duck) rampMs = Math.max(rampMs, duck.durationMs);
    }
    return { gain, rampMs };
  }

  #writeVolume(playback: ActivePlayback): void {
    // expo-audio clamps volume to [0, 1]; manifest bus gains may exceed 1.
    playback.player.volume = Math.min(1, Math.max(0, playback.envelope * playback.busGain));
  }

  #cancelRamp(playback: ActivePlayback, factor: PlaybackGainFactor): void {
    const timer = playback.ramps[factor];
    if (timer === null) return;
    clearInterval(timer);
    playback.ramps[factor] = null;
  }

  #ramp(
    playback: ActivePlayback,
    factor: PlaybackGainFactor,
    to: number,
    durationMs: number,
    onComplete?: () => void
  ): void {
    this.#cancelRamp(playback, factor);
    if (durationMs <= 0) {
      playback[factor] = to;
      this.#writeVolume(playback);
      onComplete?.();
      return;
    }
    const from = playback[factor];
    const steps = Math.max(1, Math.ceil(durationMs / FADE_STEP_MS));
    let step = 0;
    playback.ramps[factor] = setInterval(() => {
      step += 1;
      const progress = Math.min(1, step / steps);
      playback[factor] = from + (to - from) * progress;
      this.#writeVolume(playback);
      if (step < steps) return;
      this.#cancelRamp(playback, factor);
      onComplete?.();
    }, FADE_STEP_MS);
  }
}

function runtimeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Unknown audio runtime error";
}
