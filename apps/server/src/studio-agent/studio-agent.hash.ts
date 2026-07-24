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
