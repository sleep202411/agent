import { createHash } from 'node:crypto';
import type {
  StudioAgentJsonValue,
  StudioAgentResourceRef,
} from '@repo/shared/studio-agent';

/**
 * Canonical JSON is the single hashing representation used across actions,
 * scopes and context checkpoints. Object insertion order is never significant.
 */
export function canonicalStudioAgentJson(value: StudioAgentJsonValue): string {
  return JSON.stringify(sortJson(value));
}

export function hashStudioAgentJson(value: StudioAgentJsonValue): string {
  return createHash('sha256')
    .update(canonicalStudioAgentJson(value), 'utf8')
    .digest('hex');
}

/**
 * A UUID that is a pure function of the identity handed to it.
 *
 * Machine fields the server fills into a tool-call input are folded into
 * `inputHash`, and `inputHash` is both the prepare-time idempotency key
 * (`STUDIO_AGENT_ACTION_IDEMPOTENCY_CONFLICT`) and the approval challenge a
 * creator signs. `randomUUID()` there would mean a retried POST — the gateway
 * replays the same bytes after a dropped connection or a 502/503/504 — hashes
 * differently from the attempt that already committed, turning a network blip
 * into a hard turn failure. Deriving the id from the request's own identity
 * keeps every replay byte-identical.
 *
 * RFC 9562 version 8 (custom): the bytes are SHA-256 over `seed`, not a
 * namespaced v5 SHA-1 digest, so v8 is the honest version nibble.
 */
export function deriveStudioAgentUuid(seed: string): string {
  const bytes = createHash('sha256')
    .update(seed, 'utf8')
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * Thread identity follows its durable container. A transient focused node may
 * change without forking the conversation.
 */
export function studioAgentScopeKey(
  workspaceId: string,
  container: StudioAgentResourceRef,
): string {
  return hashStudioAgentJson({
    workspaceId,
    resourceType: container.resourceType,
    resourceId: container.resourceId,
  });
}

function sortJson(value: StudioAgentJsonValue): StudioAgentJsonValue {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        // Codepoint comparison, NOT localeCompare: this hash is persisted then
        // recompared across pods and time (requestHash idempotency, outbox
        // dedupe). localeCompare depends on host locale / ICU version, so a
        // differently-configured or upgraded pod could order non-ASCII keys
        // differently and silently break retry idempotency.
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, child]) => [key, sortJson(child)]),
    );
  }
  return value;
}
