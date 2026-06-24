"use client";

import type { AssetEvent } from "@repo/shared";
import {
  openAssetsRealtime,
  type AssetsRealtimeClient,
  type AssetsRealtimeHandlers,
  type AssetsRealtimeOptions,
} from "./assets-realtime";

/** Catch-up: replay a channel's events after a sequence from the durable outbox. */
async function fetchReplay(
  channel: string,
  afterSeq: number
): Promise<{ events: AssetEvent[]; hasMore: boolean }> {
  const qs = new URLSearchParams({ channel, afterSeq: String(afterSeq) });
  const res = await fetch(`/aurora/realtime/replay?${qs.toString()}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`replay http ${res.status}`);
  const body = (await res.json()) as {
    code: number;
    data?: { events?: AssetEvent[]; hasMore?: boolean };
  };
  if (body.code !== 200) throw new Error("replay failed");
  return {
    events: body.data?.events ?? [],
    hasMore: Boolean(body.data?.hasMore),
  };
}

/** Cap on remembered eventIds (idempotent dedup) before a cheap reset. */
const SEEN_CAP = 1000;

/**
 * Singleton fan-out over the asset realtime socket.
 *
 * Every React consumer (each generation feed + the canvas) used to call
 * `openAssetsRealtime` directly and open its OWN WebSocket — N sockets, N
 * reconnect loops, N negotiate calls. The kernel collapses them to ONE shared
 * socket with ref-counted subscribers: the first subscriber opens it, the last
 * closes it, and a late subscriber immediately sees the current connected state
 * (so it can back-fill via its own `onConnected`).
 *
 * It is intentionally thin — connection lifecycle, backoff/jitter, and the
 * circuit breaker live in the socket (`assets-realtime.ts`). The kernel only
 * owns *sharing*. Per-channel seq/dedup/resync arrives with the server event
 * envelope (docs/studio-realtime-architecture.md §3, phase P3).
 */
class AssetsRealtimeKernel {
  private readonly subscribers = new Set<AssetsRealtimeHandlers>();
  private socket: AssetsRealtimeClient | null = null;
  private connected = false;
  /** Per-channel last delivered sequence — persists across reconnects, so a
   *  reconnect that missed pushes detects the gap and replays it. */
  private readonly lastSeq = new Map<string, number>();
  /** Recent eventIds for idempotent dedup (a push overlapping a replay). Bounded. */
  private readonly seen = new Set<string>();
  /** Channels with an in-flight catch-up (prevents concurrent replays). */
  private readonly catchingUp = new Set<string>();

  constructor(private readonly options: AssetsRealtimeOptions) {}

  subscribe(handlers: AssetsRealtimeHandlers): { close: () => void } {
    this.subscribers.add(handlers);
    // A subscriber joining an already-live socket gets the connected signal now
    // (its onConnected typically triggers a reconcile to back-fill).
    if (this.connected) handlers.onConnected?.();
    if (!this.socket) this.open();

    let active = true;
    return {
      close: () => {
        if (!active) return;
        active = false;
        this.subscribers.delete(handlers);
        if (this.subscribers.size === 0) this.teardown();
      },
    };
  }

  private open(): void {
    this.socket = openAssetsRealtime(
      {
        onConnected: () => {
          this.connected = true;
          for (const sub of this.subscribers) sub.onConnected?.();
        },
        onDisconnected: (reason) => {
          this.connected = false;
          for (const sub of this.subscribers) sub.onDisconnected?.(reason);
        },
        onEvent: (event) => void this.handleIncoming(event),
      },
      this.options
    );
  }

  /**
   * Route an incoming event through per-channel sequence tracking: deliver
   * in-order events, drop duplicates/old ones (by seq + eventId), and on a gap
   * replay the missed events from the durable outbox before delivering. Events
   * with no channel/seq (legacy job/media) pass straight through.
   *
   * Current consumers are state-derived (invalidate/replace), so the rare reorder
   * of a push racing a catch-up is harmless; a strict-order per-channel queue is a
   * future refinement for delta-applying consumers.
   */
  private async handleIncoming(event: AssetEvent): Promise<void> {
    const channel = event.channel;
    const seq = typeof event.seq === "number" ? event.seq : undefined;
    if (!channel || seq === undefined) {
      this.fanout(event);
      return;
    }
    if (event.eventId && this.seen.has(event.eventId)) return;
    const last = this.lastSeq.get(channel);
    if (last !== undefined && seq > last + 1 && !this.catchingUp.has(channel)) {
      await this.catchUp(channel, last);
    }
    const seen = this.lastSeq.get(channel);
    if (seen !== undefined && seq <= seen) return; // covered by the replay
    this.accept(event, channel, seq);
  }

  private accept(event: AssetEvent, channel: string, seq: number): void {
    const prev = this.lastSeq.get(channel);
    this.lastSeq.set(channel, prev === undefined ? seq : Math.max(prev, seq));
    if (event.eventId) {
      if (this.seen.size >= SEEN_CAP) this.seen.clear();
      this.seen.add(event.eventId);
    }
    this.fanout(event);
  }

  private async catchUp(channel: string, afterSeq: number): Promise<void> {
    this.catchingUp.add(channel);
    try {
      let after = afterSeq;
      for (let page = 0; page < 50; page++) {
        const { events, hasMore } = await fetchReplay(channel, after);
        for (const ev of events) {
          const s = typeof ev.seq === "number" ? ev.seq : undefined;
          if (s === undefined) continue;
          const seen = this.lastSeq.get(channel);
          if (seen !== undefined && s <= seen) continue;
          if (ev.eventId && this.seen.has(ev.eventId)) continue;
          this.accept(ev, channel, s);
          after = s;
        }
        if (!hasMore) break;
      }
    } catch {
      // Swallow — the next push or the consumer's focus-refetch backstop recovers.
    } finally {
      this.catchingUp.delete(channel);
    }
  }

  private fanout(event: AssetEvent): void {
    for (const sub of this.subscribers) sub.onEvent?.(event);
  }

  private teardown(): void {
    this.socket?.close();
    this.socket = null;
    this.connected = false;
  }
}

const kernels = new Map<string, AssetsRealtimeKernel>();

/**
 * The shared asset-realtime kernel for a scope (default = the current user).
 * All consumers in the same scope share one socket.
 */
export function getAssetsRealtimeKernel(options: AssetsRealtimeOptions = {}): AssetsRealtimeKernel {
  const key = options.workspaceId ?? "__user__";
  let kernel = kernels.get(key);
  if (!kernel) {
    kernel = new AssetsRealtimeKernel(options);
    kernels.set(key, kernel);
  }
  return kernel;
}
