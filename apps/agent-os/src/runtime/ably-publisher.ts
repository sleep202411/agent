import {
  AGENT_OS_ABLY_EVENT_NAME,
  AGENT_OS_ABLY_SNAPSHOT_NAME,
  agentOsConversationChannel,
  type AgentOsAblyRunSnapshot,
} from "@repo/shared";
import type { AgentEventEnvelope } from "@repo/agent-protocol";

type AblyRestLike = {
  channels: {
    get: (name: string) => {
      publish: (
        messages:
          | { name: string; data: unknown; id?: string }
          | Array<{ name: string; data: unknown; id?: string }>
      ) => Promise<void>;
    };
  };
};

/**
 * Optional Ably REST publisher for Agent OS live events.
 * Missing ABLY_API_KEY → no-op (UI falls back to Nest poll).
 */
export class AgentOsAblyPublisher {
  private client: AblyRestLike | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly pending = new Map<string, Promise<void>>();

  get enabled(): boolean {
    return Boolean(process.env.ABLY_API_KEY?.trim());
  }

  private async ensureClient(): Promise<AblyRestLike | null> {
    if (!this.enabled) return null;
    if (this.client) return this.client;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const key = process.env.ABLY_API_KEY!.trim();
        const ably = await import("ably");
        this.client = new ably.Rest({
          key,
          clientId: "agent-os-worker",
          idempotentRestPublishing: true,
        }) as unknown as AblyRestLike;
      })().catch((error) => {
        this.initPromise = null;
        process.stderr.write(
          `${JSON.stringify({
            level: "warn",
            msg: "agent-os.ably.init_failed",
            error: error instanceof Error ? error.message : String(error),
          })}\n`
        );
      });
    }
    await this.initPromise;
    return this.client;
  }

  /** Fire-and-forget; serializes per conversation to preserve order. */
  publishEvent(event: AgentEventEnvelope): void {
    if (!this.enabled) return;
    const channel = agentOsConversationChannel(event.conversationId);
    void this.enqueue(channel, async (rest) => {
      await rest.channels.get(channel).publish({
        name: AGENT_OS_ABLY_EVENT_NAME,
        data: event,
        id: event.id,
      });
    });
  }

  publishSnapshot(snapshot: AgentOsAblyRunSnapshot): void {
    if (!this.enabled) return;
    const channel = agentOsConversationChannel(snapshot.conversationId);
    void this.enqueue(channel, async (rest) => {
      await rest.channels.get(channel).publish({
        name: AGENT_OS_ABLY_SNAPSHOT_NAME,
        data: snapshot,
        id: `snap:${snapshot.runId}:${snapshot.status}:${snapshot.lastSequence}`,
      });
    });
  }

  private enqueue(channel: string, work: (rest: AblyRestLike) => Promise<void>): void {
    const prev = this.pending.get(channel) ?? Promise.resolve();
    const next = prev
      .then(async () => {
        const rest = await this.ensureClient();
        if (!rest) return;
        try {
          await work(rest);
        } catch (error) {
          process.stderr.write(
            `${JSON.stringify({
              level: "warn",
              msg: "agent-os.ably.publish_failed",
              channel,
              error: error instanceof Error ? error.message : String(error),
            })}\n`
          );
        }
      })
      .finally(() => {
        if (this.pending.get(channel) === next) this.pending.delete(channel);
      });
    this.pending.set(channel, next);
  }
}

/** Process-wide publisher (one REST client). */
export const agentOsAbly = new AgentOsAblyPublisher();
