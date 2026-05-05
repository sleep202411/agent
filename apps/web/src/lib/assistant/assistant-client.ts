import type {
  AssistantAttachment,
  AssistantChatErrorResponse,
  AssistantMessage,
  AssistantWorkspaceSelection,
} from "./assistant-types";
import type { AgentState } from "@repo/shared";

function sanitizeAttachment(attachment: AssistantAttachment): AssistantAttachment {
  return {
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    path: attachment.path,
    url: attachment.url,
    excerpt: attachment.excerpt,
  };
}

function sanitizeMessages(messages: AssistantMessage[]): AssistantMessage[] {
  return messages.map((message) => ({
    ...message,
    metadata: message.metadata?.attachments?.length
      ? {
          attachments: message.metadata.attachments.map(sanitizeAttachment),
        }
      : undefined,
  }));
}

async function parseError(response: Response) {
  try {
    const data = (await response.json()) as AssistantChatErrorResponse;
    if (data.issues?.length) {
      const formattedIssues = data.issues.map((issue) => {
        const path = issue.path.length ? issue.path.join(".") : "request";
        return `${path}：${issue.message}`;
      });
      return `${data.message}：${formattedIssues.join("；")}`;
    }
    return data.message || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export async function fetchMessagesByIds(
  conversationId: string,
  messageIds: string[]
): Promise<AssistantMessage[]> {
  if (messageIds.length === 0) return [];
  const response = await fetch("/aurora/chat/get-messages", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId, messageIds }),
  });
  if (!response.ok) return [];
  const body = (await response.json()) as {
    conversationId: string;
    messages: AssistantMessage[];
  };
  return body.messages ?? [];
}

// ─── Chat API (shared option shape) ───────────────────

export interface ForceEnterWorkflow {
  /** Target workflow ID — supervisor must skip routing and invoke directly. */
  workflowName: string;
  /** Optional pre-filled inputData; supervisor merges with its own context. */
  inputData?: Record<string, unknown>;
}

export interface ConfirmWorkflowPayload {
  /** Which suspended workflow run this confirmation targets. */
  runId: string;
  /** User's decision — true = satisfied, false = revise with feedback. */
  approved: boolean;
  /** Free-form feedback when approved=false. */
  feedback?: string;
  /**
   * parse_script-only opt-in: when true, the apply step deletes the
   * project's existing episodes before persisting this batch (Java
   * cascades the wipe to scripts/storyboards). Surfaced via the HITL
   * card's "替换 / 追加" toggle, only when the suspended payload carries
   * a non-zero existingEpisodeCount.
   */
  replaceExisting?: boolean;
}

export interface ConfirmProjectParamsPayload {
  aspectRatioType: string;
  chapterLength: number;
  stylePainting: string;
  dialogLanguage: string;
  /**
   * Target number of episodes the user wants. NOT persisted by Java — the
   * value is embedded into the `tool-require_project_params` tool output so
   * chat history is the single source-of-truth (read via
   * `readMostRecentProjectParam` at every workflow dispatch).
   */
  targetEpisodeCount?: number;
  /**
   * Target number of shots per episode for storyboard_phase. Same chat-
   * history-as-source-of-truth story as targetEpisodeCount — not written to
   * Java, threaded into storyboard_phase via workspaceContext.
   */
  shotsPerEpisode?: number;
  /**
   * Workflow to auto-start on the server once params are saved. Supervisor
   * sets this on the require_project_params tool call when it already
   * knows the target workflow; the form card reads it from the tool
   * input and forwards verbatim. Server short-circuits dispatch so we
   * skip a second LLM turn.
   */
  onConfirmWorkflow?: {
    workflowName: string;
    inputData?: Record<string, unknown>;
  };
}

export interface SubmitMessageOptions {
  projectId: string;
  messages: AssistantMessage[];
  workspaceContext: AssistantWorkspaceSelection;
  signal?: AbortSignal;
  forceEnterWorkflow?: ForceEnterWorkflow;
  confirmWorkflow?: ConfirmWorkflowPayload;
  confirmProjectParams?: ConfirmProjectParamsPayload;
}

export interface SubmitMessageResult {
  agentInstanceId: string;
  conversationId: string;
  seedMessageId: string;
}

