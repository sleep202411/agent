import { isToolUIPart } from "ai";

import type { StudioAgentUIMessage, StudioAgentUIPart } from "./transport-contract";

/**
 * Collapse the overlap between durable history, Ably's live tail, and the
 * optimistic creator echo into one linear conversation.
 *
 * The transport normally removes its seam overlap. This function is the
 * product boundary that makes the stronger promise the renderer and the next
 * model turn actually need: one domain message id appears once, in the
 * position where it first entered the conversation, with the most advanced
 * payload observed for it.
 *
 * Keeping the first position and id is deliberate. Replacing an optimistic
 * row with its later durable/live echo must update that row in place; moving or
 * remounting it loses the reader's scroll anchor and is the source of the
 * duplicate React-key warnings seen when a reconnect races a history refresh.
 */
export function reconcileStudioAgentMessages(
  messages: readonly StudioAgentUIMessage[]
): StudioAgentUIMessage[] {
  const reconciled: StudioAgentUIMessage[] = [];
  const indexById = new Map<string, number>();
  const indexByClientMessageId = new Map<string, number>();
  let changed = false;

  for (const message of messages) {
    const clientMessageId = message.metadata?.clientMessageId;
    const existingIndex =
      indexById.get(message.id) ??
      (clientMessageId ? indexByClientMessageId.get(clientMessageId) : undefined);

    if (existingIndex === undefined) {
      const index = reconciled.length;
      reconciled.push(message);
      indexById.set(message.id, index);
      if (clientMessageId) indexByClientMessageId.set(clientMessageId, index);
      continue;
    }

    const existing = reconciled[existingIndex]!;
    const merged = mergeMessageVersions(existing, message);
    reconciled[existingIndex] = merged;
    indexById.set(message.id, existingIndex);
    indexById.set(existing.id, existingIndex);
    if (existing.metadata?.clientMessageId) {
      indexByClientMessageId.set(existing.metadata.clientMessageId, existingIndex);
    }
    if (clientMessageId) indexByClientMessageId.set(clientMessageId, existingIndex);
    changed = true;
  }

  return changed ? reconciled : [...messages];
}

function mergeMessageVersions(
  existing: StudioAgentUIMessage,
  incoming: StudioAgentUIMessage
): StudioAgentUIMessage {
  const preferred = compareProgress(incoming, existing) >= 0 ? incoming : existing;
  return {
    ...preferred,
    // Stable row identity and causal position come from the first observation.
    id: existing.id,
    role: existing.role,
    metadata: mergeMetadata(existing, incoming),
  };
}

function mergeMetadata(
  existing: StudioAgentUIMessage,
  incoming: StudioAgentUIMessage
): StudioAgentUIMessage["metadata"] {
  const merged = {
    ...existing.metadata,
    ...incoming.metadata,
  };
  // A transport reconstruction may omit metadata that durable history owns.
  // Spreading `undefined` over it would erase the join keys the projection uses.
  const keys = [
    "conversationId",
    "threadId",
    "runId",
    "createdAt",
    "format",
    "clientMessageId",
    "delivery",
  ] as const;
  for (const key of keys) {
    if (merged[key] === undefined && existing.metadata?.[key] !== undefined) {
      Object.assign(merged, { [key]: existing.metadata[key] });
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * Compare two observations of the same message.
 *
 * Text growth is the primary streaming clock. When text is unchanged, terminal
 * tool/activity states and additional parts are stronger evidence of progress.
 * The final tie intentionally prefers the incoming observation so metadata
 * added by the durable echo is not stranded behind an equal live copy.
 */
function compareProgress(left: StudioAgentUIMessage, right: StudioAgentUIMessage): number {
  const leftProgress = messageProgress(left);
  const rightProgress = messageProgress(right);
  return (
    leftProgress.textLength - rightProgress.textLength ||
    leftProgress.terminalParts - rightProgress.terminalParts ||
    leftProgress.parts - rightProgress.parts ||
    leftProgress.settledTextParts - rightProgress.settledTextParts
  );
}

function messageProgress(message: StudioAgentUIMessage): {
  textLength: number;
  terminalParts: number;
  parts: number;
  settledTextParts: number;
} {
  let textLength = 0;
  let terminalParts = 0;
  let settledTextParts = 0;
  for (const part of message.parts) {
    if (part.type === "text") {
      textLength += part.text.length;
      if (part.state !== "streaming") settledTextParts += 1;
      continue;
    }
    if (isTerminalPart(part)) terminalParts += 1;
  }
  return {
    textLength,
    terminalParts,
    parts: message.parts.length,
    settledTextParts,
  };
}

function isTerminalPart(part: StudioAgentUIPart): boolean {
  if (isToolUIPart(part)) {
    return (
      part.state === "output-available" ||
      part.state === "output-error" ||
      part.state === "output-denied" ||
      part.state === "approval-responded"
    );
  }
  if (part.type === "data-studio-agent-activity") {
    return part.data.status !== "running";
  }
  return part.type === "data-studio-agent-failure";
}
