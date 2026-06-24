"use client";

import {
  openAssetsRealtime,
  type AssetsRealtimeClient,
  type AssetsRealtimeHandlers,
  type AssetsRealtimeOptions,
} from "./assets-realtime";

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
        onEvent: (event) => {
          for (const sub of this.subscribers) sub.onEvent?.(event);
        },
      },
      this.options
    );
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
