"use client";

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
    credentials: "include",
    method: "POST",
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

  client.on("disconnected", (event) => {
    if (userClosed) return;
    handlers.onDisconnected?.(event.message?.message ?? "disconnected");
  });

  void client.start().catch((err) => {
    if (userClosed) return;
    handlers.onDisconnected?.(err instanceof Error ? err.message : "start_failed");
  });

  return {
    close() {
      userClosed = true;
      void client.stop();
    },
  };
}
