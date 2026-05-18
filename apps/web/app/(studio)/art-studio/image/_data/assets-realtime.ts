"use client";

/**
 * Assets realtime client — subscribes to a user's Asset event stream
 * over Azure Web PubSub. One connection per logged-in session covers
 * every Asset-domain push (Foundry image/video jobs today; future
 * uploads, audio jobs, etc.).
 *
 * Lifecycle:
 *   1. POST /aurora/realtime/negotiate/assets → { url } (JWT issued
 *      server-side, pre-joins `assets-user:{userId}` group)
 *   2. WebPubSubClient connects to Azure, gets `group-message` events
 *   3. SDK handles auto-reconnect + token refresh
 *
 * Each message arrives as an `AssetEvent` (discriminated by `kind`);
 * the consumer dispatches on `kind` to its own handler.
 */
import { WebPubSubClient, type OnGroupDataMessageArgs } from "@azure/web-pubsub-client";
import type { AssetEvent } from "@repo/shared";

export interface AssetsRealtimeHandlers {
  onConnected?: () => void;
  onEvent?: (event: AssetEvent) => void;
  onDisconnected?: (reason: string) => void;
}

export interface AssetsRealtimeClient {
  close(): void;
}

interface NegotiateResponse {
  code: number;
  data?: { url: string; accessToken: string; expiresAt: number };
  message?: string;
}

async function negotiate(): Promise<string> {
  const res = await fetch("/aurora/realtime/negotiate/assets", {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) throw new Error(`negotiate http ${res.status}`);
  const body = (await res.json()) as NegotiateResponse;
  if (body.code !== 200 || !body.data?.url) {
    throw new Error(`negotiate failed: ${body.message ?? "no url"}`);
  }
  return body.data.url;
}

export function openAssetsRealtime(handlers: AssetsRealtimeHandlers): AssetsRealtimeClient {
  let userClosed = false;

  const client = new WebPubSubClient(
    { getClientAccessUrl: () => negotiate() },
    { autoReconnect: true, autoRejoinGroups: true }
  );

  client.on("connected", () => {
    if (userClosed) return;
    handlers.onConnected?.();
  });

  client.on("group-message", (msg: OnGroupDataMessageArgs) => {
    const data = msg.message.data as AssetEvent | undefined;
    if (!data || typeof data.kind !== "string") return;
    handlers.onEvent?.(data);
  });

  client.on("disconnected", (e) => {
    const reason = e.message?.message ?? "disconnected";
    handlers.onDisconnected?.(reason);
  });

  void client.start().catch((err) => {
    handlers.onDisconnected?.(err instanceof Error ? err.message : "start_failed");
  });

  return {
    close() {
      userClosed = true;
      void client.stop();
    },
  };
}
