import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createCanvasCopilotChatTransport,
  type CanvasCopilotChatRequestContext,
} from "./canvas-copilot-chat-transport";
import type { UIMessage } from "ai";

function emptyStreamResponse(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    }),
    { status: 200 }
  );
}

describe("Infinite Canvas copilot transport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads the latest workspace and live graph builders at request time", async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyStreamResponse());
    vi.stubGlobal("fetch", fetchMock);
    let context: CanvasCopilotChatRequestContext = {
      conversationId: "canvas:project-a",
      projectId: "project-a",
      mode: "canvas",
      workspaceId: "workspace-a",
      buildGraphDigest: () => "graph-a",
      buildModelsDigest: () => "models-a",
    };
    const controller = createCanvasCopilotChatTransport(context);
    context = {
      ...context,
      workspaceId: "workspace-b",
      buildGraphDigest: () => "graph-b",
      buildModelsDigest: () => "models-b",
    };
    controller.updateContext(context);

    await controller.transport.sendMessages({
      trigger: "submit-message",
      chatId: context.conversationId,
      messageId: undefined,
      messages: [{ id: "creator-turn-1", role: "user", parts: [{ type: "text", text: "Hello" }] }],
      abortSignal: undefined,
    });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toMatchObject({
      conversationId: "canvas:project-a",
      projectId: "project-a",
      mode: "canvas",
      graphContext: "graph-b",
      modelsContext: "models-b",
      trigger: "submit-message",
      message: {
        id: "creator-turn-1",
        role: "user",
        parts: [{ type: "text", text: "Hello" }],
      },
    });
    expect(JSON.parse(String(request.body))).not.toHaveProperty("messages");
    expect(new Headers(request.headers).get("x-fizz-workspace-id")).toBe("workspace-b");
    expect(new Headers(request.headers).has("x-idempotency-key")).toBe(false);
  });

  it("sends a completed, server-authorized assistant as a tool-result continuation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyStreamResponse());
    vi.stubGlobal("fetch", fetchMock);
    const context = requestContext();
    const controller = createCanvasCopilotChatTransport(context);
    controller.registerServerToolCall({
      toolName: "add_node",
      toolCallId: "tool-call-1",
      input: { kind: "image", position: { x: 120, y: 240 } },
      dynamic: true,
    });
    const assistant = completedAssistant();

    await controller.transport.sendMessages({
      trigger: "submit-message",
      chatId: context.conversationId,
      messageId: assistant.id,
      messages: [userMessage(), assistant],
      abortSignal: undefined,
    });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toMatchObject({
      trigger: "tool-result-continuation",
      message: assistant,
      conversationId: context.conversationId,
      mode: "canvas",
    });
  });

  it("keeps regeneration as a single canonical user input", async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyStreamResponse());
    vi.stubGlobal("fetch", fetchMock);
    const context = requestContext();
    const controller = createCanvasCopilotChatTransport(context);
    const user = userMessage();

    await controller.transport.sendMessages({
      trigger: "regenerate-message",
      chatId: context.conversationId,
      messageId: user.id,
      messages: [user],
      abortSignal: undefined,
    });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({ trigger: "regenerate-message", message: user });
    expect(body).not.toHaveProperty("messages");
  });

  it("ignores the AI SDK trigger when the canonical tail is an authorized assistant retry", async () => {
    const fetchMock = vi.fn().mockResolvedValue(emptyStreamResponse());
    vi.stubGlobal("fetch", fetchMock);
    const context = requestContext();
    const controller = createCanvasCopilotChatTransport(context);
    const assistant = completedAssistant();
    controller.authorizeCanonicalAssistantMessage(assistant);

    await controller.transport.sendMessages({
      trigger: "regenerate-message",
      chatId: context.conversationId,
      messageId: assistant.id,
      messages: [userMessage(), assistant],
      abortSignal: undefined,
    });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toMatchObject({
      trigger: "tool-result-continuation",
      message: assistant,
    });
  });

  it.each([
    {
      label: "unregistered assistant",
      prepare: () => undefined,
      mutate: (message: UIMessage) => message,
      error: "COPILOT_TOOL_CONTINUATION_MISMATCH",
    },
    {
      label: "changed tool input",
      prepare: (controller: ReturnType<typeof createCanvasCopilotChatTransport>) =>
        controller.registerServerToolCall({
          toolName: "add_node",
          toolCallId: "tool-call-1",
          input: { kind: "image", position: { x: 120, y: 240 } },
          dynamic: true,
        }),
      mutate: (message: UIMessage) => ({
        ...message,
        parts: message.parts.map((part) =>
          part.type === "dynamic-tool"
            ? { ...part, input: { kind: "video", position: { x: 120, y: 240 } } }
            : part
        ),
      }),
      error: "COPILOT_TOOL_CALL_IDENTITY_CHANGED",
    },
    {
      label: "changed tool name",
      prepare: (controller: ReturnType<typeof createCanvasCopilotChatTransport>) =>
        controller.registerServerToolCall({
          toolName: "add_node",
          toolCallId: "tool-call-1",
          input: { kind: "image", position: { x: 120, y: 240 } },
          dynamic: true,
        }),
      mutate: (message: UIMessage) => ({
        ...message,
        parts: message.parts.map((part) =>
          part.type === "dynamic-tool" ? { ...part, toolName: "remove_node" } : part
        ),
      }),
      error: "COPILOT_TOOL_CALL_IDENTITY_CHANGED",
    },
    {
      label: "missing tool output",
      prepare: (controller: ReturnType<typeof createCanvasCopilotChatTransport>) =>
        controller.registerServerToolCall({
          toolName: "add_node",
          toolCallId: "tool-call-1",
          input: { kind: "image", position: { x: 120, y: 240 } },
          dynamic: true,
        }),
      mutate: (message: UIMessage) => ({
        ...message,
        parts: message.parts.map((part) =>
          part.type === "dynamic-tool"
            ? {
                type: part.type,
                toolName: part.toolName,
                toolCallId: part.toolCallId,
                state: "input-available" as const,
                input: part.input,
              }
            : part
        ),
      }),
      error: "COPILOT_TOOL_OUTPUT_REQUIRED",
    },
  ])("rejects $label before issuing a request", async ({ prepare, mutate, error }) => {
    const fetchMock = vi.fn().mockResolvedValue(emptyStreamResponse());
    vi.stubGlobal("fetch", fetchMock);
    const context = requestContext();
    const controller = createCanvasCopilotChatTransport(context);
    prepare(controller);
    const assistant = mutate(completedAssistant());

    await expect(
      controller.transport.sendMessages({
        trigger: "submit-message",
        chatId: context.conversationId,
        messageId: assistant.id,
        messages: [userMessage(), assistant],
        abortSignal: undefined,
      })
    ).rejects.toThrow(error);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function requestContext(): CanvasCopilotChatRequestContext {
  return {
    conversationId: "canvas:project-a",
    projectId: "project-a",
    mode: "canvas",
    workspaceId: "workspace-a",
    buildGraphDigest: () => "graph-a",
    buildModelsDigest: () => "models-a",
  };
}

function userMessage(): UIMessage {
  return {
    id: "creator-turn-1",
    role: "user",
    parts: [{ type: "text", text: "Add an image node" }],
  };
}

function completedAssistant(): UIMessage {
  return {
    id: "assistant-turn-1",
    role: "assistant",
    parts: [
      { type: "step-start" },
      {
        type: "dynamic-tool",
        toolName: "add_node",
        toolCallId: "tool-call-1",
        state: "output-available",
        input: { position: { y: 240, x: 120 }, kind: "image" },
        output: { ok: true, nodeId: "node-a" },
      },
    ],
  };
}
