"use client";

import { useCallback, useEffect, useRef } from "react";
import type {
  ExperienceAudioAsset,
  ExperienceAudioCue,
  ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";
import type { ExperienceRuntimeEffect } from "@repo/experience-engine";
import type { ExperienceAudioCheckpoint } from "./experience-audio-checkpoint";

type AudioEffect = Extract<ExperienceRuntimeEffect, { kind: `audio.${string}` }>;

type ActivePlayback = {
  key: string;
  publicId?: string;
  cue: ExperienceAudioCue;
  source: AudioBufferSourceNode;
  gain: GainNode;
  startedAt: number;
  stopping: boolean;
  effect: Extract<AudioEffect, { kind: "audio.play" }>;
  offsetSeconds: number;
};

function playbackCheckpoint(
  effect: Extract<AudioEffect, { kind: "audio.play" }>,
  positionSeconds: number
): ExperienceAudioCheckpoint["playbacks"][number] {
  return {
    cueId: effect.cueId,
    assetId: effect.assetId,
    playbackRate: effect.playbackRate,
    playbackOrdinal: effect.playbackOrdinal,
    ...(effect.playbackId ? { playbackId: effect.playbackId } : {}),
    positionSeconds,
  };
}

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
  const checkpoint = useCallback(() => hostRef.current?.checkpoint(), []);
  const restore = useCallback((snapshot?: ExperienceAudioCheckpoint) => {
    hostRef.current?.restore(snapshot);
  }, []);

  return { unlock, suspend, applyEffects, checkpoint, restore };
}

class ExperienceAudioHost {
  readonly #context: AudioContext;
  readonly #manifest: ExperienceRuntimeManifest;
  readonly #locale: string;
  readonly #onError: (message: string) => void;
  readonly #buses = new Map<string, GainNode>();
  readonly #busBaseGains = new Map<string, number>();
  readonly #buffers = new Map<string, Promise<AudioBuffer>>();
  readonly #active = new Map<string, ActivePlayback>();
  #queue: Promise<void> = Promise.resolve();
  // What the story last asked of the context: held (suspended) or running.
  #held = true;
  #disposed = false;
  #generation = 0;
  readonly #pendingPlaybacks = new Map<string, Extract<AudioEffect, { kind: "audio.play" }>>();
  readonly #pendingOffsets = new Map<string, number>();
  readonly #suppressedPlaybacks = new Set<string>();
  readonly #downloads = new AbortController();

  constructor(
    manifest: ExperienceRuntimeManifest,
    locale: string,
    onError: (message: string) => void
  ) {
    this.#context = new AudioContext();
    this.#manifest = manifest;
    this.#locale = locale;
    this.#onError = onError;
    this.#createBusGraph();
  }

  unlock(): Promise<void> {
    this.#held = false;
    return this.#follow();
  }

  suspend(): Promise<void> {
    this.#held = true;
    return this.#follow();
  }

