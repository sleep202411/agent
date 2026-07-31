// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentAttachmentSummary, AgentInvocationStatus } from "@repo/shared/agent-platform";

import {
  EMPTY_STUDIO_AGENT_DOCUMENT_ANALYSIS,
  type StudioAgentUIMessage,
} from "@/lib/studio-agent";

import type { StoryStudioAgentBootstrap, StoryStudioAgentSession } from "./use-story-studio-agent";
import {
  mergeInvocationStatuses,
  useStoryStudioAgentBootstrap,
  useStoryStudioAgentSession,
} from "./use-story-studio-agent";

const runtime = vi.hoisted(() => {
  const api = {
    resolveStoryConversation: vi.fn(),
    createStoryConversation: vi.fn(),
    authorizeConversation: vi.fn(),
    updatePermissionMode: vi.fn(),
    invoke: vi.fn(),
    invocationStatus: vi.fn(),
    cancel: vi.fn(),
    history: vi.fn(),
    registerAttachment: vi.fn(),
    revokeAttachment: vi.fn(),
    attachmentStatus: vi.fn(),
  };
  const view = {
    send: vi.fn(),
    runs: vi.fn(() => [] as unknown[]),
    run: vi.fn(),
    runOf: vi.fn(),
    getMessages: vi.fn(() => [] as unknown[]),
    on: vi.fn(() => () => undefined),
  };
  const session = {
    view,
    cancel: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(() => () => undefined),
  };
  const chat = {
    messages: [] as unknown[],
    setMessages: vi.fn(),
    sendMessage: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
    addToolApprovalResponse: vi.fn().mockResolvedValue(undefined),
    clearError: vi.fn(),
    status: "ready" as string,
    error: undefined as Error | undefined,
  };
  return {
    api,
    view,
    session,
    chat,
    chatTransport: {},
    realtimeInput: { current: null as Record<string, unknown> | null },
    uploadFileViaSignedUrl: vi.fn(),
    ApiClient: vi.fn(function MockAgentPlatformApiClient() {
      return api;
    }),
  };
});

vi.mock("@/lib/media-upload", () => ({
  uploadFileViaSignedUrl: runtime.uploadFileViaSignedUrl,
}));

vi.mock("@/lib/studio-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/studio-agent")>();
  return {
    ...actual,
    AgentPlatformApiClient: runtime.ApiClient,
    useStudioAgentRealtime: (input: Record<string, unknown>) => {
      runtime.realtimeInput.current = input;
      return {
        client: null,
        channelName: SESSION_NAME,
        status: "connected" as const,
        error: null,
      };
    },
  };
});

vi.mock("@ably/ai-transport/vercel/react", () => ({
  useChatTransport: () => ({
    session: runtime.session,
    chatTransport: runtime.chatTransport,
    sessionError: undefined,
    chatTransportError: undefined,
  }),
  useMessageSync: vi.fn(),
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: () => runtime.chat,
}));

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_ID = "00000000-0000-4000-8000-000000000002";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000003";
const NEW_CONVERSATION_ID = "00000000-0000-4000-8000-000000000004";
const RUN_ID = "00000000-0000-4000-8000-000000000005";
const INVOCATION_ID = "00000000-0000-4000-8000-000000000006";
const QUEUED_RUN_ID = "00000000-0000-4000-8000-000000000031";
const QUEUED_INVOCATION_ID = "00000000-0000-4000-8000-000000000032";
const MEDIA_ASSET_ID = "00000000-0000-4000-8000-000000000008";
const ATTACHMENT_ID = "00000000-0000-4000-8000-000000000009";
const ANALYSIS_JOB_ID = "00000000-0000-4000-8000-000000000010";
const SESSION_NAME = `agent:v1:conversation:${CONVERSATION_ID}`;

