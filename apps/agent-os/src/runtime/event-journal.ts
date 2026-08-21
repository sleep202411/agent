import {
  AgentEventEnvelopeSchema,
  AgentEventTypeSchema,
  FIZZ_AGENT_PROTOCOL_VERSION,
  assertMonotonicSequence,
  parseAgentEventDataForWrite,
  type AgentEventEnvelope,
  type AgentEventType,
} from "@repo/agent-protocol";

export interface AppendEventInput {
  sessionId: string;
  runId: string;
  conversationId: string;
  type: AgentEventType;
  data: Record<string, unknown>;
  id?: string;
  timestamp?: string;
}

/**
 * In-process sequence journal. The worker reports committed snapshots to the
 * Gateway; only the Gateway may publish realtime events.
 */
export class EventJournal {
  private sequence = 0;
  private readonly events: AgentEventEnvelope[] = [];

  get lastSequence(): number {
    return this.sequence;
  }

  listFrom(lastSequence: number): AgentEventEnvelope[] {
    return this.events.filter((event) => event.sequence > lastSequence);
  }

  all(): readonly AgentEventEnvelope[] {
    return this.events;
  }

  /**
   * Seed a journal with events already persisted by the gateway, so a worker
   * that restarted mid-run keeps appending ABOVE the durable tail instead of
   * restarting at sequence 1 — which would make the next snapshot overwrite
   * the stored transcript with a shorter one.
   *
   * Only valid on an untouched journal; re-seeding a live one would silently
   * reorder history.
   */
  restore(events: readonly AgentEventEnvelope[]): void {
    if (this.events.length > 0) {
      throw new Error("EventJournal.restore on a journal that already has events");
    }
    for (const event of events) {
      this.events.push(event);
      if (event.sequence > this.sequence) this.sequence = event.sequence;
    }
  }

  append(input: AppendEventInput): AgentEventEnvelope {
    // Validate before reserving a sequence; rejected writes must not create a
    // silent gap that later readers mistake for event loss.
    const type = AgentEventTypeSchema.parse(input.type);
    const data = parseAgentEventDataForWrite(type, input.data);
    const next = this.sequence + 1;
    if (this.sequence > 0) {
      assertMonotonicSequence(this.sequence, next);
    }
    this.sequence = next;

    const envelope = AgentEventEnvelopeSchema.parse({
      id: input.id ?? crypto.randomUUID(),
      protocolVersion: FIZZ_AGENT_PROTOCOL_VERSION,
      sessionId: input.sessionId,
      runId: input.runId,
      conversationId: input.conversationId,
      sequence: next,
      timestamp: input.timestamp ?? new Date().toISOString(),
      type,
      data,
    });

    this.events.push(envelope);
    return envelope;
  }
}
