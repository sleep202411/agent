import {
  AgentEventEnvelopeSchema,
  AgentEventTypeSchema,
  FIZZ_AGENT_PROTOCOL_VERSION,
  assertMonotonicSequence,
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
 * In-process sequence journal. Gateway persists to PostgreSQL;
 * optional onAppend fans out to Ably for low-latency UI.
 */
export class EventJournal {
  private sequence = 0;
  private readonly events: AgentEventEnvelope[] = [];

  constructor(private readonly onAppend?: (event: AgentEventEnvelope) => void) {}

  get lastSequence(): number {
    return this.sequence;
  }

  listFrom(lastSequence: number): AgentEventEnvelope[] {
    return this.events.filter((event) => event.sequence > lastSequence);
  }

  all(): readonly AgentEventEnvelope[] {
    return this.events;
  }

  append(input: AppendEventInput): AgentEventEnvelope {
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
      type: AgentEventTypeSchema.parse(input.type),
      data: input.data,
    });

    this.events.push(envelope);
    try {
      this.onAppend?.(envelope);
    } catch {
      /* publisher must never break the turn */
    }
    return envelope;
  }
}