describe("useStoryStudioAgentBootstrap", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let bootstrap: StoryStudioAgentBootstrap | null;

  beforeEach(() => {
    ({ container, root, queryClient } = createHarness());
    bootstrap = null;
    resetRuntime();
  });

  afterEach(async () => {
    await destroyHarness(root, container, queryClient);
  });

  it("resolves a project-scoped product conversation and seeds durable Mastra history", async () => {
    await renderBootstrap();
    await waitFor(() => bootstrap?.status === "ready");

    expect(runtime.ApiClient).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      locale: "zh-CN",
    });
    expect(runtime.api.resolveStoryConversation).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.any(AbortSignal)
    );
    expect(runtime.api.history).toHaveBeenCalledWith(
      CONVERSATION_ID,
      expect.objectContaining({ limit: 50, signal: expect.any(AbortSignal) })
    );
    expect(bootstrap?.history.messages.map((message) => message.id)).toEqual(["durable-message-1"]);
    expect(bootstrap?.thread).toEqual({
      threadId: CONVERSATION_ID,
      permissionPolicy: { mode: "smart" },
    });
    expect(runtime.realtimeInput.current).toMatchObject({
      threadId: CONVERSATION_ID,
      enabled: true,
      initialGrant: grant(),
    });
  });

  it("retries the complete resolve-and-history boundary after a failed bootstrap", async () => {
    runtime.api.resolveStoryConversation
      .mockRejectedValueOnce(new Error("Product gateway unavailable"))
      .mockResolvedValueOnce(grant());

    await renderBootstrap();
    await waitFor(() => bootstrap?.status === "error");
    const failedKey = bootstrap!.conversationKey;

    await act(async () => bootstrap!.retry());
    await waitFor(() => bootstrap?.status === "ready");

    expect(runtime.api.resolveStoryConversation).toHaveBeenCalledTimes(2);
    expect(bootstrap?.conversationKey).not.toBe(failedKey);
  });

  it("returns a conversation-bound attachment lease whose abandon operation is idempotent", async () => {
    await renderBootstrap();
    await waitFor(() => bootstrap?.status === "ready");
    const controller = new AbortController();
    const file = new File(["image"], "reference.webp", { type: "image/webp" });

    const lease = await act(() =>
      bootstrap!.uploadAttachment(file, {
        signal: controller.signal,
        onProgress: vi.fn(),
      })
    );

    expect(runtime.uploadFileViaSignedUrl).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        kind: "agent_attachment_image",
        workspaceId: WORKSPACE_ID,
      })
    );
    expect(runtime.api.registerAttachment).toHaveBeenCalledWith(
      CONVERSATION_ID,
      MEDIA_ASSET_ID,
      "reference.webp",
      controller.signal
    );
    await lease.abandon();
    await lease.abandon();
    expect(runtime.api.revokeAttachment).toHaveBeenCalledTimes(1);
    expect(runtime.api.revokeAttachment).toHaveBeenCalledWith(CONVERSATION_ID, ATTACHMENT_ID);
  });

  // A document turns "ready" the moment its text is extracted, and the analysis
  // that reads it then runs for minutes with no realtime event of its own. The
  // bootstrap is where it is tracked because the job starts before the prompt
  // is sent and outlives the turn that carries it.
  it("reconciles the analysis running behind an uploaded document", async () => {
    runtime.api.registerAttachment.mockResolvedValue(registeredDocument());
    runtime.api.attachmentStatus.mockResolvedValue(
      registeredDocument({
        analysis: {
          jobId: ANALYSIS_JOB_ID,
          status: "running",
          stage: "mapping",
          completedUnits: 6,
          totalUnits: 46,
          progress: 13,
          finalArtifactId: null,
          error: null,
        },
      })
    );
    await renderBootstrap();
    await waitFor(() => bootstrap?.status === "ready");

    await act(() =>
      bootstrap!.uploadAttachment(
        new File(["screenplay"], "screenplay-test.docx", {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }),
        { signal: new AbortController().signal, onProgress: vi.fn() }
      )
    );
    await waitFor(() => bootstrap?.documentAnalysis.size === 1);

    expect(runtime.api.attachmentStatus).toHaveBeenCalledWith(
      CONVERSATION_ID,
      ATTACHMENT_ID,
      expect.any(AbortSignal)
    );
    expect(bootstrap?.documentAnalysis.get(ATTACHMENT_ID)).toMatchObject({
      phase: "mapping",
      progress: 13,
      completedUnits: 6,
      totalUnits: 46,
      settled: false,
    });
  });

  it("loads older durable pages without replacing the live tail", async () => {
    runtime.api.history
      .mockResolvedValueOnce(
        historyPage([textMessage("message-2", "assistant", "Newest")], "older-cursor")
      )
      .mockResolvedValueOnce(historyPage([textMessage("message-1", "user", "Oldest")], null));

    await renderBootstrap();
    await waitFor(() => bootstrap?.status === "ready");
    await act(async () => bootstrap!.loadEarlierTurns());

    expect(bootstrap?.history.messages.map((message) => message.id)).toEqual([
      "message-1",
      "message-2",
    ]);
    expect(bootstrap?.hasEarlierTurns).toBe(false);
    expect(runtime.api.history).toHaveBeenLastCalledWith(
      CONVERSATION_ID,
      expect.objectContaining({ cursor: "older-cursor", limit: 50 })
    );
  });

  it("creates a new product conversation atomically and preserves the selected permission mode", async () => {
    runtime.api.createStoryConversation.mockResolvedValue(
      grant({ conversationId: NEW_CONVERSATION_ID, permissionMode: "full" })
    );
    runtime.api.resolveStoryConversation.mockResolvedValue(grant({ permissionMode: "full" }));

    await renderBootstrap();
    await waitFor(() => bootstrap?.status === "ready");
    await act(async () => bootstrap!.startNewConversation());

    expect(runtime.api.createStoryConversation).toHaveBeenCalledWith(PROJECT_ID, "full");
    expect(bootstrap?.thread?.threadId).toBe(NEW_CONVERSATION_ID);
    expect(bootstrap?.history.messages).toEqual([]);
  });

  it("leaves no trace of the previous conversation's durable lifecycle", async () => {
    runtime.api.invocationStatus.mockResolvedValue({
      schemaVersion: "agent-invocation-status-page/v1",
      revision: "4210",
      hasMore: false,
      invocations: [
        invocationStatus({
          invocationId: INVOCATION_ID,
          runId: RUN_ID,
          status: "failed",
          createdAt: "2026-07-30T10:00:00.000Z",
        }),
      ],
    });

    await renderBootstrap();
    await waitFor(() => bootstrap?.status === "ready");
    expect(bootstrap?.invocations).toHaveLength(1);

    await act(async () => bootstrap!.startNewConversation());

    // Otherwise the brand-new thread renders the old one's runs and pins its
    // failure card above a composer with nothing behind it.
    expect(bootstrap?.invocations).toEqual([]);

    // The cursor is a table-wide sequence, so replaying it against a
    // conversation whose newest revision is 0 is a 400 the poll swallows.
    await act(async () => {
      bootstrap!.refreshInvocations();
      await settle();
    });
    expect(runtime.api.invocationStatus).toHaveBeenLastCalledWith(
      NEW_CONVERSATION_ID,
      expect.objectContaining({ sinceRevision: undefined })
    );
  });

  it("drains monotonic invocation deltas and never replaces unrelated active runs", async () => {
    const first = invocationStatus({
      invocationId: INVOCATION_ID,
      runId: RUN_ID,
      status: "running",
      createdAt: "2026-07-30T10:00:00.000Z",
    });
    const second = invocationStatus({
      invocationId: "00000000-0000-4000-8000-000000000016",
      runId: "00000000-0000-4000-8000-000000000017",
      status: "queued",
      createdAt: "2026-07-30T10:00:01.000Z",
    });
    runtime.api.invocationStatus
      .mockResolvedValueOnce({
        schemaVersion: "agent-invocation-status-page/v1",
        revision: "5",
        hasMore: false,
        invocations: [first],
      })
      .mockResolvedValueOnce({
        schemaVersion: "agent-invocation-status-page/v1",
        revision: "6",
        hasMore: true,
        invocations: [{ ...first, status: "succeeded", completedAt: "2026-07-30T10:00:02.000Z" }],
      })
      .mockResolvedValueOnce({
        schemaVersion: "agent-invocation-status-page/v1",
        revision: "7",
        hasMore: false,
        invocations: [second],
      });

    await renderBootstrap();
    await waitFor(() => bootstrap?.status === "ready");
    await act(async () => {
      bootstrap!.refreshInvocations();
      await waitFor(() => runtime.api.invocationStatus.mock.calls.length === 3);
    });

    expect(runtime.api.invocationStatus.mock.calls.slice(1)).toEqual([
      [CONVERSATION_ID, expect.objectContaining({ sinceRevision: "5", limit: 50 })],
      [CONVERSATION_ID, expect.objectContaining({ sinceRevision: "6", limit: 50 })],
    ]);
    expect(bootstrap?.invocations).toEqual([
      expect.objectContaining({ invocationId: INVOCATION_ID, status: "succeeded" }),
      expect.objectContaining({
        invocationId: "00000000-0000-4000-8000-000000000016",
        status: "queued",
      }),
    ]);
  });

  async function renderBootstrap() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <NextIntlClientProvider locale="zh-CN" messages={{}}>
            <BootstrapHarness
              onValue={(value) => {
                bootstrap = value;
              }}
            />
          </NextIntlClientProvider>
        </QueryClientProvider>
      );
      await settle();
    });
  }
});

