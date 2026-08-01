// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import messages from "@/messages/en-US.json";
import type { StudioAgentUIMessage } from "@/lib/studio-agent";

import { StoryCanvasAssistantLayer } from "./story-canvas-assistant-layer";

const THREAD_ID = "00000000-0000-4000-8000-000000000001";
const RUN_ID = "00000000-0000-4000-8000-000000000002";
const INVOCATION_ID = "00000000-0000-4000-8000-000000000003";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000004";
const TOOL_CALL_ID = "tool-call-1";

/**
 * The delivery layer, reduced to the two facts this regression turns on.
 *
 * 1. `ChatTransportProvider` rebuilds its ChatTransport whenever `chatOptions`
 *    changes identity — its own documented contract.
 * 2. `useChat` builds its `Chat` once per id and `AbstractChat` assigns
 *    `readonly transport` in the constructor, so the FIRST transport is the one
 *    every send in the panel session goes through.
 *
 * Both halves are real here: `@ai-sdk/react` is NOT mocked, so the capture is
 * the SDK's own. Only the wire underneath it is a stub.
 */
const harness = vi.hoisted(() => {
  const channelListeners = new Set<() => void>();
  let channelMessages: unknown[] = [];

  const createTransport = (chatOptions: {
    prepareSendMessagesRequest: (context: Record<string, unknown>) => unknown;
  }) => {
    const sent: unknown[] = [];
    return {
      chatOptions,
      sent,
      async sendMessages(options: {
        chatId: string;
        trigger: string;
        messageId?: string;
        messages: { role: string }[];
      }) {
        // The adapter's own history/messages split: a `submit-message` whose
        // last message is an already-tracked assistant is a continuation, so
        // nothing is new and the whole array is history.
        const last = options.messages.at(-1);
        const isContinuation = options.trigger === "submit-message" && last?.role === "assistant";
        sent.push(
          chatOptions.prepareSendMessagesRequest({
            chatId: options.chatId,
            trigger: options.trigger,
            messageId: options.messageId,
            history: isContinuation ? options.messages : options.messages.slice(0, -1),
            messages: isContinuation || !last ? [] : [last],
          })
        );
        // The agent picks the turn back up and produces the tool's output.
        return new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: "tool-output-available",
              toolCallId: TOOL_CALL_ID,
              output: { removed: true },
            });
            controller.close();
          },
        });
      },
      async reconnectToStream() {
        return null;
      },
    };
  };

  return {
    useStoryStudioAgentBootstrap: vi.fn(),
    transports: [] as ReturnType<typeof createTransport>[],
    createTransport,
    session: {
      view: {
        send: vi.fn(),
        runs: () => [],
        runOf: () => undefined,
        getMessages: () => [],
        on: () => () => undefined,
      },
      cancel: vi.fn().mockResolvedValue(undefined),
      on: () => () => undefined,
    },
    channel: {
      read: () => channelMessages,
      subscribe: (onChange: () => void) => {
        channelListeners.add(onChange);
        return () => {
          channelListeners.delete(onChange);
        };
      },
      deliver: (next: unknown[]) => {
        channelMessages = next;
        for (const listener of channelListeners) listener();
      },
      reset: () => {
        channelMessages = [];
        channelListeners.clear();
      },
    },
  };
});

vi.mock("ably/react", () => ({
  AblyProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@ably/ai-transport/vercel/react", async () => {
  const React = await import("react");
  const TransportContext = React.createContext<ReturnType<typeof harness.createTransport> | null>(
    null
  );

  return {
    ChatTransportProvider: ({
      chatOptions,
      children,
    }: {
      chatOptions: Parameters<typeof harness.createTransport>[0];
      children: ReactNode;
    }) => {
      const transport = React.useMemo(() => {
        const built = harness.createTransport(chatOptions);
        harness.transports.push(built);
        return built;
      }, [chatOptions]);
      return React.createElement(TransportContext.Provider, { value: transport }, children);
    },
    useChatTransport: () => ({
      session: harness.session,
      chatTransport: React.useContext(TransportContext),
      sessionError: undefined,
      chatTransportError: undefined,
    }),
    useMessageSync: ({
      setMessages,
      messages: seed,
    }: {
      setMessages: (next: unknown[]) => void;
      messages: unknown[];
    }) => {
      const delivered = React.useSyncExternalStore(
        harness.channel.subscribe,
        harness.channel.read,
        harness.channel.read
      );
      React.useEffect(() => {
        setMessages([...seed, ...delivered]);
      }, [delivered, seed, setMessages]);
    },
  };
});

vi.mock("./use-story-studio-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./use-story-studio-agent")>();
  return { ...actual, useStoryStudioAgentBootstrap: harness.useStoryStudioAgentBootstrap };
});

