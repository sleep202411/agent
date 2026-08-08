"use client";

import {
  AGENT_OS_ABLY_EVENT_NAME,
  AGENT_OS_ABLY_SNAPSHOT_NAME,
  agentOsConversationChannel,
  type AgentOsAblyRunSnapshot,
} from "@repo/shared";
import type { AgentOsEvent } from "@/lib/agent-os/api-client";
import { agentOsApi } from "@/lib/agent-os/api-client";

export type AgentOsLiveHandlers = {
  onEvent: (event: AgentOsEvent) => void;
  onSnapshot: (snapshot: AgentOsAblyRunSnapshot) => void;
};

type RealtimeGrant = Awaited<ReturnType<typeof agentOsApi.realtimeToken>>;

/**
 * One Ably Realtime connection per conversation for Agent OS.
 * Dynamic import so the SDK is only loaded when the panel runs a turn.
 */
export class AgentOsAblyLive {
  private client: import("ably").Realtime | null = null;
  private conversationId: string | null = null;
  private handlers: AgentOsLiveHandlers | null = null;
  private connected = false;

  get isLive(): boolean {
    return this.connected;
  }

  async attach(input: {
    projectId: string;
    conversationId: string;
    handlers: AgentOsLiveHandlers;
  }): Promise<boolean> {
    if (this.conversationId === input.conversationId && this.client && this.connected) {
      this.handlers = input.handlers;
      return true;
    }

    this.detach();
    this.handlers = input.handlers;
    this.conversationId = input.conversationId;
    return this.open(input.projectId, input.conversationId);
  }

  private async open(projectId: string, conversationId: string): Promise<boolean> {
    try {
      let seeded: RealtimeGrant | null = await agentOsApi.realtimeToken(projectId, conversationId);
      const channelName = seeded.channel || agentOsConversationChannel(conversationId);
      const { Realtime } = await import("ably");

      const live = new Realtime({
        authCallback: (_params, callback) => {
          const pending = seeded
            ? Promise.resolve(seeded)
            : agentOsApi.realtimeToken(projectId, conversationId);
          seeded = null;
          pending.then(
            (next) => callback(null, next.tokenRequest),
            (cause: unknown) =>
              callback(cause instanceof Error ? cause.message : String(cause), null)
          );
        },
      });

      this.client = live;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Ably connect timeout"));
        }, 8_000);
        live.connection.once("connected", () => {
          clearTimeout(timeout);
          resolve();
        });
        live.connection.once("failed", () => {
          clearTimeout(timeout);
          reject(new Error("Ably connection failed"));
        });
      });

      if (this.conversationId !== conversationId) {
        live.close();
        return false;
      }

      const channel = live.channels.get(channelName);
      channel.subscribe(AGENT_OS_ABLY_EVENT_NAME, (message) => {
        const data = message.data as AgentOsEvent | undefined;
        if (!data || typeof data !== "object" || typeof data.sequence !== "number") {
          return;
        }
        this.handlers?.onEvent(data);
      });
      channel.subscribe(AGENT_OS_ABLY_SNAPSHOT_NAME, (message) => {
        const data = message.data as AgentOsAblyRunSnapshot | undefined;
        if (!data || typeof data !== "object" || typeof data.runId !== "string") {
          return;
        }
        this.handlers?.onSnapshot(data);
      });

      live.connection.on((change) => {
        if (change.current === "connected") this.connected = true;
        if (
          change.current === "failed" ||
          change.current === "closed" ||
          change.current === "suspended"
        ) {
          this.connected = false;
        }
      });
      this.connected = true;
      return true;
    } catch {
      this.connected = false;
      this.detach();
      return false;
    }
  }

  detach(): void {
    this.connected = false;
    this.handlers = null;
    this.conversationId = null;
    if (this.client) {
      try {
        this.client.close();
      } catch {
        /* ignore */
      }
      this.client = null;
    }
  }
}
