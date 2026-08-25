// @vitest-environment jsdom

import type { ChangeEvent, ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { UIMessage } from "ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotPanel } from "./copilot-panel";

interface MockChatOptions {
  onFinish?: (result: { isAbort: boolean; isError: boolean }) => void;
  sendAutomaticallyWhen?: (args: { messages: UIMessage[] }) => boolean | PromiseLike<boolean>;
  onToolCall?: (args: {
    toolCall: {
      toolName: string;
      toolCallId: string;
      input: unknown;
      dynamic?: boolean;
    };
  }) => Promise<void>;
}

const chatMock = vi.hoisted(() => ({
  options: null as MockChatOptions | null,
  messages: [] as UIMessage[],
  status: "ready" as "ready" | "submitted" | "streaming" | "error",
  error: undefined as Error | undefined,
  sendMessage: vi.fn<(message?: UIMessage) => Promise<void>>(),
  setMessages: vi.fn<(messages: UIMessage[]) => void>(),
  stop: vi.fn<() => Promise<void>>(),
  regenerate: vi.fn<() => Promise<void>>(),
  clearError: vi.fn<() => void>(),
  addToolOutput: vi.fn(),
  runTool: vi.fn<(name: string, input: unknown) => Promise<unknown>>(),
  updateContext: vi.fn(),
  registerServerToolCall: vi.fn(),
  authorizeCanonicalAssistantMessage: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: (options: MockChatOptions) => {
    chatMock.options = options;
    return {
      messages: chatMock.messages,
      status: chatMock.status,
      error: chatMock.error,
      sendMessage: chatMock.sendMessage,
      setMessages: chatMock.setMessages,
      stop: chatMock.stop,
      regenerate: chatMock.regenerate,
      clearError: chatMock.clearError,
      addToolOutput: chatMock.addToolOutput,
    };
  },
}));

vi.mock("@/app/_components/auth-provider", () => ({
  useAuth: () => ({ user: { id: "user-a" }, loading: false }),
}));

const TEST_WORKSPACE = {
  id: "019f7243-20c1-7054-a6fa-0a33da6efef1",
  type: "personal",
  role: "owner",
} as const;

// Only the hooks are stubbed: `payerWorkspace` stays real so this mock cannot
// drift from the rule the panel actually bills by.
vi.mock("@/app/_components/workspace-context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/_components/workspace-context")>()),
  useActiveWorkspaceId: () => TEST_WORKSPACE.id,
  useWorkspace: () => ({
    workspaces: [TEST_WORKSPACE],
    activeWorkspace: TEST_WORKSPACE,
  }),
}));

vi.mock("./canvas-copilot-chat-transport", () => ({
  createCanvasCopilotChatTransport: () => ({
    transport: {},
    updateContext: chatMock.updateContext,
    registerServerToolCall: chatMock.registerServerToolCall,
    authorizeCanonicalAssistantMessage: chatMock.authorizeCanonicalAssistantMessage,
  }),
}));

vi.mock("./use-copilot-tools", () => ({
  CONFIRM_TOOLS: new Set(["run_generation", "remove_node", "remove_edge"]),
  useCopilotTools: () => ({
    runTool: chatMock.runTool,
    buildGraphDigest: () => ({}),
    buildModelsDigest: () => ({}),
  }),
}));

vi.mock("@/components/copilot/copilot-side-panel", () => ({
  CopilotSidePanel: ({ children, footer }: { children: ReactNode; footer: ReactNode }) => (
    <div>
      <div>{children}</div>
      <div>{footer}</div>
    </div>
  ),
}));

vi.mock("@/components/copilot/copilot-transcript", () => ({
  CopilotTranscript: () => <div data-transcript />,
}));