describe("StoryOS approval continuation", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    harness.transports.length = 0;
    harness.channel.reset();
    setBootstrap([]);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
  });

  /**
   * THE APPROVAL A PANEL SESSION RAISES ITSELF.
   *
   * The panel opens on an idle conversation, so the transport `useChat`
   * captures closes over zero invocations. Everything the creator can then
   * approve is created after that moment — which is every approval that is not
   * recovered from a page reload. Reading the invocations out of the render
   * scope froze that lookup, so the continuation threw before the response ever
   * reached the wire and the run hung in `waiting_for_approval`.
   */
  it("sends an approval for an invocation created after the transport was captured", async () => {
    await render();
    expect(harness.transports).toHaveLength(1);

    // The turn suspends: the assistant message arrives on the channel, and the
    // durable invocation behind it lands on the next status poll.
    await act(async () => harness.channel.deliver([approvalRequest()]));
    setBootstrap([waitingInvocation()]);
    await render();

    const approve = approveButton();
    expect(approve).toBeDefined();
    expect(approve?.hasAttribute("disabled")).toBe(false);
    await act(async () => approve?.click());
    await flush();

    // The transport captured at mount is the one that sent it, and it resolved
    // the invocation that only existed afterwards.
    expect(harness.transports[0]?.sent).toEqual([
      {
        body: {
          schemaVersion: "agent-invocation-gateway/v1",
          conversationId: THREAD_ID,
          clientMessageId: expect.any(String),
          continuationOfInvocationId: INVOCATION_ID,
          locale: "en-US",
        },
        headers: {
          "x-fizz-workspace-id": WORKSPACE_ID,
          "accept-language": "en-US",
        },
      },
    ]);
    // No second transport was ever needed: the options object stays stable, so
    // the live stream is never dropped to pick up a new invocation list.
    expect(harness.transports).toHaveLength(1);
  });

  function approveButton() {
    return [
      ...container.querySelectorAll<HTMLButtonElement>(
        '[data-slot="studio-agent-tool-approval"] button'
      ),
    ].find((node) => node.textContent === "Approve");
  }

  async function render() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <NextIntlClientProvider locale="en-US" messages={messages}>
            <StoryCanvasAssistantLayer
              projectId="project-1"
              chapterId="chapter-1"
              workspaceId={WORKSPACE_ID}
              open
              onOpenChange={() => undefined}
            >
              <main data-testid="story-canvas" />
            </StoryCanvasAssistantLayer>
          </NextIntlClientProvider>
        </QueryClientProvider>
      );
    });
    await flush();
  }
});

async function flush() {
  for (let index = 0; index < 6; index += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function setBootstrap(invocations: unknown[]) {
  harness.useStoryStudioAgentBootstrap.mockReturnValue({
    projectId: "project-1",
    chapterId: "chapter-1",
    workspaceId: WORKSPACE_ID,
    locale: "en-US",
    status: "ready",
    error: null,
    thread: { threadId: THREAD_ID, permissionPolicy: { mode: "ask" } },
    history: {
      messages: [],
      messageIds: new Set<string>(),
      nextCursor: null,
      runs: [],
      activities: [],
      writeToken: "",
      writtenNodeIds: [],
    },
    invocations,
    conversationKey: THREAD_ID,
    realtime: {
      client: { id: "ably-client" },
      channelName: `agent:v1:conversation:${THREAD_ID}`,
      status: "connected",
      error: null,
    },
    hasEarlierTurns: false,
    loadingEarlierTurns: false,
    policyUpdating: false,
    commandError: null,
    clearCommandError: vi.fn(),
    reportCommandError: vi.fn(),
    retry: vi.fn(),
    loadEarlierTurns: vi.fn().mockResolvedValue(undefined),
    refreshHistory: vi.fn(),
    refreshInvocations: vi.fn(),
    invoke: vi.fn(),
    requestDurableCancel: vi.fn().mockResolvedValue(null),
    startNewConversation: vi.fn().mockResolvedValue(undefined),
    uploadAttachment: vi.fn(),
    updatePermissionMode: vi.fn().mockResolvedValue(undefined),
  });
}

/** The suspended tool call, exactly as the channel carries it. */
function approvalRequest(): StudioAgentUIMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    metadata: {
      conversationId: THREAD_ID,
      runId: RUN_ID,
      createdAt: "2026-07-30T12:00:02.000Z",
    },
    parts: [
      {
        type: "dynamic-tool",
        toolName: "cap_story_canvas_delete_scene_abcabcabcabc",
        toolCallId: TOOL_CALL_ID,
        state: "approval-requested",
        input: { sceneId: "scene-1" },
        approval: { id: "approval-1" },
      },
    ],
  };
}

function waitingInvocation() {
  return {
    invocationId: INVOCATION_ID,
    runId: RUN_ID,
    clientMessageId: "creator-message-1",
    inputEventId: "ably-event-1",
    status: "waiting_for_approval",
    error: null,
    latestAttempt: {
      attemptId: "00000000-0000-4000-8000-000000000005",
      ordinal: 0,
      inputEventId: "ably-event-1",
      clientMessageId: "creator-message-1",
      status: "dispatched",
      error: null,
    },
    createdAt: "2026-07-30T12:00:00.000Z",
    startedAt: "2026-07-30T12:00:01.000Z",
    completedAt: null,
  };
}