  /**
   * Asks the context for what the story wants, at once — a resume has to be
   * asked for inside the viewer's tap — and once more when that settles, if
   * the story has changed its mind meanwhile. Never decided by `state`: a
   * context whose device is still starting reads "suspended", and a pause that
   * skipped it then would leave the cues running behind a frozen picture.
   */
  async #follow(): Promise<void> {
    if (this.#disposed || this.#context.state === "closed") return;
    const held = this.#held;
    await (held ? this.#context.suspend() : this.#context.resume());
    if (this.#held !== held) await this.#follow();
  }

  enqueue(effects: readonly AudioEffect[]): void {
    const generation = this.#generation;
    for (const effect of effects) {
      if (effect.kind === "audio.play")
        this.#pendingPlaybacks.set(`${effect.cueId}:${effect.playbackOrdinal}`, effect);
      else if (effect.kind === "audio.stop") {
        for (const [key, playback] of this.#pendingPlaybacks) {
          if (
            effect.target === "cue"
              ? playback.cueId === effect.targetId
              : playback.playbackId === effect.targetId
          )
            this.#pendingPlaybacks.delete(key);
        }
        for (const [key, playback] of this.#active) {
          if (
            effect.target === "cue"
              ? playback.cue.cueId === effect.targetId
              : playback.publicId === effect.targetId
          )
            this.#suppressedPlaybacks.add(key);
        }
      } else if (effect.kind === "audio.fade-bus")
        this.#busBaseGains.set(effect.busId, effect.gain);
      else if (effect.kind === "audio.apply-snapshot") {
        const snapshot = this.#manifest.audio?.snapshots.find(
          (candidate) => candidate.snapshotId === effect.snapshotId
        );
        for (const [busId, gain] of Object.entries(snapshot?.busGains ?? {}))
          this.#busBaseGains.set(busId, gain);
      }
    }
    this.#queue = this.#queue
      .then(async () => {
        for (const effect of effects) {
          if (generation !== this.#generation) return;
          await this.#apply(effect, generation);
        }
      })
      .catch((error: unknown) => {
        if (!this.#disposed && generation === this.#generation)
          this.#onError(runtimeErrorMessage(error));
      });
  }

  checkpoint(): ExperienceAudioCheckpoint {
    const playbacks = new Map<string, ExperienceAudioCheckpoint["playbacks"][number]>();
    this.#pendingPlaybacks.forEach((effect, key) => {
      playbacks.set(key, playbackCheckpoint(effect, this.#pendingOffsets.get(key) ?? 0));
    });
    this.#active.forEach((playback, key) => {
      if (playback.stopping || this.#suppressedPlaybacks.has(key)) {
        playbacks.delete(key);
        return;
      }
      playbacks.set(
        key,
        playbackCheckpoint(
          playback.effect,
          playback.offsetSeconds +
            Math.max(0, this.#context.currentTime - playback.startedAt) *
              playback.effect.playbackRate
        )
      );
    });
    return { playbacks: [...playbacks.values()], busGains: Object.fromEntries(this.#busBaseGains) };
  }

  restore(snapshot?: ExperienceAudioCheckpoint): void {
    const generation = ++this.#generation;
    this.#pendingPlaybacks.clear();
    this.#pendingOffsets.clear();
    this.#suppressedPlaybacks.clear();
    for (const playback of snapshot?.playbacks ?? []) {
      const { positionSeconds, ...effect } = playback;
      const key = `${effect.cueId}:${effect.playbackOrdinal}`;
      this.#pendingPlaybacks.set(key, { kind: "audio.play", ...effect });
      this.#pendingOffsets.set(key, positionSeconds);
    }
    this.#active.forEach((playback) => {
      playback.source.onended = null;
      try {
        playback.source.stop();
      } catch {
        /* Already ended. */
      }
      disconnectAudioNode(playback.source);
      disconnectAudioNode(playback.gain);
    });
    this.#active.clear();
    this.#manifest.audio?.buses.forEach((bus) => {
      this.#setBusGain(
        bus.busId,
        snapshot?.busGains[bus.busId] ?? (bus.defaultMuted ? 0 : bus.defaultGain),
        0
      );
    });
    // New branch audio must not wait for an abandoned branch's slow download.
    this.#queue = Promise.resolve()
      .then(async () => {
        for (const playback of snapshot?.playbacks ?? []) {
          if (generation !== this.#generation) return;
          const { positionSeconds, ...effect } = playback;
          await this.#play({ kind: "audio.play", ...effect }, generation, positionSeconds);
        }
      })
      .catch((error: unknown) => {
        if (!this.#disposed && generation === this.#generation)
          this.#onError(runtimeErrorMessage(error));
      });
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    this.#downloads.abort();
    this.#buffers.clear();
    this.#active.forEach((playback) => {
      playback.source.onended = null;
      try {
        playback.source.stop();
      } catch {
        // The source may already have ended; cleanup below remains identical.
      }
      disconnectAudioNode(playback.source);
      disconnectAudioNode(playback.gain);
    });
    this.#active.clear();
    await this.#context.close();
  }

  #createBusGraph(): void {
    const definition = this.#manifest.audio;
    if (!definition) return;
    definition.buses.forEach((bus) => {
      const node = this.#context.createGain();
      const gain = bus.defaultMuted ? 0 : bus.defaultGain;
      node.gain.value = gain;
      this.#buses.set(bus.busId, node);
      this.#busBaseGains.set(bus.busId, gain);
    });
    definition.buses.forEach((bus) => {
      const node = this.#requireBus(bus.busId);
      if (bus.parentBusId) node.connect(this.#requireBus(bus.parentBusId));
      else node.connect(this.#context.destination);
    });
  }

  async #apply(effect: AudioEffect, generation = this.#generation): Promise<void> {
    if (this.#disposed) return;
    if (effect.kind === "audio.play") {
      await this.#play(effect, generation);
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
    Object.entries(snapshot.busGains).forEach(([busId, gain]) =>
      this.#setBusGain(busId, gain, snapshot.transitionMs)
    );
  }

  async #play(
    effect: Extract<AudioEffect, { kind: "audio.play" }>,
    generation = this.#generation,
    offsetSeconds = 0
  ): Promise<void> {
    const key = `${effect.cueId}:${effect.playbackOrdinal}`;
    const dropPending = () => {
      if (generation !== this.#generation) return;
      this.#pendingPlaybacks.delete(key);
      this.#pendingOffsets.delete(key);
    };
    const cue = this.#manifest.audio?.cues.find((candidate) => candidate.cueId === effect.cueId);
    if (!cue) throw new Error(`Unknown audio cue ${effect.cueId}`);
    if (!this.#acceptConcurrency(cue, false)) {
      dropPending();
      return;
    }
    const asset = this.#manifest.assets.find(
      (candidate): candidate is ExperienceAudioAsset =>
        candidate.assetId === effect.assetId && candidate.kind === "audio"
    );
    if (!asset)
      throw new Error(`Audio cue ${cue.cueId} references missing asset ${effect.assetId}`);
    const variant =
      asset.variants.find((candidate) => candidate.locale === this.#locale) ??
      asset.variants.find(
        (candidate) => candidate.locale === this.#manifest.localization.defaultLocale
      ) ??
      asset.variants[0];
    if (!variant) throw new Error(`Audio asset ${asset.assetId} has no playable variant`);
    let buffer: AudioBuffer;
    try {
      buffer = await this.#loadBuffer(variant.uri, variant.sha256);
    } catch (error) {
      dropPending();
      throw error;
    }
    if (this.#disposed || generation !== this.#generation) return;
    if (!this.#acceptConcurrency(cue)) {
      dropPending();
      return;
    }

    const source = this.#context.createBufferSource();
    const gain = this.#context.createGain();
    source.buffer = buffer;
    source.loop = cue.loop;
    source.playbackRate.value = effect.playbackRate;
    source.connect(gain);
    gain.connect(this.#requireBus(cue.busId));
    const now = this.#context.currentTime;
    const targetGain = cue.gain;
    if (cue.fadeInMs > 0) {
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(targetGain, now + cue.fadeInMs / 1_000);
    } else {
      gain.gain.setValueAtTime(targetGain, now);
    }
    const playback: ActivePlayback = {
      key,
      ...(effect.playbackId ? { publicId: effect.playbackId } : {}),
      cue,
      source,
      gain,
      startedAt: now,
      stopping: false,
      effect,
      offsetSeconds,
    };
    this.#active.set(key, playback);
    source.onended = () => this.#finishPlayback(key);
    const duration = buffer.duration;
    const offset =
      Number.isFinite(duration) && duration > 0
        ? cue.loop
          ? offsetSeconds % duration
          : Math.min(offsetSeconds, duration)
        : offsetSeconds;
    source.start(0, offset);
    this.#pendingPlaybacks.delete(key);
    this.#pendingOffsets.delete(key);
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
    [...this.#active.values()]
      .filter((playback) =>
        target === "cue" ? playback.cue.cueId === targetId : playback.publicId === targetId
      )
      .forEach((playback) => this.#fadeAndStop(playback, fadeOutMs ?? playback.cue.fadeOutMs));
  }

  #fadeAndStop(playback: ActivePlayback, durationMs: number): void {
    if (playback.stopping) return;
    playback.stopping = true;
    const now = this.#context.currentTime;
    playback.gain.gain.cancelScheduledValues(now);
    playback.gain.gain.setValueAtTime(playback.gain.gain.value, now);
    if (durationMs > 0) {
      playback.gain.gain.linearRampToValueAtTime(0, now + durationMs / 1_000);
      playback.source.stop(now + durationMs / 1_000);
    } else {
      playback.source.stop();
    }
  }

  #finishPlayback(key: string): void {
    const playback = this.#active.get(key);
    if (!playback) return;
    disconnectAudioNode(playback.source);
    disconnectAudioNode(playback.gain);
    this.#active.delete(key);
    this.#pendingPlaybacks.delete(key);
    this.#pendingOffsets.delete(key);
    this.#suppressedPlaybacks.delete(key);
    this.#refreshDucking();
  }

  #setBusGain(busId: string, gain: number, durationMs: number): void {
    this.#busBaseGains.set(busId, gain);
    this.#applyBusGain(busId, durationMs);
  }

  #refreshDucking(): void {
    const definition = this.#manifest.audio;
    if (!definition) return;
    const affected = new Set(definition.duckingRules.map((rule) => rule.targetBusId));
    affected.forEach((busId) => {
      const activeRules = definition.duckingRules.filter(
        (rule) =>
          rule.targetBusId === busId &&
          [...this.#active.values()].some(
            (playback) => playback.cue.busId === rule.triggerBusId && !playback.stopping
          )
      );
      const attackMs = activeRules.reduce(
        (fastest, rule) => Math.min(fastest, rule.attackMs),
        Number.POSITIVE_INFINITY
      );
      const releaseMs = definition.duckingRules
        .filter((rule) => rule.targetBusId === busId)
        .reduce((slowest, rule) => Math.max(slowest, rule.releaseMs), 0);
      this.#applyBusGain(
        busId,
        activeRules.length > 0 && Number.isFinite(attackMs) ? attackMs : releaseMs,
        activeRules.length > 0 ? Math.min(...activeRules.map((rule) => rule.targetGain)) : undefined
      );
    });
  }

  #applyBusGain(busId: string, durationMs: number, duckedGain?: number): void {
    const node = this.#requireBus(busId);
    const baseGain = this.#busBaseGains.get(busId) ?? 1;
    const target = duckedGain === undefined ? baseGain : Math.min(baseGain, duckedGain);
    const now = this.#context.currentTime;
    node.gain.cancelScheduledValues(now);
    node.gain.setValueAtTime(node.gain.value, now);
    if (durationMs > 0) node.gain.linearRampToValueAtTime(target, now + durationMs / 1_000);
    else node.gain.setValueAtTime(target, now);
  }

  async #loadBuffer(uri: string, expectedSha256: string): Promise<AudioBuffer> {
    const key = JSON.stringify([uri, expectedSha256]);
    const existing = this.#buffers.get(key);
    if (existing) return existing;
    const pending = (async () => {
      const response = await fetch(uri, { cache: "force-cache", signal: this.#downloads.signal });
      this.#assertActive();
      if (!response.ok)
        throw new Error(`Audio asset could not be loaded (HTTP ${response.status})`);
      const bytes = await response.arrayBuffer();
      this.#assertActive();
      const digest = await sha256(bytes);
      this.#assertActive();
      if (digest !== expectedSha256)
        throw new Error(`Audio asset ${uri} failed integrity validation`);
      return this.#context.decodeAudioData(bytes.slice(0));
    })();
    this.#buffers.set(key, pending);
    try {
      return await pending;
    } catch (error) {
      this.#buffers.delete(key);
      throw error;
    }
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error("Audio host disposed");
  }

  #requireBus(busId: string): GainNode {
    const bus = this.#buses.get(busId);
    if (!bus) throw new Error(`Unknown audio bus ${busId}`);
    return bus;
  }
}

async function sha256(value: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", value);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function runtimeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Unknown audio runtime error";
}

function disconnectAudioNode(node: Pick<AudioNode, "disconnect">): void {
  try {
    node.disconnect();
  } catch {
    // The node may already be detached; remaining nodes still need cleanup.
  }
}