describe("mergeInvocationStatuses", () => {
  it("replaces one aggregate by identity while preserving every active invocation", () => {
    const active = invocationStatus({
      invocationId: INVOCATION_ID,
      runId: RUN_ID,
      status: "queued",
      createdAt: "2026-07-30T10:00:00.000Z",
    });
    const unrelated = invocationStatus({
      invocationId: "00000000-0000-4000-8000-000000000026",
      runId: "00000000-0000-4000-8000-000000000027",
      status: "running",
      createdAt: "2026-07-30T10:00:01.000Z",
    });

    expect(
      mergeInvocationStatuses(
        [active, unrelated],
        [{ ...active, status: "succeeded", completedAt: "2026-07-30T10:00:02.000Z" }]
      )
    ).toEqual([
      expect.objectContaining({ invocationId: INVOCATION_ID, status: "succeeded" }),
      unrelated,
    ]);
  });
});

describe("useStoryStudioAgentSession", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let sessionValue: StoryStudioAgentSession | null;
  let bootstrap: StoryStudioAgentBootstrap;

  beforeEach(() => {
    ({ container, root, queryClient } = createHarness());
    sessionValue = null;
    resetRuntime();
    bootstrap = createBootstrap();
  });

  afterEach(async () => {
    await destroyHarness(root, container, queryClient);
  });

  it("publishes a fresh input, then wakes Temporal with only the Ably invocation pointer", async () => {
    const handle = clientRun({ runId: RUN_ID });
    runtime.view.send.mockResolvedValue(handle);
    await renderSession();

    await act(async () => {
      await sessionValue!.submit("  Make the arrival more dramatic.  ", "send");
    });

    expect(runtime.chat.sendMessage).not.toHaveBeenCalled();
    expect(runtime.view.send).toHaveBeenCalledTimes(1);
    expect(runtime.view.send).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          role: "user",
          parts: [{ type: "text", text: "Make the arrival more dramatic." }],
        }),
      })
    );
    expect(bootstrap.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        inputEventId: "input-event-1",
        clientMessageId: expect.any(String),
        sessionName: SESSION_NAME,
      })
    );
  });

  it("projects the creator prompt and busy state before durable admission returns", async () => {
    const admission = deferred<ReturnType<typeof accepted>>();
    const handle = clientRun({
      runId: "",
      started: new Promise(() => undefined),
    });
    runtime.view.send.mockResolvedValue(handle);
    vi.mocked(bootstrap.invoke).mockReturnValue(admission.promise);
    await renderSession();

    let submission!: Promise<boolean>;
    await act(async () => {
      submission = sessionValue!.submit("Add one node.", "send");
      await settle();
    });

    expect(sessionValue?.submitting).toBe(true);
    expect(sessionValue?.isRunning).toBe(true);
    expect(
      sessionValue?.timeline
        .filter((item) => item.kind === "message")
        .map((item) => (item.kind === "message" ? item.message.text : null))
    ).toEqual(["Add one node."]);

    await act(async () => {
      admission.resolve(accepted());
      await submission;
    });
    expect(sessionValue?.submitting).toBe(false);
    expect(sessionValue?.isRunning).toBe(true);
  });

  it("reconciles the durable projection immediately after admission rejects", async () => {
    runtime.view.send.mockResolvedValue(clientRun({ runId: "" }));
    vi.mocked(bootstrap.invoke).mockRejectedValue(
      new Error("This Agent conversation has reached its bounded pending-turn limit.")
    );
    await renderSession();

    await expect(act(async () => sessionValue!.submit("Queue this turn", "send"))).rejects.toThrow(
      "bounded pending-turn limit"
    );

    expect(bootstrap.refreshInvocations).toHaveBeenCalled();
    expect(sessionValue?.isRunning).toBe(false);
    expect(bootstrap.reportCommandError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "This Agent conversation has reached its bounded pending-turn limit.",
      })
    );
  });

  it("sends attachments as both render metadata and a stable model-visible product URI", async () => {
    runtime.view.send.mockResolvedValue(clientRun({ runId: RUN_ID }));
    await renderSession();

    await act(async () => {
      await sessionValue!.submit("", "send", [attachment()]);
    });

    const input = runtime.view.send.mock.calls[0]![0] as {
      message: { parts: unknown[] };
    };
    expect(input.message.parts).toEqual([
      {
        type: "data-studio-agent-attachment",
        id: ATTACHMENT_ID,
        data: attachment(),
      },
      {
        type: "file",
        mediaType: "image/webp",
        filename: "reference.webp",
        url: `fizzdragon-media://${ATTACHMENT_ID}`,
      },
    ]);
  });

  it("uses ClientRun.steer without issuing a second invocation", async () => {
    const handle = clientRun({ runId: RUN_ID });
    runtime.view.send.mockResolvedValue(handle);
    await renderSession();
    await act(async () => {
      await sessionValue!.submit("Initial direction", "send");
    });

    runtime.view.runs.mockReturnValue([wireRun("active")]);
    await emitView("run");
    expect(sessionValue?.canSteer).toBe(true);

    await act(async () => {
      await sessionValue!.submit("Keep it under two pages", "steer");
    });

    expect(handle.steer).toHaveBeenCalledTimes(1);
    expect(runtime.view.send).toHaveBeenCalledTimes(1);
    expect(bootstrap.invoke).toHaveBeenCalledTimes(1);
  });

  it("queues a fresh Run durably instead of folding it into the active Run", async () => {
    const activeHandle = clientRun({ runId: RUN_ID });
    const queuedHandle = clientRun({ runId: "" });
    runtime.view.send.mockResolvedValueOnce(activeHandle).mockResolvedValueOnce(queuedHandle);
    await renderSession();
    await act(async () => {
      await sessionValue!.submit("First", "send");
    });
    runtime.view.runs.mockReturnValue([wireRun("active")]);
    await emitView("run");

    await act(async () => {
      await sessionValue!.submit("Then add a coda", "enqueue");
    });

    expect(runtime.view.send).toHaveBeenCalledTimes(2);
    expect(activeHandle.steer).not.toHaveBeenCalled();
    expect(bootstrap.invoke).toHaveBeenCalledTimes(2);
    expect(sessionValue?.queuedCount).toBe(1);
  });

  it("keeps the session busy while a queued Run is waiting for its run-start", async () => {
    const activeHandle = clientRun({ runId: RUN_ID });
    const queuedHandle = clientRun({
      runId: "",
      started: new Promise(() => undefined),
    });
    runtime.view.send.mockResolvedValueOnce(activeHandle).mockResolvedValueOnce(queuedHandle);
    await renderSession();
    await act(async () => {
      await sessionValue!.submit("First", "send");
    });
    runtime.view.runs.mockReturnValue([wireRun("active")]);
    await emitView("run");
    await act(async () => {
      await sessionValue!.submit("Queued", "enqueue");
    });

    activeHandle.setStatus("complete");
    runtime.view.runs.mockReturnValue([]);
    await emitView("run");

    expect(sessionValue?.isRunning).toBe(true);
    expect(sessionValue?.canSteer).toBe(false);
    expect(sessionValue?.queuedCount).toBe(1);
    await expect(sessionValue!.startNewConversation()).rejects.toThrow(
      "Stop the active Agent turn"
    );

    await act(async () => sessionValue!.cancelActiveRun());
    expect(queuedHandle.cancel).toHaveBeenCalledTimes(1);
  });

  it("does not advertise steering for a Run started on another device", async () => {
    runtime.view.runs.mockReturnValue([wireRun("active")]);
    await renderSession();

    expect(sessionValue?.isRunning).toBe(true);
    expect(sessionValue?.canSteer).toBe(false);
    await expect(sessionValue!.submit("Change direction", "steer")).rejects.toThrow(
      "cannot be steered from this device"
    );
    expect(runtime.view.send).not.toHaveBeenCalled();
  });

  it("cancels a Run recovered from the durable control plane after reload", async () => {
    runtime.view.runs.mockReturnValue([wireRun("active")]);
    bootstrap = {
      ...bootstrap,
      invocations: [
        {
          invocationId: INVOCATION_ID,
          runId: "00000000-0000-4000-8000-000000000007",
          clientMessageId: "persisted-client-message",
          inputEventId: "input-event-1",
          status: "waiting_for_approval",
          error: null,
          latestAttempt: invocationAttempt({
            clientMessageId: "persisted-client-message",
            inputEventId: "input-event-1",
          }),
          createdAt: "2026-07-30T10:00:00.000Z",
          startedAt: "2026-07-30T10:00:01.000Z",
          completedAt: null,
        },
      ],
    };
    await renderSession();

    expect(sessionValue?.isRunning).toBe(true);
    expect(sessionValue?.canSteer).toBe(false);
    await act(async () => sessionValue!.cancelActiveRun());

    expect(bootstrap.requestDurableCancel).toHaveBeenCalledWith(INVOCATION_ID);
    expect(runtime.session.cancel).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000007");
    expect(runtime.chat.stop).toHaveBeenCalledTimes(1);
  });

  /**
   * STOP ANSWERS FOR THE TURN THE CREATOR IS WATCHING.
   *
   * `panel.activeRun` is the NEWEST non-terminal root run, so the moment a
   * follow-up is enqueued it outranks the turn that is actually streaming.
   * Stopping that one destroys a prompt that never ran — and the latch then
   * carried the cancel onto the streaming turn a few seconds later anyway.
   */
  it("stops the running turn, not the follow-up queued behind it", async () => {
    const running = invocationStatus({
      invocationId: INVOCATION_ID,
      runId: RUN_ID,
      status: "running",
      createdAt: "2026-07-30T10:00:00.000Z",
    });
    const queued = invocationStatus({
      invocationId: QUEUED_INVOCATION_ID,
      runId: QUEUED_RUN_ID,
      status: "queued",
      createdAt: "2026-07-30T10:00:05.000Z",
    });
    bootstrap = { ...bootstrap, invocations: [running, queued] };
    await renderSession();
    expect(sessionValue?.activeRun?.id).toBe(QUEUED_RUN_ID);

    await act(async () => sessionValue!.cancelActiveRun());

    expect(bootstrap.requestDurableCancel).toHaveBeenCalledWith(INVOCATION_ID);
    expect(bootstrap.requestDurableCancel).not.toHaveBeenCalledWith(QUEUED_INVOCATION_ID);
    expect(runtime.session.cancel).toHaveBeenCalledWith(RUN_ID);
    expect(runtime.session.cancel).not.toHaveBeenCalledWith(QUEUED_RUN_ID);

    // The stopped turn terminalizes. The queued prompt is a different turn and
    // must not inherit a Stop the creator never aimed at it.
    bootstrap = {
      ...bootstrap,
      invocations: [
        { ...running, status: "cancelled", completedAt: "2026-07-30T10:00:07.000Z" },
        queued,
      ],
    };
    await renderSession();

    expect(bootstrap.requestDurableCancel).not.toHaveBeenCalledWith(QUEUED_INVOCATION_ID);
    expect(sessionValue?.cancelling).toBe(false);
  });

  it("does not treat a cancellation the runtime never saw as a completed Stop", async () => {
    vi.mocked(bootstrap.requestDurableCancel).mockResolvedValue({
      schemaVersion: "agent-cancellation-result/v1",
      invocationId: INVOCATION_ID,
      status: "not-active",
    });
    bootstrap = {
      ...bootstrap,
      invocations: [
        invocationStatus({
          invocationId: INVOCATION_ID,
          runId: RUN_ID,
          status: "admitting",
          createdAt: "2026-07-30T10:00:00.000Z",
        }),
      ],
    };
    await renderSession();

    await act(async () => sessionValue!.cancelActiveRun());

    // No Workflow saw it: the row is still in the admission outbox and will be
    // dispatched afterwards. Saying nothing would leave the composer locked on
    // "Stopping…" for a turn that is about to start talking, with the id
    // latched so no later Stop could ever reach the gateway again.
    expect(bootstrap.reportCommandError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("had not started yet") })
    );
    expect(sessionValue?.cancelling).toBe(false);

    await act(async () => sessionValue!.cancelActiveRun());
    expect(bootstrap.requestDurableCancel).toHaveBeenCalledTimes(2);
  });

  it("cancels a freshly published Run before run-start and carries its durable invocation id", async () => {
    const handle = clientRun({ runId: "", started: new Promise(() => undefined) });
    runtime.view.send.mockResolvedValue(handle);
    await renderSession();
    await act(async () => {
      await sessionValue!.submit("Long task", "send");
    });

    expect(sessionValue?.isRunning).toBe(true);
    await act(async () => sessionValue!.cancelActiveRun());

    expect(handle.cancel).toHaveBeenCalledTimes(1);
    expect(bootstrap.requestDurableCancel).toHaveBeenCalledWith(INVOCATION_ID);
    expect(runtime.session.cancel).not.toHaveBeenCalled();
  });

  it("does not let an unavailable Ably cancellation block durable cancellation", async () => {
    const handle = clientRun({ runId: "", started: new Promise(() => undefined) });
    handle.cancel.mockReturnValue(new Promise(() => undefined));
    runtime.view.send.mockResolvedValue(handle);
    await renderSession();
    await act(async () => {
      await sessionValue!.submit("Long task", "send");
    });

    await act(async () => sessionValue!.cancelActiveRun());

    expect(bootstrap.requestDurableCancel).toHaveBeenCalledWith(INVOCATION_ID);
    expect(runtime.chat.stop).toHaveBeenCalledTimes(1);
    expect(handle.cancel).toHaveBeenCalledTimes(1);
  });

  it("unlocks and renders a durable failure when no Ably run-start can exist", async () => {
    const handle = clientRun({ runId: "", started: new Promise(() => undefined) });
    runtime.view.send.mockResolvedValue(handle);
    await renderSession();
    await act(async () => {
      await sessionValue!.submit("Missing event", "send");
    });
    const clientMessageId = (
      vi.mocked(bootstrap.invoke).mock.calls[0]![0] as {
        clientMessageId: string;
      }
    ).clientMessageId;

    bootstrap = {
      ...bootstrap,
      invocations: [
        {
          invocationId: INVOCATION_ID,
          runId: RUN_ID,
          clientMessageId,
          inputEventId: "input-event-1",
          status: "failed",
          error: {
            code: "AGENT_RUN_OPEN_FAILED",
            messageKey: "agent.error.start_failed",
            message: "The triggering input could not be located.",
            retryable: false,
            diagnosticId: "00000000-0000-4000-8000-000000000018",
          },
          latestAttempt: invocationAttempt({
            clientMessageId,
            inputEventId: "input-event-1",
          }),
          createdAt: "2026-07-30T10:00:00.000Z",
          startedAt: null,
          completedAt: "2026-07-30T10:00:05.000Z",
        },
      ],
    };
    await renderSession();
    await waitFor(() => sessionValue?.isRunning === false);

    expect(sessionValue?.turnFailure).toMatchObject({
      id: RUN_ID,
      status: "failed",
      error: {
        code: "AGENT_RUN_OPEN_FAILED",
        message: "The triggering input could not be located.",
      },
    });
    // Failures are part of the message flow (owner decision 2026-07-31): the
    // newest failed turn renders as exactly one in-flow row, which is where
    // the retry affordance lives — never a pinned card, never a duplicate.
    expect(
      sessionValue?.timeline.filter((item) => item.kind === "run" && item.id === RUN_ID)
    ).toHaveLength(1);
  });

  it("reconstructs a legacy turn without duplicating its failure into the transcript", async () => {
    const persistedPrompt: StudioAgentUIMessage = {
      id: "persisted-client-message",
      role: "user",
      metadata: { createdAt: "2026-07-30T10:00:00.500Z" },
      parts: [{ type: "text", text: "Open on the storm.", state: "done" }],
    };
    const persistedReply: StudioAgentUIMessage = {
      id: "persisted-assistant-message",
      role: "assistant",
      metadata: { createdAt: "2026-07-30T10:00:01.500Z" },
      parts: [{ type: "text", text: "The storm opens.", state: "done" }],
    };
    runtime.chat.messages = [persistedPrompt, persistedReply];
    bootstrap = {
      ...bootstrap,
      history: {
        ...bootstrap.history,
        messages: [persistedPrompt, persistedReply],
        messageIds: new Set([persistedPrompt.id, persistedReply.id]),
      },
      invocations: [
        {
          invocationId: INVOCATION_ID,
          runId: RUN_ID,
          clientMessageId: persistedPrompt.id,
          inputEventId: "input-event-1",
          status: "failed",
          error: {
            code: "AGENT_RUNTIME_FAILED",
            messageKey: "agent.error.runtime_failed",
            message: "The Agent runtime did not complete this turn.",
            retryable: true,
            diagnosticId: "00000000-0000-4000-8000-000000000019",
          },
          latestAttempt: invocationAttempt({
            clientMessageId: persistedPrompt.id,
            inputEventId: "input-event-1",
          }),
          createdAt: "2026-07-30T10:00:00.000Z",
          startedAt: "2026-07-30T10:00:01.000Z",
          completedAt: "2026-07-30T10:00:02.000Z",
        },
      ],
    };

    await renderSession();

    expect(
      sessionValue?.timeline.map((item) =>
        item.kind === "message"
          ? `${item.kind}:${item.message.messageId}:${item.message.runId}`
          : `${item.kind}:${item.id}`
      )
    ).toEqual([
      `message:${persistedPrompt.id}:${RUN_ID}`,
      `message:${persistedReply.id}:${RUN_ID}`,
      // The reconstructed turn's failure, exactly once and in flow — after the
      // messages of the turn it belongs to.
      `run:${RUN_ID}`,
    ]);
    expect(sessionValue?.turnFailure).toMatchObject({
      id: RUN_ID,
      status: "failed",
      error: {
        code: "AGENT_RUNTIME_FAILED",
        message: "The Agent runtime did not complete this turn.",
      },
    });
  });

  it("sends approval decisions through the AI SDK continuation path only", async () => {
    runtime.chat.messages = [approvalAssistantMessage()];
    bootstrap = {
      ...bootstrap,
      invocations: [
        {
          invocationId: INVOCATION_ID,
          runId: RUN_ID,
          clientMessageId: "creator-message-1",
          inputEventId: "input-event-1",
          status: "waiting_for_approval",
          error: null,
          latestAttempt: invocationAttempt({
            clientMessageId: "creator-message-1",
            inputEventId: "input-event-1",
          }),
          createdAt: "2026-07-30T10:00:00.000Z",
          startedAt: "2026-07-30T10:00:01.000Z",
          completedAt: null,
        },
      ],
    };
    await renderSession();

    await act(async () => {
      await sessionValue!.respondToToolApproval("approval-1", false);
    });

    expect(runtime.chat.addToolApprovalResponse).toHaveBeenCalledWith({
      id: "approval-1",
      approved: false,
    });
    expect(bootstrap.invoke).not.toHaveBeenCalled();
  });

  it("keeps approval controls closed until the product lifecycle has durably suspended", async () => {
    runtime.chat.messages = [approvalAssistantMessage()];
    const baseInvocation: AgentInvocationStatus = {
      invocationId: INVOCATION_ID,
      runId: RUN_ID,
      clientMessageId: "creator-message-1",
      inputEventId: "input-event-1",
      status: "running",
      error: null,
      latestAttempt: invocationAttempt({
        clientMessageId: "creator-message-1",
        inputEventId: "input-event-1",
      }),
      createdAt: "2026-07-30T10:00:00.000Z",
      startedAt: "2026-07-30T10:00:01.000Z",
      completedAt: null,
    };
    bootstrap = { ...bootstrap, invocations: [baseInvocation] };
    await renderSession();

    expect(sessionValue?.canRespondToToolApproval(RUN_ID)).toBe(false);
    await expect(
      act(async () => sessionValue!.respondToToolApproval("approval-1", true))
    ).rejects.toThrow("still becoming durable");
    expect(runtime.chat.addToolApprovalResponse).not.toHaveBeenCalled();

    bootstrap = {
      ...bootstrap,
      invocations: [{ ...baseInvocation, status: "waiting_for_approval" }],
    };
    await renderSession();
    expect(sessionValue?.canRespondToToolApproval(RUN_ID)).toBe(true);
    await act(async () => sessionValue!.respondToToolApproval("approval-1", true));
    expect(runtime.chat.addToolApprovalResponse).toHaveBeenCalledWith({
      id: "approval-1",
      approved: true,
    });
  });

  it("retries a rejected continuation with the exact original causal identity", async () => {
    const rejection = {
      code: "AGENT_ADMISSION_TEMPORARILY_UNAVAILABLE",
      messageKey: "agent.error.admission_unavailable",
      message: "The continuation could not be admitted yet.",
      retryable: true,
      diagnosticId: "00000000-0000-4000-8000-000000000029",
    };
    bootstrap = {
      ...bootstrap,
      invocations: [
        {
          invocationId: INVOCATION_ID,
          runId: RUN_ID,
          clientMessageId: "creator-message-1",
          inputEventId: "input-event-1",
          status: "waiting_for_approval",
          error: null,
          latestAttempt: {
            attemptId: "00000000-0000-4000-8000-000000000030",
            ordinal: 1,
            inputEventId: "continuation-event-1",
            clientMessageId: "continuation-message-1",
            status: "rejected",
            error: rejection,
          },
          createdAt: "2026-07-30T10:00:00.000Z",
          startedAt: "2026-07-30T10:00:01.000Z",
          completedAt: null,
        },
      ],
    };
    await renderSession();

    expect(bootstrap.reportCommandError).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "AgentContinuationAdmissionError",
        message: rejection.message,
      })
    );
    await expect(sessionValue!.retryRejectedAttempt(RUN_ID)).resolves.toBe(true);
    expect(bootstrap.invoke).toHaveBeenCalledWith({
      inputEventId: "continuation-event-1",
      clientMessageId: "continuation-message-1",
      continuationOfInvocationId: INVOCATION_ID,
    });
    expect(bootstrap.refreshInvocations).toHaveBeenCalled();
  });

  it("clears the AI SDK's latched transport error when the creator dismisses it", async () => {
    // `useChat` keeps its terminal error until `clearError()` is called, and
    // the session surfaces it as the "realtime unavailable" command error.
    // Dismiss used to clear only the bootstrap half, which left that banner
    // pinned forever over a composer that was already usable again.
    runtime.chat.error = new Error("stream terminated");
    await renderSession();

    expect(sessionValue?.commandError?.message).toContain(
      "The realtime connection is unavailable."
    );

    await act(async () => sessionValue!.clearCommandError());

    expect(runtime.chat.clearError).toHaveBeenCalledTimes(1);
    expect(bootstrap.clearCommandError).toHaveBeenCalledTimes(1);
  });

  it("drops the previous turn's latched transport error the moment a new send starts", async () => {
    runtime.chat.error = new Error("stream terminated");
    runtime.view.send.mockResolvedValue(clientRun({ runId: RUN_ID }));
    await renderSession();

    await act(async () => {
      await sessionValue!.submit("Try once more.", "send");
    });

    expect(runtime.chat.clearError).toHaveBeenCalled();
  });

  async function renderSession() {
    await act(async () => {
      root.render(
        <QueryClientProvider client={queryClient}>
          <SessionHarness
            bootstrap={bootstrap}
            onValue={(value) => {
              sessionValue = value;
            }}
          />
        </QueryClientProvider>
      );
      await settle();
    });
  }

  async function emitView(event: "run" | "update") {
    await act(async () => {
      for (const [registered, handler] of runtime.view.on.mock.calls as unknown as Array<
        [string, () => void]
      >) {
        if (registered === event) handler();
      }
      await settle();
    });
  }
});

