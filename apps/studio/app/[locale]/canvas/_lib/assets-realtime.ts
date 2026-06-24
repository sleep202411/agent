"use client";

import type { AssetEvent } from "@repo/shared";

/**
 * Asset realtime client — native WebSocket to the in-cluster `/ws/realtime`
 * plane (self-hosted, identical on .com and .cn). `negotiate` mints a short-lived
 * token; the socket reconnects with full-jitter exponential backoff and a circuit
 * breaker so a dead connection never floods the negotiate endpoint.
 *
 * Azure Web PubSub was removed (docs/studio-realtime-architecture.md §12 P1): its
 * client re-negotiated on every reconnect with no backoff — the flood root cause.
 */

export interface AssetsRealtimeHandlers {
  onConnected?: () => void;
  onEvent?: (event: AssetEvent) => void;
  onDisconnected?: (reason: string) => void;
}

export interface AssetsRealtimeClient {
  close(): void;
}

export interface AssetsRealtimeOptions {
  workspaceId?: string;
}

interface NegotiateData {
  url: string;
  accessToken: string;
  expiresAt: number;
}

interface NegotiateResponse {
  code: number;
  data?: Partial<NegotiateData> & { transport?: string };
  message?: string;
}

async function negotiate(workspaceId?: string): Promise<NegotiateData> {
  const headers: Record<string, string> = {};
  if (workspaceId) headers["X-Fizz-Workspace-Id"] = workspaceId;
  const res = await fetch("/aurora/realtime/negotiate/realtime", {
    credentials: "include",
    headers,
    method: "POST",
  });
  if (!res.ok) throw new Error(`negotiate http ${res.status}`);
  const body = (await res.json()) as NegotiateResponse;
  if (body.code !== 200 || !body.data?.url || !body.data.accessToken) {
    throw new Error(`negotiate failed: ${body.message ?? "no url"}`);
  }
  // Self-hosted is the only supported transport. Fail loud rather than silently
  // falling back to the removed (flood-prone) Web PubSub path.
  if (body.data.transport && body.data.transport !== "self-hosted") {
    throw new Error(`negotiate returned unsupported transport: ${body.data.transport}`);
  }
  return {
    url: body.data.url,
    accessToken: body.data.accessToken,
    expiresAt: body.data.expiresAt ?? 0,
  };
}

export function openAssetsRealtime(
  handlers: AssetsRealtimeHandlers,
  options: AssetsRealtimeOptions = {}
): AssetsRealtimeClient {
  let userClosed = false;
  let backend: AssetsRealtimeClient | null = null;
  const isClosed = () => userClosed;

  void (async () => {
    let access: NegotiateData;
    try {
      access = await negotiate(options.workspaceId);
    } catch (err) {
      if (!userClosed) {
        handlers.onDisconnected?.(err instanceof Error ? err.message : "negotiate_failed");
      }
      return;
    }
    if (userClosed) return;
    backend = openSelfHosted(access, options, handlers, isClosed);
    if (userClosed) backend.close();
  })();

  return {
    close() {
      userClosed = true;
      backend?.close();
    },
  };
}

const PING_INTERVAL_MS = 25_000;
const MAX_RECONNECT_DELAY_MS = 15_000;
// Circuit breaker: after this many consecutive failed (re)connects, back off to a
// slow cooldown probe instead of hammering negotiate — a dead WS must never flood
// the endpoint. The 5s poll backstop carries updates during cooldown.
const MAX_RECONNECT_ATTEMPTS = 6;
const COOLDOWN_MS = 60_000;

function openSelfHosted(
  initial: NegotiateData,
  options: AssetsRealtimeOptions,
  handlers: AssetsRealtimeHandlers,
  isClosed: () => boolean
): AssetsRealtimeClient {
  let ws: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  function buildUrl(access: NegotiateData): string {
    let base = access.url;
    if (!/^wss?:\/\//.test(base)) {
      const origin = window.location.origin.replace(/^http/, "ws");
      base = `${origin}${base.startsWith("/") ? "" : "/"}${base}`;
    }
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}token=${encodeURIComponent(access.accessToken)}`;
  }

  function stopPing() {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function scheduleReconnect() {
    if (stopped || isClosed()) return;
    attempt += 1;
    // Past the breaker threshold, stop hammering: probe at most once per cooldown.
    // `attempt` resets to 0 on a successful open (onopen), closing the breaker.
    const ceiling =
      attempt > MAX_RECONNECT_ATTEMPTS
        ? COOLDOWN_MS
        : Math.min(1_000 * 2 ** Math.min(attempt, 4), MAX_RECONNECT_DELAY_MS);
    // Full jitter — random in [0, ceiling] — so a mass disconnect doesn't produce
    // a synchronized reconnect (and negotiate) herd.
    const delay = Math.random() * ceiling;
    reconnectTimer = setTimeout(() => {
      void negotiate(options.workspaceId)
        .then((access) => {
          if (!stopped && !isClosed()) connect(access);
        })
        .catch(() => scheduleReconnect());
    }, delay);
  }

  function connect(access: NegotiateData) {
    if (stopped || isClosed()) return;
    try {
      ws = new WebSocket(buildUrl(access));
    } catch {
      scheduleReconnect();
      return;
    }
    ws.onopen = () => {
      attempt = 0;
      if (!isClosed()) handlers.onConnected?.();
      pingTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ event: "ping" }));
        }
      }, PING_INTERVAL_MS);
    };
    ws.onmessage = (ev) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== "object") return;
      // Control frames (heartbeat/terminate) carry `event`; asset events `kind`.
      if ("event" in parsed) return;
      const event = parsed as AssetEvent;
      if (typeof event.kind === "string") handlers.onEvent?.(event);
    };
    ws.onclose = () => {
      stopPing();
      if (stopped || isClosed()) return;
      handlers.onDisconnected?.("disconnected");
      scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose fires next; reconnect handled there.
    };
  }

  connect(initial);

  return {
    close() {
      stopped = true;
      stopPing();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      try {
        ws?.close();
      } catch {
        /* already closed */
      }
    },
  };
}
