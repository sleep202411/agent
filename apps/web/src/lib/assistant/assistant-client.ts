import { readUIMessageStream, uiMessageChunkSchema, type UIMessageChunk } from "ai";
import { parseJsonEventStream } from "@ai-sdk/provider-utils";
import type {
  AssistantAttachment,
  AssistantChatErrorResponse,
  AssistantMessage,
  AssistantWorkspaceSelection,
} from "./assistant-types";

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

function sanitizeMessage(message: AssistantMessage): AssistantMessage {
  return {
    ...message,
    metadata: message.metadata?.attachments?.length
      ? {
          attachments: message.metadata.attachments.map(sanitizeAttachment),
        }
      : undefined,
  };
}

function toChunkStream(
  stream: ReadableStream<Uint8Array<ArrayBufferLike>>
): ReadableStream<UIMessageChunk> {
  const parsedStream = parseJsonEventStream({
    stream,
    schema: uiMessageChunkSchema,
  });

  return new ReadableStream<UIMessageChunk>({
    async start(controller) {
      const reader = parsedStream.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }

        if (value.success) {
          controller.enqueue(value.value);
        } else {
          controller.error(value.error);
          return;
        }
      }
    },
  });
}

async function parseError(response: Response) {
  try {
    const data = (await response.json()) as AssistantChatErrorResponse & {
      code?: string;
      current?: number;
      max?: number;
    };
    // Handle message limit error
    if (data.code === "MESSAGE_LIMIT_REACHED") {
      return `MESSAGE_LIMIT_REACHED:${data.current ?? 0}:${data.max ?? 0}`;
    }
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

// ─── Chat API (single message) ─────────────────────────

export interface SendAssistantChatOptions {
  projectId: string;
  /** Single new user message to send */
  userMessage: AssistantMessage;
  workspaceContext: AssistantWorkspaceSelection;
  agentType?: string;
  signal?: AbortSignal;
  onMessage: (message: AssistantMessage) => void;
}

export async function sendAssistantChat({
  projectId,
  userMessage,
  workspaceContext,
  agentType,
  signal,
  onMessage,
}: SendAssistantChatOptions) {
  const response = await fetch("/aurora/assistant/chat", {
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
      userMessage: sanitizeMessage(userMessage),
      workspaceContext,
      agentType,
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(await parseError(response));
  }

  const stream = toChunkStream(response.body);
  let latest: AssistantMessage | null = null;

  const placeholderMessage: AssistantMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: [],
  };

  for await (const message of readUIMessageStream({
    message: placeholderMessage as Parameters<typeof readUIMessageStream>[0]["message"],
    stream,
  })) {
    latest = message as AssistantMessage;
    onMessage(latest);
  }

  return latest;
}

// ─── History API ───────────────────────────────────────

export interface ConversationHistoryResponse {
  messages: AssistantMessage[];
  messageCount: number;
  messageLimit: number;
  tier: string;
}

export async function fetchConversationHistory(
  projectId: string
): Promise<ConversationHistoryResponse> {
  const response = await fetch(`/aurora/assistant/history/${projectId}`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Failed to load history: HTTP ${response.status}`);
  }

  const body = (await response.json()) as {
    success: boolean;
    data: ConversationHistoryResponse;
  };

  return body.data;
}

// ─── Clear API ─────────────────────────────────────────

export async function clearConversation(
  projectId: string
): Promise<{ messageCount: number; messageLimit: number }> {
  const response = await fetch(`/aurora/assistant/clear/${projectId}`, {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error(`Failed to clear conversation: HTTP ${response.status}`);
  }

  const body = (await response.json()) as {
    success: boolean;
    data: { messageCount: number; messageLimit: number };
  };

  return body.data;
}
