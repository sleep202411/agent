import type { AgentHistoryPage } from "@repo/shared/agent-platform";
import { getToolName, isToolUIPart, validateUIMessages } from "ai";

import type { StudioAgentUIMessage } from "./transport-contract";
import type { StudioAgentActivityView, StudioAgentRunView } from "./view-model";

export interface StudioAgentHistorySeed {
  /** Durable Mastra memory, oldest first. */
  messages: StudioAgentUIMessage[];
  messageIds: ReadonlySet<string>;
  /** Opaque cursor for the next older durable page. */
  nextCursor: string | null;
  /**
   * Kept as empty projections for the renderer's transitional shape. Run and
   * step truth comes exclusively from the Ably view.
   */
  runs: StudioAgentRunView[];
  activities: StudioAgentActivityView[];
  /** Changes when a successful Story write appears in the canonical transcript. */
  writeToken: string;
  /** Nodes touched by the newest successful Story write. */
  writtenNodeIds: readonly string[];
}

export const EMPTY_STUDIO_AGENT_HISTORY_SEED: StudioAgentHistorySeed = {
  messages: [],
  messageIds: new Set(),
  nextCursor: null,
  runs: [],
  activities: [],
  writeToken: "",
  writtenNodeIds: [],
};

export async function createStudioAgentHistorySeed(
  page: AgentHistoryPage
): Promise<StudioAgentHistorySeed> {
  // An empty transcript is the canonical state for a new conversation. AI SDK
  // intentionally rejects an empty array because validateUIMessages() is also
  // used at generation boundaries, where at least one message is required.
  // This boundary validates durable history instead: preserve the valid empty
  // state and strictly validate every non-empty page.
  const messages: StudioAgentUIMessage[] =
    page.messages.length === 0
      ? []
      : await validateUIMessages<StudioAgentUIMessage>({
          messages: page.messages,
        });
  const write = newestStoryWrite(messages);
  return {
    messages,
    messageIds: new Set(messages.map((message) => message.id)),
    nextCursor: page.nextCursor,
    runs: [],
    activities: [],
    writeToken: write?.token ?? "",
    writtenNodeIds: write?.nodeIds ?? [],
  };
}

export function prependStudioAgentHistorySeed(
  current: StudioAgentHistorySeed,
  older: StudioAgentHistorySeed
): StudioAgentHistorySeed {
  const messageIds = new Set(current.messageIds);
  const messages = [...current.messages];
  for (let index = older.messages.length - 1; index >= 0; index -= 1) {
    const message = older.messages[index]!;
    if (messageIds.has(message.id)) continue;
    messageIds.add(message.id);
    messages.unshift(message);
  }
  return {
    ...current,
    messages,
    messageIds,
    nextCursor: older.nextCursor,
  };
}

export function refreshStudioAgentHistorySeed(
  previous: StudioAgentHistorySeed,
  window: StudioAgentHistorySeed
): StudioAgentHistorySeed {
  const olderMessages = previous.messages.filter((message) => !window.messageIds.has(message.id));
  const merged = prependStudioAgentHistorySeed(window, {
    ...previous,
    messages: olderMessages,
    messageIds: new Set(olderMessages.map((message) => message.id)),
  });
  return {
    ...merged,
    // A refresh replaces only the newest live window. The creator's pagination
    // cursor belongs to the already-composed history and may intentionally be
    // null because every older page was loaded; adopting the refreshed
    // window's cursor would resurrect an exhausted "load earlier" control.
    nextCursor: previous.nextCursor,
  };
}

function newestStoryWrite(
  messages: readonly StudioAgentUIMessage[]
): Readonly<{ token: string; nodeIds: readonly string[] }> | null {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex -= 1) {
    const message = messages[messageIndex]!;
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex]!;
      if (
        !isToolUIPart(part) ||
        getToolName(part) !== "story_apply_change_set" ||
        part.state !== "output-available"
      ) {
        continue;
      }
      const result = successfulStoryWriteResult(part.output);
      if (!result) continue;
      return {
        token: `${message.id}:${part.toolCallId}:${result.revision}`,
        nodeIds: result.affectedNodeIds,
      };
    }
  }
  return null;
}

function successfulStoryWriteResult(
  value: unknown
): Readonly<{ revision: number; affectedNodeIds: readonly string[] }> | null {
  if (!isRecord(value) || value.status !== "succeeded" || !isRecord(value.data)) return null;
  const data = value.data;
  if (
    data.schemaVersion !== "story-change-result/v2" ||
    typeof data.draftRevision !== "number" ||
    !Number.isInteger(data.draftRevision) ||
    !Array.isArray(data.affectedNodeIds) ||
    !data.affectedNodeIds.every((nodeId) => typeof nodeId === "string")
  ) {
    return null;
  }
  return {
    revision: data.draftRevision,
    affectedNodeIds: data.affectedNodeIds,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
