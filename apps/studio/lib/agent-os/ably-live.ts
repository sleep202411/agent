"use client";

import {
  AGENT_OS_ABLY_EVENT_NAME,
  AGENT_OS_ABLY_RESYNC_NAME,
  AGENT_OS_ABLY_SNAPSHOT_NAME,
  agentOsConversationChannel,
  type AgentOsAblyResyncPointer,
  type AgentOsAblyRunSnapshot,
} from "@repo/shared";
import type { AgentOsEvent } from "@/lib/agent-os/api-client";
import { agentOsApi } from "@/lib/agent-os/api-client";

export type AgentOsLiveHandlers = {
  onEvent: (event: AgentOsEvent) => void;
  onSnapshot: (snapshot: AgentOsAblyRunSnapshot) => void;
  onResync: (pointer: AgentOsAblyResyncPointer) => void;
  onDiscontinuity: () => void;
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
  /** Invalidates every async stage of an older attach attempt. */
  private generation = 0;

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
    return this.open(input.projectId, input.conversationId, this.generation);
  }

  private async open(
    projectId: string,
    conversationId: string,
    generation: number
  ): Promise<boolean> {
    let live: import("ably").Realtime | null = null;
    try {
      let seeded: RealtimeGrant | null = await agentOsApi.realtimeToken(projectId, conversationId);
      const channelName = seeded.channel || agentOsConversationChannel(conversationId);
      const { Realtime } = await import("ably");
      if (!this.isCurrentAttempt(generation, conversationId)) return false;

      const attemptLive = new Realtime({
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
      live = attemptLive;

      this.client = attemptLive;

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Ably connect timeout"));
        }, 8_000);
        attemptLive.connection.once("connected", () => {
          clearTimeout(timeout);
          resolve();
        });
        attemptLive.connection.once("failed", () => {
          clearTimeout(timeout);
          reject(new Error("Ably connection failed"));
        });
        attemptLive.connection.once("closed", () => {
          clearTimeout(timeout);
          reject(new Error("Ably connection closed before attach"));
        });
      });

      if (!this.isCurrentAttempt(generation, conversationId, attemptLive)) {
        attemptLive.close();
        return false;
      }

      const channel = attemptLive.channels.get(channelName);
      const handleChannelState = (change: { resumed: boolean }) => {
        if (!this.isCurrentAttempt(generation, conversationId, attemptLive)) return;
        if (isAgentOsChannelDiscontinuity(change)) {
          this.handlers?.onDiscontinuity();
        }
      };
      // Register before subscribe implicitly attaches the channel. A fresh
      // attach is also `resumed:false`; HTTP journal catch-up is deliberately
      // safe and idempotent in that case.
      channel.on("attached", handleChannelState);
      channel.on("update", handleChannelState);
      channel.subscribe(AGENT_OS_ABLY_EVENT_NAME, (message) => {
        if (!this.isCurrentAttempt(generation, conversationId, attemptLive)) return;
        const data = message.data as AgentOsEvent | undefined;
        if (!data || typeof data !== "object" || typeof data.sequence !== "number") {
          return;
        }
        this.handlers?.onEvent(data);
      });
      channel.subscribe(AGENT_OS_ABLY_SNAPSHOT_NAME, (message) => {
        if (!this.isCurrentAttempt(generation, conversationId, attemptLive)) return;
        const data = message.data as AgentOsAblyRunSnapshot | undefined;
        if (!data || typeof data !== "object" || typeof data.runId !== "string") {
          return;
        }
        this.handlers?.onSnapshot(data);
      });
      channel.subscribe(AGENT_OS_ABLY_RESYNC_NAME, (message) => {
        if (!this.isCurrentAttempt(generation, conversationId, attemptLive)) return;
        const data = message.data;
        if (!isAgentOsAblyResyncPointer(data) || data.conversationId !== conversationId) {
          return;
        }
        this.handlers?.onResync(data);
      });

      attemptLive.connection.on((change) => {
        if (!this.isCurrentAttempt(generation, conversationId, attemptLive)) return;
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
      if (live) {
        try {
          live.close();
        } catch {
          /* ignore */
        }
      }
      if (this.isCurrentAttempt(generation, conversationId, live)) {
        this.connected = false;
        this.handlers = null;
        this.conversationId = null;
        this.client = null;
        this.generation += 1;
      }
      return false;
    }
  }

  detach(): void {
    this.generation += 1;
    this.connected = false;
    this.handlers = null;
    this.conversationId = null;
    const live = this.client;
    this.client = null;
    if (live) {
      try {
        live.close();
      } catch {
        /* ignore */
      }
    }
  }

  private isCurrentAttempt(
    generation: number,
    conversationId: string,
    live?: import("ably").Realtime | null
  ): boolean {
    return (
      this.generation === generation &&
      this.conversationId === conversationId &&
      (live == null || this.client === live)
    );
  }
}

export function isAgentOsAblyResyncPointer(value: unknown): value is AgentOsAblyResyncPointer {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const pointer = value as Record<string, unknown>;
  if (
    pointer.version !== 1 ||
    typeof pointer.runId !== "string" ||
    pointer.runId.length === 0 ||
    typeof pointer.conversationId !== "string" ||
    pointer.conversationId.length === 0 ||
    !Number.isInteger(pointer.sequence) ||
    Number(pointer.sequence) < 1 ||
    !Number.isInteger(pointer.afterSequence) ||
    Number(pointer.afterSequence) < 0 ||
    (pointer.kind === "event_backlog"
      ? Number(pointer.afterSequence) >= Number(pointer.sequence)
      : Number(pointer.afterSequence) !== Number(pointer.sequence) - 1)
  ) {
    return false;
  }
  if (pointer.kind === "snapshot_oversized") return true;
  return (
    (pointer.kind === "event_oversized" || pointer.kind === "event_backlog") &&
    typeof pointer.eventId === "string" &&
    pointer.eventId.length > 0
  );
}

export function isAgentOsChannelDiscontinuity(change: { resumed: boolean }): boolean {
  return change.resumed === false;
}
