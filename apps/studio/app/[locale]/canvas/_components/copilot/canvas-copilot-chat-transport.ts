import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
  type DynamicToolUIPart,
  type ToolUIPart,
  type UIMessage,
} from "ai";
import { canonicalJsonString } from "@/lib/canonical-json";

const COPILOT_API = "/aurora/copilot/stream";

export interface CanvasCopilotChatRequestContext {
  conversationId: string;
  projectId: string;
  mode: "canvas";
  workspaceId: string | null;
  buildGraphDigest: () => string;
  buildModelsDigest: () => string;
}

export interface CanvasCopilotChatTransportController {
  transport: DefaultChatTransport<UIMessage>;
  updateContext: (context: CanvasCopilotChatRequestContext) => void;
  registerServerToolCall: (toolCall: CanvasCopilotServerToolCall) => void;
  authorizeCanonicalAssistantMessage: (message: UIMessage) => void;
}

export interface CanvasCopilotServerToolCall {
  toolName: string;
  toolCallId: string;
  input: unknown;
  dynamic?: boolean;
  title?: string;
  providerMetadata?: unknown;
}

interface TrustedToolCall {
  partType: `tool-${string}` | "dynamic-tool";
  toolName: string;
  toolCallId: string;
  input: string;
  title?: string;
  providerMetadata?: string;
}

const MAX_TOOL_CALL_ID_LENGTH = 256;
const MAX_TOOL_NAME_LENGTH = 128;
const MAX_TOOL_INPUT_BYTES = 256 * 1_024;
const MAX_TOOL_OUTPUT_BYTES = 2 * 1_024 * 1_024;
const MAX_TOOL_ERROR_BYTES = 16 * 1_024;

export function createCanvasCopilotChatTransport(
  initialContext: CanvasCopilotChatRequestContext
): CanvasCopilotChatTransportController {
  let context = initialContext;
  let assistantMessageId: string | null = null;
  let trustedToolCalls = new Map<string, TrustedToolCall>();

  const resetContinuationAuthority = () => {
    assistantMessageId = null;
    trustedToolCalls = new Map();
  };

  const registerServerToolCall = (toolCall: CanvasCopilotServerToolCall) => {
    const trusted = trustedToolCallFromServer(toolCall);
    const existing = trustedToolCalls.get(trusted.toolCallId);
    if (existing && !sameTrustedToolCall(existing, trusted)) {
      throw new Error("COPILOT_TOOL_CALL_IDENTITY_CHANGED");
    }
    trustedToolCalls.set(trusted.toolCallId, trusted);
  };

  const transport = new DefaultChatTransport<UIMessage>({
    api: COPILOT_API,
    credentials: "include",
    prepareSendMessagesRequest({ messages, trigger }) {
      const message = lastMessage(messages);
      const requestTrigger = message.role === "assistant" ? "tool-result-continuation" : trigger;
      if (message.role === "assistant") {
        assertAuthorizedToolContinuation(message, assistantMessageId, trustedToolCalls);
        assistantMessageId ??= message.id;
      } else {
        if (message.role !== "user") throw new Error("COPILOT_USER_MESSAGE_REQUIRED");
        resetContinuationAuthority();
      }
      return {
        body: {
          message,
          trigger: requestTrigger,
          conversationId: context.conversationId,
          projectId: context.projectId,
          mode: context.mode,
          graphContext: context.buildGraphDigest(),
          modelsContext: context.buildModelsDigest(),
        },
        headers: {
          ...(context.workspaceId ? { "x-fizz-workspace-id": context.workspaceId } : {}),
        },
      };
    },
  });
  return {
    transport,
    registerServerToolCall,
    authorizeCanonicalAssistantMessage(message) {
      if (message.role !== "assistant") {
        throw new Error("COPILOT_ASSISTANT_MESSAGE_REQUIRED");
      }
      const calls = trustedToolCallsFromCanonicalMessage(message);
      assistantMessageId = message.id;
      trustedToolCalls = calls;
    },
    updateContext(nextContext) {
      context = nextContext;
    },
  };
}

function lastMessage(messages: UIMessage[]): UIMessage {
  const message = messages[messages.length - 1];
  if (!message) throw new Error("COPILOT_MESSAGE_REQUIRED");
  return message;
}

function trustedToolCallFromServer(toolCall: CanvasCopilotServerToolCall): TrustedToolCall {
  assertIdentifier(toolCall.toolName, MAX_TOOL_NAME_LENGTH, "COPILOT_TOOL_NAME_INVALID");
  assertIdentifier(toolCall.toolCallId, MAX_TOOL_CALL_ID_LENGTH, "COPILOT_TOOL_CALL_ID_INVALID");
  const input = boundedCanonicalJson(
    toolCall.input,
    MAX_TOOL_INPUT_BYTES,
    "COPILOT_TOOL_INPUT_INVALID"
  );
  const providerMetadata =
    toolCall.providerMetadata === undefined
      ? undefined
      : boundedCanonicalJson(
          toolCall.providerMetadata,
          MAX_TOOL_INPUT_BYTES,
          "COPILOT_TOOL_METADATA_INVALID"
        );
  if (
    toolCall.title !== undefined &&
    (typeof toolCall.title !== "string" || utf8Length(toolCall.title) > MAX_TOOL_NAME_LENGTH)
  ) {
    throw new Error("COPILOT_TOOL_TITLE_INVALID");
  }
  return {
    partType: toolCall.dynamic ? "dynamic-tool" : `tool-${toolCall.toolName}`,
    toolName: toolCall.toolName,
    toolCallId: toolCall.toolCallId,
    input,
    title: toolCall.title,
    providerMetadata,
  };
}