// ─── Mastra supervisor chat — fully WS-based ──────────
//
// The POST no longer streams. It returns a tiny JSON envelope:
//   { agentInstanceId, conversationId, seedMessageId }
// and the server runs the Mastra consumer in the background, writing each
// UIMessage snapshot to Redis + publishing `message_added` / `message_updated`
// / `agent_state` events on the chat-events Redis channel.
//
// The browser opens ONE WebSocket per project (see chat-events-client +
// useChatEventsSession hook); this function is pure fire-and-forget from
// the caller's POV. Message updates flow into Redux via the WS handlers.

export async function submitMessageToAgent({
  projectId,
  messages,
  workspaceContext,
  signal,
  forceEnterWorkflow,
  confirmWorkflow,
  confirmProjectParams,
}: SubmitMessageOptions): Promise<SubmitMessageResult> {
  const response = await fetch("/aurora/assistant/submit-message-to-agent", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "Accept-Language":
        workspaceContext.locale ||
        (typeof document !== "undefined" ? document.documentElement.lang : "") ||
        "zh-CN",
    },
    body: JSON.stringify({
      projectId,
      messages: sanitizeMessages(messages),
      workspaceContext,
      ...(forceEnterWorkflow ? { forceEnterWorkflow } : {}),
      ...(confirmWorkflow ? { confirmWorkflow } : {}),
      ...(confirmProjectParams ? { confirmProjectParams } : {}),
    }),
    signal,
  });

  if (response.status === 409) {
    // AGENT_BUSY — server says another turn is already running for
    // this project. Throw a typed error so the slice's catch can
    // distinguish it from generic failures and update agentState
    // instead of showing a "Request failed" message.
    let body: { code?: string; current?: AgentState; message?: string } = {};
    try {
      body = (await response.json()) as typeof body;
    } catch {
      /* fall through to default message */
    }
    throw new AgentBusyError(
      body.message ?? "Agent is already running for this project",
      body.current
    );
  }

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  const envelope = (await response.json()) as Partial<SubmitMessageResult>;
  if (!envelope.agentInstanceId || !envelope.seedMessageId) {
    throw new Error("submit-message-to-agent: missing envelope fields");
  }
  return {
    agentInstanceId: envelope.agentInstanceId,
    conversationId: envelope.conversationId ?? projectId,
    seedMessageId: envelope.seedMessageId,
  };
}

/**
 * Thrown by submitMessageToAgent when the server returns 409
 * AGENT_BUSY. Carries the current AgentState so the slice can hydrate
 * Redux + show the right hint instead of a generic error message.
 */
export class AgentBusyError extends Error {
  current?: AgentState;
  constructor(message: string, current?: AgentState) {
    super(message);
    this.name = "AgentBusyError";
    this.current = current;
  }
}

// ─── Save API ─────────────────────────────────────────
//
// In the new architecture, the server writes every assistant/user message to
// Redis as part of submit-message-to-agent (see chat/agent-stream.service +
// mastra-proxy.persistInboundMessages). There's nothing left for the client
// to save — the store is already the source of truth.
//
// This function is kept as a no-op so existing callers (three thunks in
// assistantSlice) can be migrated incrementally. We'll delete the call sites
// in a follow-up sweep.
export async function saveConversation(
  _projectId: string,
  _messages: AssistantMessage[]
): Promise<void> {
  // no-op — persistence happens server-side during the stream.
}

// ─── History API ───────────────────────────────────────

export interface ConversationHistoryResponse {
  conversationId: string;
  messages: AssistantMessage[];
}

/**
 * Load conversation history from the Redis-backed message store via
 * /aurora/chat/list-messages (id snapshot) + /aurora/chat/get-messages
 * (full content).
 */
export async function fetchConversationHistory(
  projectId: string
): Promise<ConversationHistoryResponse> {
  const listResponse = await fetch("/aurora/chat/list-messages", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId: projectId }),
  });
  if (!listResponse.ok) {
    throw new Error(`Failed to list messages: HTTP ${listResponse.status}`);
  }
  const listBody = (await listResponse.json()) as {
    conversationId: string;
    messageIds: string[];
    agentState: string;
  };
  const messages =
    listBody.messageIds.length > 0 ? await fetchMessagesByIds(projectId, listBody.messageIds) : [];
  return {
    conversationId: listBody.conversationId,
    messages,
  };
}

// ─── Clear API ─────────────────────────────────────────

export async function clearConversation(projectId: string): Promise<void> {
  await fetch("/aurora/chat/clear-conversation", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversationId: projectId }),
  });
}
