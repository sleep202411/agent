"use client";

import type { AssetEvent } from "@repo/shared";

/**
 * Asset realtime client — transport-pluggable.
 *
 * The negotiate endpoint reports which transport to use:
 *   - `web-pubsub`  → Azure Web PubSub (the .com cell). The Azure SDK is loaded
 *                     lazily so it is never bundled where it isn't used.
 *   - `self-hosted` → a native WebSocket to the in-cluster `/ws/realtime` plane
 *                     (the CN cell, where Web PubSub is unavailable).
 * Both deliver identical `AssetEvent` payloads, so callers are transport-blind.
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

type RealtimeTransport = "web-pubsub" | "self-hosted";

interface NegotiateData {
  url: string;
  accessToken: string;
  expiresAt: number;
  transport: RealtimeTransport;
}

interface NegotiateResponse {
  code: number;
  data?: Partial<NegotiateData>;
  message?: string;
}

async function negotiate(workspaceId?: string): Promise<NegotiateData> {
  const res = await fetch("/aurora/realtime/negotiate/assets", {
    credentials: "include",
    headers: workspaceId ? { "X-Fizz-Workspace-Id": workspaceId } : undefined,
    method: "POST",
  });
  if (!res.ok) throw new Error(`negotiate http ${res.status}`);
  const body = (await res.json()) as NegotiateResponse;
  if (body.code !== 200 || !body.data?.url || !body.data.accessToken) {
    throw new Error(`negotiate failed: ${body.message ?? "no url"}`);
  }
  return {
    url: body.data.url,
    accessToken: body.data.accessToken,
    expiresAt: body.data.expiresAt ?? 0,
    transport: body.data.transport ?? "web-pubsub",
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
    backend =
      access.transport === "self-hosted"
        ? openSelfHosted(access, options, handlers, isClosed)
        : await openWebPubSub(options, handlers, isClosed);
    if (userClosed) backend.close();
  })();

  return {
    close() {
      userClosed = true;
      backend?.close();
    },
  };
}

async function openWebPubSub(
  options: AssetsRealtimeOptions,
  handlers: AssetsRealtimeHandlers,
  isClosed: () => boolean
): Promise<AssetsRealtimeClient> {
  const { WebPubSubClient } = await import("@azure/web-pubsub-client");

  const client = new WebPubSubClient(
    { getClientAccessUrl: async () => (await negotiate(options.workspaceId)).url },
    { autoReconnect: true, autoRejoinGroups: true }
  );

  client.on("connected", () => {
    if (!isClosed()) handlers.onConnected?.();
  });
  client.on("group-message", (msg) => {
    const data = msg.message.data as AssetEvent | undefined;
    if (!data || typeof data.kind !== "string") return;
    handlers.onEvent?.(data);
  });
  client.on("disconnected", (event) => {
    if (!isClosed()) {
      handlers.onDisconnected?.(event.message?.message ?? "disconnected");
    }
  });

  void client.start().catch((err) => {
    if (!isClosed()) {
      handlers.onDisconnected?.(err instanceof Error ? err.message : "start_failed");
    }
  });

  return {
    close() {
      void client.stop();
    },
  };
}

const PING_INTERVAL_MS = 25_000;
const MAX_RECONNECT_DELAY_MS = 15_000;

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
    const delay = Math.min(1_000 * 2 ** Math.min(attempt, 4), MAX_RECONNECT_DELAY_MS);
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
      if ("event" in parsed) return; // control frame (heartbeat/terminate)
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