vi.mock("@/components/copilot/copilot-status-notice", () => ({
  CopilotStatusNotice: ({
    message,
    actionLabel,
    onAction,
  }: {
    message: string;
    actionLabel?: string;
    onAction?: () => void;
  }) => (
    <div data-status-message={message}>
      {message}
      {actionLabel && onAction ? (
        <button type="button" data-status-action={actionLabel} onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock("@/components/copilot/copilot-composer", () => ({
  CopilotComposer: ({
    value,
    onChange,
    onSubmit,
    onStop,
    sendDisabled,
  }: {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onStop: () => void;
    sendDisabled?: boolean;
  }) => (
    <div>
      <input
        data-composer-input
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value)}
      />
      <button type="button" data-composer-send disabled={sendDisabled} onClick={onSubmit}>
        send
      </button>
      <button type="button" data-composer-stop onClick={onStop}>
        stop
      </button>
    </div>
  ),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogClose: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DialogTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function historyResponse({
  status = "ready",
  messages = [],
  revision = messages.length === 0 ? 0 : 1,
}: {
  status?: "ready" | "failed" | "aborted" | "limit_exceeded";
  messages?: UIMessage[];
  revision?: number;
} = {}) {
  return Response.json({
    conversationId: "canvas:019f7243-20c1-7054-a6fa-0a33da6efef2",
    messages,
    revision,
    sessionId: messages.length === 0 ? null : "019f7243-20c1-7054-a6fa-0a33da6efef5",
    status,
    resetAvailable: true,
  });
}

describe("Infinite Canvas Copilot panel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    window.sessionStorage.clear();
    chatMock.options = null;
    chatMock.messages = [];
    chatMock.status = "ready";
    chatMock.error = undefined;
    chatMock.sendMessage.mockReset().mockResolvedValue(undefined);
    chatMock.setMessages.mockReset();
    chatMock.stop.mockReset().mockResolvedValue(undefined);
    chatMock.regenerate.mockReset().mockResolvedValue(undefined);
    chatMock.clearError.mockReset();
    chatMock.addToolOutput.mockReset();
    chatMock.runTool.mockReset().mockResolvedValue({ ok: true });
    chatMock.updateContext.mockReset();
    chatMock.registerServerToolCall.mockReset();
    chatMock.authorizeCanonicalAssistantMessage.mockReset();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function renderPanel() {
    await act(async () => {
      root.render(
        <CopilotPanel
          projectId="019f7243-20c1-7054-a6fa-0a33da6efef2"
          open
          onClose={() => undefined}
        />
      );
      for (let index = 0; index < 5; index += 1) await Promise.resolve();
    });
  }

  it("fails closed and keeps the exact input when pending-turn storage cannot be written", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(historyResponse()))
    );
    await renderPanel();
    const input = container.querySelector("[data-composer-input]") as HTMLInputElement;
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(input, "Do not lose this exact instruction");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const storageFailure = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage unavailable", "QuotaExceededError");
    });

    await act(async () => {
      (container.querySelector("[data-composer-send]") as HTMLButtonElement).click();
      await Promise.resolve();
    });

    expect(chatMock.sendMessage).not.toHaveBeenCalled();
    expect((container.querySelector("[data-composer-input]") as HTMLInputElement).value).toBe(
      "Do not lose this exact instruction"
    );
    expect(container.querySelector('[data-status-message="recoveryStorageError"]')).not.toBeNull();
    storageFailure.mockRestore();
  });

  it("turns Cancel into an explicit declined tool output so the loop can continue", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(historyResponse()))
    );
    await renderPanel();
    let toolPromise!: Promise<void>;
    act(() => {
      toolPromise = chatMock.options!.onToolCall!({
        toolCall: {
          toolName: "run_generation",
          toolCallId: "tool-call-1",
          input: { nodeId: "node-a" },
        },
      });
    });
    await act(async () => Promise.resolve());
    expect(container.textContent).toContain("confirmRun");

    await act(async () => {
      const cancel = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "cancel"
      );
      cancel?.click();
      await toolPromise;
    });

    expect(chatMock.registerServerToolCall).toHaveBeenCalledWith({
      toolName: "run_generation",
      toolCallId: "tool-call-1",
      input: { nodeId: "node-a" },
    });
    expect(chatMock.runTool).not.toHaveBeenCalled();
    expect(chatMock.addToolOutput).toHaveBeenCalledWith({
      tool: "run_generation",
      toolCallId: "tool-call-1",
      output: { ok: false, declined: true },
    });
    expect(chatMock.stop).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("confirmRun");
  });

  it("keeps sending locked after Stop leaves a canonical unresolved tool and offers recovery", async () => {
    const user = userMessage();
    const assistant = unresolvedToolAssistant();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(historyResponse())
      .mockResolvedValueOnce(historyResponse({ messages: [user, assistant] }))
      .mockResolvedValueOnce(historyResponse({ messages: [user, assistant] }));
    vi.stubGlobal("fetch", fetchMock);
    await renderPanel();
    let toolPromise!: Promise<void>;
    act(() => {
      toolPromise = chatMock.options!.onToolCall!({
        toolCall: {
          toolName: "run_generation",
          toolCallId: "tool-call-1",
          input: { nodeId: "node-a" },
        },
      });
    });
    await act(async () => Promise.resolve());

    await act(async () => {
      (container.querySelector("[data-composer-stop]") as HTMLButtonElement).click();
      await toolPromise;
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });

    expect(chatMock.stop).toHaveBeenCalledTimes(1);
    expect(chatMock.runTool).not.toHaveBeenCalled();
    expect(chatMock.addToolOutput).not.toHaveBeenCalled();
    expect(
      container.querySelector('[data-status-message="continuationRecoveryRequired"]')
    ).not.toBeNull();
    expect((container.querySelector("[data-composer-send]") as HTMLButtonElement).disabled).toBe(
      true
    );

    await act(async () => {
      (
        container.querySelector('[data-status-action="continueInterrupted"]') as HTMLButtonElement
      ).click();
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });

    expect(chatMock.authorizeCanonicalAssistantMessage).toHaveBeenCalledWith(assistant);
    expect(chatMock.addToolOutput).toHaveBeenCalledWith({
      tool: "run_generation",
      toolCallId: "tool-call-1",
      output: { ok: false, skipped: true, interrupted: true },
    });
    expect(chatMock.sendMessage).not.toHaveBeenCalled();
  });

  it("offers canonical regeneration for a failed turn even without an AI SDK error", async () => {
    const user: UIMessage = {
      id: "failed-user",
      role: "user",
      parts: [{ type: "text", text: "Try this" }],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(historyResponse({ status: "failed", messages: [user] }))
      .mockResolvedValueOnce(historyResponse({ status: "failed", messages: [user] }))
      .mockResolvedValueOnce(
        historyResponse({
          messages: [
            user,
            {
              id: "retried-assistant",
              role: "assistant",
              parts: [{ type: "text", text: "Recovered" }],
            },
          ],
          revision: 2,
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    await renderPanel();

    expect(container.querySelector('[data-status-message="responseFailed"]')).not.toBeNull();
    await act(async () => {
      (container.querySelector('[data-status-action="retry"]') as HTMLButtonElement).click();
      for (let index = 0; index < 5; index += 1) await Promise.resolve();
    });

    expect(chatMock.regenerate).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("auto-continues only after every last-step client tool call has an output", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(historyResponse()))
    );
    await renderPanel();
    const predicate = chatMock.options?.sendAutomaticallyWhen;
    expect(predicate).toBeTypeOf("function");
    const incomplete: UIMessage = {
      id: "assistant-turn-1",
      role: "assistant",
      parts: [
        { type: "step-start" },
        {
          type: "dynamic-tool",
          toolName: "add_node",
          toolCallId: "tool-call-1",
          state: "output-available",
          input: { kind: "image" },
          output: { ok: true },
        },
        {
          type: "dynamic-tool",
          toolName: "connect_nodes",
          toolCallId: "tool-call-2",
          state: "input-available",
          input: { sourceId: "node-a", targetId: "node-b" },
        },
      ],
    };
    const complete: UIMessage = {
      id: "assistant-turn-1",
      role: "assistant",
      parts: [
        { type: "step-start" },
        {
          type: "dynamic-tool",
          toolName: "add_node",
          toolCallId: "tool-call-1",
          state: "output-available",
          input: { kind: "image" },
          output: { ok: true },
        },
        {
          type: "dynamic-tool",
          toolName: "connect_nodes",
          toolCallId: "tool-call-2",
          state: "output-available",
          input: { sourceId: "node-a", targetId: "node-b" },
          output: { ok: true },
        },
      ],
    };

    expect(await predicate?.({ messages: [incomplete] })).toBe(false);
    expect(await predicate?.({ messages: [complete] })).toBe(true);
    expect(await predicate?.({ messages: [complete, { ...userMessage(), id: "next-user" }] })).toBe(
      false
    );
  });

  it("renders a localized quota notice for a post-claim 429 and refreshes for the Retry affordance", async () => {
    const user = userMessage();
    const rawBody = JSON.stringify({
      code: 429,
      error: "quota_exceeded",
      dimension: "chat",
      used: 30,
      limit: 30,
      resetAt: "2026-07-19T15:00:00.000Z",
    });
    chatMock.error = new Error(rawBody);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(historyResponse())
      .mockResolvedValue(historyResponse({ status: "failed", messages: [user] }));
    vi.stubGlobal("fetch", fetchMock);
    await renderPanel();
    await act(async () => {
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-status-message="quotaExceeded"]')).not.toBeNull();
    expect(container.querySelector('[data-status-action="retry"]')).not.toBeNull();
    expect(container.textContent).not.toContain(rawBody);
  });

  it("renders a localized rate-limit notice without touching the canonical conversation", async () => {
    const rawBody = JSON.stringify({
      code: 429,
      error: "rate_limited",
      dimension: "chat",
      limit: 20,
      resetAt: "2026-07-19T15:00:00.000Z",
    });
    chatMock.error = new Error(rawBody);
    const fetchMock = vi.fn(() => Promise.resolve(historyResponse()));
    vi.stubGlobal("fetch", fetchMock);
    await renderPanel();
    await act(async () => {
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-status-message="rateLimited"]')).not.toBeNull();
    expect(container.querySelector('[data-status-action="retry"]')).toBeNull();
    expect(container.textContent).not.toContain(rawBody);
  });

  it("retries an assistant-tail continuation without regenerating the user turn", async () => {
    const user = userMessage();
    const assistant = completedToolAssistant();
    const completedAssistant: UIMessage = {
      ...assistant,
      parts: [...assistant.parts, { type: "step-start" }, { type: "text", text: "Done" }],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(historyResponse({ status: "failed", messages: [user, assistant] }))
      .mockResolvedValueOnce(historyResponse({ status: "failed", messages: [user, assistant] }))
      .mockResolvedValueOnce(
        historyResponse({ messages: [user, completedAssistant], revision: 2 })
      );
    vi.stubGlobal("fetch", fetchMock);
    await renderPanel();

    await act(async () => {
      (container.querySelector('[data-status-action="retry"]') as HTMLButtonElement).click();
      for (let index = 0; index < 5; index += 1) await Promise.resolve();
    });

    expect(chatMock.authorizeCanonicalAssistantMessage).toHaveBeenCalledWith(assistant);
    expect(chatMock.sendMessage).toHaveBeenCalledWith();
    expect(chatMock.regenerate).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

function userMessage(): UIMessage {
  return {
    id: "failed-user",
    role: "user",
    parts: [{ type: "text", text: "Try this" }],
  };
}

function completedToolAssistant(): UIMessage {
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
        input: { kind: "image" },
        output: { ok: true },
      },
    ],
  };
}

function unresolvedToolAssistant(): UIMessage {
  return {
    id: "assistant-turn-1",
    role: "assistant",
    parts: [
      { type: "step-start" },
      {
        type: "dynamic-tool",
        toolName: "run_generation",
        toolCallId: "tool-call-1",
        state: "input-available",
        input: { nodeId: "node-a" },
      },
    ],
  };
}
