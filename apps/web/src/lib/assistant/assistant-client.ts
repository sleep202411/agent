"use client";

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

export interface SendAssistantChatOptions {
  projectId: string;
  messages: AssistantMessage[];
  workspaceContext: AssistantWorkspaceSelection;
  signal?: AbortSignal;
  onMessage: (message: AssistantMessage) => void;
}

export async function sendAssistantChat({
  projectId,
  messages,
  workspaceContext,
  signal,
  onMessage,
}: SendAssistantChatOptions) {
  const response = await fetch("/api/assistant/chat", {
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
    }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(await parseError(response));
  }

  const stream = toChunkStream(response.body);
  let latest: AssistantMessage | null = null;
  let finishReason: string | undefined;

  const placeholderMessage: AssistantMessage = {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: [],
  };

  for await (const message of readUIMessageStream({
    message: placeholderMessage,
    stream,
    onFinish({ finishReason: reason }) {
      finishReason = reason;
    },
  })) {
    latest = message as AssistantMessage;
    onMessage(latest);
  }

  if (finishReason === "error") {
    throw new Error("AI 处理过程中出现错误，请重试");
  }

  return latest;
}
