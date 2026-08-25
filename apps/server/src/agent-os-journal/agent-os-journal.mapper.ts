import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  AgentEventEnvelopeSchema,
  type AgentEventEnvelope,
} from '@repo/agent-protocol';
import type { AgentOsAblyRunSnapshot } from '@repo/shared';

export function eventToCreateInput(
  event: AgentEventEnvelope,
): Prisma.AgentOsRunEventCreateManyInput {
  return {
    id: event.id,
    runId: event.runId,
    conversationId: event.conversationId,
    sequence: event.sequence,
    protocolVersion: event.protocolVersion,
    sessionId: event.sessionId,
    type: event.type,
    data: event.data as Prisma.InputJsonValue,
    occurredAt: new Date(event.timestamp),
  };
}

export function eventRowToEnvelope(row: {
  id: string;
  runId: string;
  conversationId: string;
  sequence: number;
  protocolVersion: string;
  sessionId: string;
  type: string;
  data: Prisma.JsonValue;
  occurredAt: Date;
}): AgentEventEnvelope {
  return AgentEventEnvelopeSchema.parse({
    id: row.id,
    protocolVersion: row.protocolVersion,
    sessionId: row.sessionId,
    runId: row.runId,
    conversationId: row.conversationId,
    sequence: row.sequence,
    timestamp: row.occurredAt.toISOString(),
    type: row.type,
    data: row.data,
  });
}

export function toRealtimeSnapshot(
  row: {
    id: string;
    conversationId: string;
    status: string;
    lastSequence: number;
    assistantText: string | null;
    pendingApproval: Prisma.JsonValue | null;
    pendingExternal: Prisma.JsonValue | null;
  },
  pendingUserInput?: unknown,
): AgentOsAblyRunSnapshot {
  return {
    runId: row.id,
    conversationId: row.conversationId,
    status: row.status,
    lastSequence: row.lastSequence,
    assistantText: row.assistantText,
    pendingApproval: row.pendingApproval,
    pendingUserInput: pendingUserInput ?? null,
    pendingExternal:
      row.pendingExternal as AgentOsAblyRunSnapshot['pendingExternal'],
  };
}

export function derivePendingUserInput(
  events: readonly AgentEventEnvelope[],
): unknown {
  let pending: Record<string, unknown> | null = null;
  for (const event of events) {
    if (event.type === 'UserInputRequired') pending = event.data;
    if (event.type === 'UserInputResolved') pending = null;
    if (
      event.type === 'RunCancelled' ||
      event.type === 'RunCompleted' ||
      event.type === 'RunFailed'
    ) {
      pending = null;
    }
  }
  return pending;
}

export function parseStringRecord(
  value: unknown,
): Readonly<Record<string, string>> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.some(([, item]) => typeof item !== 'string')) return null;
  return Object.fromEntries(entries) as Record<string, string>;
}

export function stableUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function journalErrorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}
