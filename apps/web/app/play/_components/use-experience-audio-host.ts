"use client";

import { useCallback, useEffect, useRef } from "react";
import type {
  ExperienceAudioAsset,
  ExperienceAudioCue,
  ExperienceRuntimeManifest,
} from "@repo/shared/experience-runtime";
import type { ExperienceRuntimeEffect } from "@repo/experience-engine";

type AudioEffect = Extract<ExperienceRuntimeEffect, { kind: `audio.${string}` }>;

type ActivePlayback = {
  key: string;
  publicId?: string;
  cue: ExperienceAudioCue;
  source: AudioBufferSourceNode;
  gain: GainNode;
  startedAt: number;
  stopping: boolean;
};

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
  const applyEffects = useCallback((effects: readonly ExperienceRuntimeEffect[]) => {
    const audioEffects = effects.filter((effect): effect is AudioEffect =>
      effect.kind.startsWith("audio.")
    );
    if (audioEffects.length > 0) hostRef.current?.enqueue(audioEffects);
  }, []);

  return { unlock, applyEffects };
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
  #disposed = false;

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

  async unlock(): Promise<void> {
    if (this.#disposed || this.#context.state === "running") return;
    await this.#context.resume();
  }

  enqueue(effects: readonly AudioEffect[]): void {
    this.#queue = this.#queue
      .then(async () => {
        for (const effect of effects) await this.#apply(effect);
      })
      .catch((error: unknown) => this.#onError(runtimeErrorMessage(error)));
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    this.#active.forEach((playback) => {
      playback.source.onended = null;
      try {
        playback.source.stop();
      } catch {
        // The source may already have ended; cleanup below remains identical.
      }
      playback.source.disconnect();
      playback.gain.disconnect();
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
    Object.entries(snapshot.busGains).forEach(([busId, gain]) =>
      this.#setBusGain(busId, gain, snapshot.transitionMs)
    );
  }

  async #play(effect: Extract<AudioEffect, { kind: "audio.play" }>): Promise<void> {
    const cue = this.#manifest.audio?.cues.find((candidate) => candidate.cueId === effect.cueId);
    if (!cue) throw new Error(`Unknown audio cue ${effect.cueId}`);
    if (!this.#acceptConcurrency(cue)) return;
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
    const buffer = await this.#loadBuffer(variant.uri, variant.sha256);
    if (this.#disposed) return;

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
    const key = `${cue.cueId}:${effect.playbackOrdinal}`;
    const playback: ActivePlayback = {
      key,
      ...(effect.playbackId ? { publicId: effect.playbackId } : {}),
      cue,
      source,
      gain,
      startedAt: now,
      stopping: false,
    };
    this.#active.set(key, playback);
    source.onended = () => this.#finishPlayback(key);
    source.start();
    this.#refreshDucking();
  }

  #acceptConcurrency(cue: ExperienceAudioCue): boolean {
    const concurrency = cue.concurrency;
    if (!concurrency) return true;
    const group = [...this.#active.values()].filter(
      (playback) => playback.cue.concurrency?.groupId === concurrency.groupId
    );
    if (group.length < concurrency.maxInstances) return true;
    if (concurrency.overflowBehavior === "reject-new") return false;
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
    playback.source.disconnect();
    playback.gain.disconnect();
    this.#active.delete(key);
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
    const existing = this.#buffers.get(uri);
    if (existing) return existing;
    const pending = (async () => {
      const response = await fetch(uri, { cache: "force-cache" });
      if (!response.ok)
        throw new Error(`Audio asset could not be loaded (HTTP ${response.status})`);
      const bytes = await response.arrayBuffer();
      const digest = await sha256(bytes);
      if (digest !== expectedSha256)
        throw new Error(`Audio asset ${uri} failed integrity validation`);
      return this.#context.decodeAudioData(bytes.slice(0));
    })();
    this.#buffers.set(uri, pending);
    try {
      return await pending;
    } catch (error) {
      this.#buffers.delete(uri);
      throw error;
    }
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