function trustedToolCallsFromCanonicalMessage(message: UIMessage): Map<string, TrustedToolCall> {
  const calls = new Map<string, TrustedToolCall>();
  for (const part of message.parts) {
    if (!isToolUIPart(part) || part.providerExecuted) continue;
    const trusted = trustedToolCallFromPart(part);
    if (calls.has(trusted.toolCallId)) throw new Error("COPILOT_TOOL_CALL_ID_DUPLICATE");
    calls.set(trusted.toolCallId, trusted);
  }
  if (calls.size === 0) throw new Error("COPILOT_TOOL_CONTINUATION_REQUIRED");
  return calls;
}

function trustedToolCallFromPart(part: ToolUIPart | DynamicToolUIPart): TrustedToolCall {
  return trustedToolCallFromServer({
    toolName: getToolName(part),
    toolCallId: part.toolCallId,
    input: part.input,
    dynamic: part.type === "dynamic-tool",
    title: part.title,
    providerMetadata: part.callProviderMetadata,
  });
}

function assertAuthorizedToolContinuation(
  message: UIMessage,
  assistantMessageId: string | null,
  trustedToolCalls: ReadonlyMap<string, TrustedToolCall>
): void {
  if (!message.id || (assistantMessageId !== null && message.id !== assistantMessageId)) {
    throw new Error("COPILOT_ASSISTANT_MESSAGE_ID_CHANGED");
  }
  if (!lastAssistantMessageIsCompleteWithToolCalls({ messages: [message] })) {
    throw new Error("COPILOT_TOOL_OUTPUT_REQUIRED");
  }
  const toolParts = message.parts.filter(
    (part): part is ToolUIPart | DynamicToolUIPart => isToolUIPart(part) && !part.providerExecuted
  );
  if (toolParts.length === 0 || toolParts.length !== trustedToolCalls.size) {
    throw new Error("COPILOT_TOOL_CONTINUATION_MISMATCH");
  }
  const seen = new Set<string>();
  for (const part of toolParts) {
    if (seen.has(part.toolCallId)) throw new Error("COPILOT_TOOL_CALL_ID_DUPLICATE");
    seen.add(part.toolCallId);
    const expected = trustedToolCalls.get(part.toolCallId);
    if (!expected || !sameTrustedToolCall(expected, trustedToolCallFromPart(part))) {
      throw new Error("COPILOT_TOOL_CALL_IDENTITY_CHANGED");
    }
    assertOnlyToolOutputWasAdded(part);
  }
}

function assertOnlyToolOutputWasAdded(part: ToolUIPart | DynamicToolUIPart): void {
  if (part.providerExecuted) throw new Error("COPILOT_PROVIDER_TOOL_CONTINUATION_FORBIDDEN");
  if (part.state === "output-available") {
    boundedCanonicalJson(part.output, MAX_TOOL_OUTPUT_BYTES, "COPILOT_TOOL_OUTPUT_INVALID");
  } else if (part.state === "output-error") {
    if (
      typeof part.errorText !== "string" ||
      !part.errorText.trim() ||
      utf8Length(part.errorText) > MAX_TOOL_ERROR_BYTES
    ) {
      throw new Error("COPILOT_TOOL_ERROR_INVALID");
    }
  } else {
    throw new Error("COPILOT_TOOL_OUTPUT_REQUIRED");
  }
  const unexpectedMutableFields = part as unknown as Record<string, unknown>;
  if (
    unexpectedMutableFields.approval !== undefined ||
    unexpectedMutableFields.preliminary !== undefined ||
    unexpectedMutableFields.rawInput !== undefined ||
    unexpectedMutableFields.resultProviderMetadata !== undefined
  ) {
    throw new Error("COPILOT_TOOL_PART_MUTATED");
  }
}

function sameTrustedToolCall(left: TrustedToolCall, right: TrustedToolCall): boolean {
  return (
    left.partType === right.partType &&
    left.toolName === right.toolName &&
    left.toolCallId === right.toolCallId &&
    left.input === right.input &&
    left.title === right.title &&
    left.providerMetadata === right.providerMetadata
  );
}

function boundedCanonicalJson(value: unknown, maxBytes: number, code: string): string {
  let canonical: string;
  try {
    canonical = canonicalJsonString(value);
  } catch {
    throw new Error(code);
  }
  if (utf8Length(canonical) > maxBytes) throw new Error(code);
  return canonical;
}

function assertIdentifier(value: string, maxLength: number, code: string): void {
  if (
    typeof value !== "string" ||
    !value ||
    value.trim() !== value ||
    value.length > maxLength ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(code);
  }
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