function BootstrapHarness({ onValue }: { onValue: (value: StoryStudioAgentBootstrap) => void }) {
  onValue(
    useStoryStudioAgentBootstrap({
      projectId: PROJECT_ID,
      chapterId: null,
      workspaceId: WORKSPACE_ID,
      active: true,
    })
  );
  return null;
}

function SessionHarness({
  bootstrap,
  onValue,
}: {
  bootstrap: StoryStudioAgentBootstrap;
  onValue: (value: StoryStudioAgentSession) => void;
}) {
  onValue(useStoryStudioAgentSession(bootstrap));
  return null;
}

function createHarness() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const container = document.createElement("div");
  document.body.append(container);
  return {
    container,
    root: createRoot(container),
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  };
}

async function destroyHarness(root: Root, container: HTMLDivElement, queryClient: QueryClient) {
  await act(async () => root.unmount());
  queryClient.clear();
  container.remove();
}

function resetRuntime() {
  vi.clearAllMocks();
  runtime.api.resolveStoryConversation.mockResolvedValue(grant());
  runtime.api.createStoryConversation.mockResolvedValue(
    grant({ conversationId: NEW_CONVERSATION_ID })
  );
  runtime.api.authorizeConversation.mockResolvedValue(grant());
  runtime.api.updatePermissionMode.mockImplementation(
    (_conversationId: string, mode: "ask" | "smart" | "full") =>
      Promise.resolve(grant({ permissionMode: mode }))
  );
  runtime.api.invoke.mockResolvedValue(accepted());
  runtime.api.invocationStatus.mockResolvedValue({
    schemaVersion: "agent-invocation-status-page/v1",
    revision: "0",
    hasMore: false,
    invocations: [],
  });
  runtime.api.cancel.mockResolvedValue({
    schemaVersion: "agent-cancellation-result/v1",
    invocationId: INVOCATION_ID,
    status: "cancellation-requested",
  });
  runtime.api.history.mockResolvedValue(
    historyPage([textMessage("durable-message-1", "user", "Persisted")], null)
  );
  runtime.api.registerAttachment.mockResolvedValue(registeredAttachment());
  runtime.api.revokeAttachment.mockResolvedValue({
    ...registeredAttachment(),
    status: "revoked",
  });
  runtime.uploadFileViaSignedUrl.mockResolvedValue({ mediaAssetId: MEDIA_ASSET_ID });
  runtime.view.send.mockReset();
  runtime.view.runs.mockReturnValue([]);
  runtime.view.run.mockReturnValue(undefined);
  runtime.view.runOf.mockReturnValue(undefined);
  runtime.view.getMessages.mockReturnValue([]);
  runtime.view.on.mockImplementation(() => () => undefined);
  runtime.session.cancel.mockResolvedValue(undefined);
  runtime.session.on.mockImplementation(() => () => undefined);
  runtime.chat.messages = [];
  runtime.chat.status = "ready";
  runtime.chat.error = undefined;
  runtime.chat.stop.mockResolvedValue(undefined);
  runtime.chat.addToolApprovalResponse.mockResolvedValue(undefined);
  runtime.chat.clearError.mockReset();
  runtime.realtimeInput.current = null;
}

function createBootstrap(): StoryStudioAgentBootstrap {
  return {
    projectId: PROJECT_ID,
    chapterId: null,
    workspaceId: WORKSPACE_ID,
    locale: "en-GB",
    status: "ready",
    error: null,
    thread: {
      threadId: CONVERSATION_ID,
      permissionPolicy: { mode: "smart" },
    },
    history: {
      messages: [],
      messageIds: new Set(),
      nextCursor: null,
      runs: [],
      activities: [],
      writeToken: "",
      writtenNodeIds: [],
    },
    invocations: [],
    documentAnalysis: EMPTY_STUDIO_AGENT_DOCUMENT_ANALYSIS,
    conversationKey: CONVERSATION_ID,
    realtime: {
      client: null,
      channelName: SESSION_NAME,
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
    invoke: vi.fn().mockResolvedValue(accepted()),
    requestDurableCancel: vi.fn().mockResolvedValue(cancellationRequested()),
    startNewConversation: vi.fn().mockResolvedValue(undefined),
    uploadAttachment: vi.fn(),
    updatePermissionMode: vi.fn().mockResolvedValue(undefined),
  };
}

function grant({
  conversationId = CONVERSATION_ID,
  permissionMode = "smart",
}: {
  conversationId?: string;
  permissionMode?: "ask" | "smart" | "full";
} = {}) {
  return {
    schemaVersion: "agent-conversation-grant/v1",
    conversation: {
      id: conversationId,
      surface: "story-studio",
      title: null,
      permissionMode,
      createdAt: "2026-07-30T10:00:00.000Z",
      updatedAt: "2026-07-30T10:00:00.000Z",
      archivedAt: null,
    },
    sessionName: `agent:v1:conversation:${conversationId}`,
    ablyToken: "jwt.header.signature",
    expiresAt: "2099-07-30T11:00:00.000Z",
  };
}

function accepted() {
  return {
    schemaVersion: "agent-invocation-accepted/v1" as const,
    invocationId: INVOCATION_ID,
  };
}

function cancellationRequested() {
  return {
    schemaVersion: "agent-cancellation-result/v1" as const,
    invocationId: INVOCATION_ID,
    status: "cancellation-requested" as const,
  };
}

function invocationStatus(input: {
  invocationId: string;
  runId: string;
  status: AgentInvocationStatus["status"];
  createdAt: string;
}): AgentInvocationStatus {
  return {
    invocationId: input.invocationId,
    runId: input.runId,
    clientMessageId: `client-${input.invocationId}`,
    inputEventId: `event-${input.invocationId}`,
    status: input.status,
    error: null,
    latestAttempt: invocationAttempt({
      clientMessageId: `client-${input.invocationId}`,
      inputEventId: `event-${input.invocationId}`,
    }),
    createdAt: input.createdAt,
    startedAt: input.status === "admitting" || input.status === "queued" ? null : input.createdAt,
    completedAt:
      input.status === "succeeded" || input.status === "failed" || input.status === "cancelled"
        ? input.createdAt
        : null,
  };
}

function invocationAttempt({
  clientMessageId,
  inputEventId,
  attemptId = "00000000-0000-4000-8000-000000000028",
}: {
  clientMessageId: string;
  inputEventId: string;
  attemptId?: string;
}): AgentInvocationStatus["latestAttempt"] {
  return {
    attemptId,
    ordinal: 0,
    inputEventId,
    clientMessageId,
    status: "dispatched",
    error: null,
  };
}

function approvalAssistantMessage(): StudioAgentUIMessage {
  return {
    id: "assistant-approval-1",
    role: "assistant",
    metadata: {
      createdAt: "2026-07-30T10:00:02.000Z",
      runId: RUN_ID,
    },
    parts: [
      {
        type: "dynamic-tool",
        toolName: "cap_story_canvas_delete_scene_abcabcabcabc",
        toolCallId: "tool-call-1",
        state: "approval-requested",
        input: { sceneId: "scene-1" },
        approval: { id: "approval-1" },
      },
    ],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function historyPage(messages: ReturnType<typeof textMessage>[], nextCursor: string | null) {
  return {
    schemaVersion: "agent-history-page/v1",
    messages,
    nextCursor,
  };
}

function textMessage(id: string, role: "user" | "assistant", text: string) {
  return {
    id,
    role,
    parts: [{ type: "text", text }],
  };
}

function registeredAttachment() {
  return {
    schemaVersion: "agent-attachment/v1",
    id: ATTACHMENT_ID,
    conversationId: CONVERSATION_ID,
    mediaAssetId: MEDIA_ASSET_ID,
    fileName: "reference.webp",
    mediaType: "image/webp",
    sizeBytes: "5",
    status: "ready",
    uri: `fizzdragon-media://${ATTACHMENT_ID}`,
    ingest: null,
    analysis: null,
    error: null,
    createdAt: "2026-07-30T10:00:00.000Z",
    updatedAt: "2026-07-30T10:00:00.000Z",
  };
}

function registeredDocument(overrides: Partial<AgentAttachmentSummary> = {}) {
  return {
    ...registeredAttachment(),
    fileName: "screenplay-test.docx",
    mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: "159744",
    ...overrides,
  };
}

function attachment() {
  return {
    type: "attachment" as const,
    attachmentId: ATTACHMENT_ID,
    fileName: "reference.webp",
    mediaType: "image/webp",
    sizeBytes: 5,
    status: "ready" as const,
  };
}

function wireRun(status: "active" | "suspended" | "complete" | "cancelled" | "error") {
  return status === "error"
    ? {
        runId: RUN_ID,
        clientId: "client-1",
        invocationId: INVOCATION_ID,
        steps: [],
        status,
        error: { code: 50000, statusCode: 500, message: "Run failed" },
      }
    : {
        runId: RUN_ID,
        clientId: "client-1",
        invocationId: INVOCATION_ID,
        steps: [],
        status,
      };
}

function clientRun({
  runId,
  started = Promise.resolve(),
  status = "active",
}: {
  runId: string;
  started?: Promise<void>;
  status?: "active" | "complete" | "cancelled" | "error";
}) {
  let currentStatus = status;
  const steer = vi.fn(() => ({
    published: Promise.resolve({ serial: "serial-1" }),
    outcome: Promise.resolve({ consumed: true }),
  }));
  return {
    get runId() {
      return runId;
    },
    get status() {
      return currentStatus;
    },
    error: undefined,
    messages: [],
    inputCodecMessageId: "codec-message-1",
    inputEventId: "input-event-1",
    started,
    setStatus(next: typeof currentStatus) {
      currentStatus = next;
    },
    cancel: vi.fn().mockResolvedValue(undefined),
    steer,
    toInvocation: () => ({
      toJSON: () => ({
        inputEventId: "input-event-1",
        sessionName: SESSION_NAME,
      }),
    }),
  };
}

async function waitFor(predicate: () => boolean, attempts = 40) {
  for (let index = 0; index < attempts; index += 1) {
    if (predicate()) return;
    await act(async () => settle());
  }
  throw new Error("Timed out waiting for hook state.");
}

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
