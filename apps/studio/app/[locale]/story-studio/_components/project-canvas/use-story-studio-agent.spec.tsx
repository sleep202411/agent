// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { STUDIO_AGENT_SCHEMA_VERSION } from "@repo/shared";
import { NextIntlClientProvider } from "next-intl";

import { ApiRequestError } from "@/lib/api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { storyProjectionQueryKey } from "./story-canvas-edit-policy";
import type { StoryStudioAgentBootstrap, StoryStudioAgentSession } from "./use-story-studio-agent";
import { useStoryStudioAgentBootstrap, useStoryStudioAgentSession } from "./use-story-studio-agent";

/**
 * The transport is faked; everything above it is real.
 *
 * `ClientSession` and `useChat` are the two things a jsdom test cannot stand
 * up (one needs an Ably socket, the other needs the transport). Everything the
 * hook actually decides — which write path a delivery mode takes, whether the
 * invocation POST fires once, when the control plane is re-read, when the
 * canvas is told to re-read — runs for real against them.
 */
const runtime = vi.hoisted(() => {
  const api = {
    resolveThread: vi.fn(),
    getSnapshot: vi.fn(),
    createRealtimeGrant: vi.fn(),
    sendInvocation: vi.fn(),
    registerAttachment: vi.fn(),
    deleteAttachment: vi.fn(),
    updatePermissionPolicy: vi.fn(),
    resolveApproval: vi.fn(),
  };
  const view = {
    send: vi.fn(),
    runs: vi.fn(() => [] as unknown[]),
    run: vi.fn(),
    on: vi.fn(() => () => undefined),
  };
  const session = {
    view,
    cancel: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(() => () => undefined),
  };
  const chatTransport = {};
  const chat = {
    messages: [] as unknown[],
    setMessages: vi.fn(),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    addToolApprovalResponse: vi.fn().mockResolvedValue(undefined),
    status: "ready" as string,
    error: undefined as Error | undefined,
  };
  /** Whatever `useChat` was constructed with, so its options can be asserted. */
  const chatInit = { current: null as Record<string, unknown> | null };
  const syncSeed = { current: undefined as unknown[] | undefined };
  return {
    api,
    view,
    session,
    chatTransport,
    chat,
    chatInit,
    syncSeed,
    uploadFileViaSignedUrl: vi.fn(),
    ApiClient: vi.fn(function MockStudioAgentApiClient() {
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
    StudioAgentApiClient: runtime.ApiClient,
    // The Ably connection itself is out of scope here: the hook only ever asks
    // it for a client and a channel name, and the layer spec proves the
    // providers are handed exactly those.
    useStudioAgentRealtime: () => ({
      client: null,
      channelName: null,
      status: "connected",
      error: null,
    }),
  };
});

vi.mock("@ably/ai-transport/vercel/react", () => ({
  useChatTransport: () => ({
    session: runtime.session,
    chatTransport: runtime.chatTransport,
    sessionError: undefined,
    chatTransportError: undefined,
  }),
  useMessageSync: (options: { messages?: unknown[] }) => {
    runtime.syncSeed.current = options.messages;
  },
}));

vi.mock("@ai-sdk/react", () => ({
  useChat: (init: Record<string, unknown>) => {
    runtime.chatInit.current = init;
    return runtime.chat;
  },
}));

describe("useStoryStudioAgentBootstrap", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let bootstrap: StoryStudioAgentBootstrap | null;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    bootstrap = null;
    resetRuntime();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
  });

  it("resolves the exact story scope and seeds the transcript from the snapshot", async () => {
    await render();
    await waitUntilReady();

    expect(runtime.ApiClient).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      locale: "zh-CN",
    });
    expect(runtime.api.resolveThread).toHaveBeenCalledWith(
      expect.objectContaining({
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        surfaceId: "story.studio",
        scenario: { id: "story.studio.assistant", version: "1.0.0" },
        scope: {
          workspaceId: "workspace-1",
          container: { resourceType: "story.project", resourceId: "project-1", revision: null },
          focus: { resourceType: "story.chapter", resourceId: "chapter-1", revision: null },
        },
        locale: "zh-CN",
      }),
      expect.any(AbortSignal)
    );
    // The seam key: the persisted row's own id, unchanged, so the channel copy
    // of the same message reconciles onto it instead of duplicating it.
    expect(bootstrap?.history.messages.map((message) => message.id)).toEqual([HISTORY_MESSAGE_ID]);
  });

  it("rebuilds the conversation when the user retries after a failed load", async () => {
    runtime.api.resolveThread
      .mockRejectedValueOnce(new Error("Temporary gateway failure"))
      .mockResolvedValueOnce({
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        thread: thread(),
        created: false,
      });

    await render();
    await waitUntilStatus("error");

    const before = bootstrap!.conversationKey;
    await act(async () => bootstrap!.retry());
    await waitUntilReady();

    expect(runtime.api.resolveThread).toHaveBeenCalledTimes(2);
    // `useChat` reads its seed once, keyed on this id. A retry that reused the
    // key would leave the panel showing the failed load's empty transcript.
    expect(bootstrap!.conversationKey).not.toBe(before);
  });

  it("returns a thread-bound lease that idempotently abandons its canonical artifact", async () => {
    await render();
    await waitUntilReady();
    const file = new File(["image"], "reference.webp", { type: "image/webp" });
    const controller = new AbortController();
    const onProgress = vi.fn();

    const lease = await bootstrap!.uploadAttachment(file, {
      signal: controller.signal,
      onProgress,
    });

    expect(lease.attachment).toEqual(canonicalAttachment);
    await expect(lease.abandon()).resolves.toBeUndefined();
    await expect(lease.abandon()).resolves.toBeUndefined();

    expect(runtime.api.deleteAttachment).toHaveBeenCalledOnce();
    expect(runtime.uploadFileViaSignedUrl).toHaveBeenCalledWith(file, {
      kind: "studio_agent_image",
      workspaceId: "workspace-1",
      contentType: "image/webp",
      signal: controller.signal,
      onProgress,
    });
  });

  it("routes supported documents through the dedicated document upload channel", async () => {
    await render();
    await waitUntilReady();
    const file = new File(["# Outline"], "outline.md", { type: "text/markdown" });

    await bootstrap!.uploadAttachment(file, {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });

    expect(runtime.uploadFileViaSignedUrl).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ kind: "studio_agent_document", contentType: "text/markdown" })
    );
  });

  it("pages earlier turns one window at a time and keeps the newer ones", async () => {
    runtime.api.getSnapshot.mockResolvedValueOnce(
      snapshot({
        messages: [historyMessage(HISTORY_MESSAGE_ID, 2, "Later.")],
        turnWindow: { earliestRootRunId: EARLIEST_ROOT_RUN_ID, hasEarlier: true },
      })
    );
    await render();
    await waitUntilReady();
    expect(bootstrap?.hasEarlierTurns).toBe(true);

    runtime.api.getSnapshot.mockResolvedValueOnce(
      snapshot({
        messages: [historyMessage(OLDER_MESSAGE_ID, 1, "Earlier.")],
        turnWindow: { earliestRootRunId: null, hasEarlier: false },
      })
    );
    await act(async () => {
      await bootstrap!.loadEarlierTurns();
    });

    expect(runtime.api.getSnapshot).toHaveBeenLastCalledWith(
      thread().threadId,
      expect.objectContaining({ beforeRootRunId: EARLIEST_ROOT_RUN_ID })
    );
    expect(bootstrap?.history.messages.map((message) => message.id)).toEqual([
      OLDER_MESSAGE_ID,
      HISTORY_MESSAGE_ID,
    ]);
    expect(bootstrap?.hasEarlierTurns).toBe(false);
  });

  async function render() {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="zh-CN" messages={{}}>
          <QueryClientProvider client={queryClient}>
            <BootstrapHarness
              onBootstrap={(value) => {
                bootstrap = value;
              }}
            />
          </QueryClientProvider>
        </NextIntlClientProvider>
      );
      await settle();
    });
  }

  async function waitUntilReady() {
    await waitUntilStatus("ready");
  }

  async function waitUntilStatus(status: string) {
    for (let attempt = 0; attempt < 20 && bootstrap?.status !== status; attempt += 1) {
      await act(async () => settle());
    }
    expect(bootstrap?.status).toBe(status);
  }
});

describe("useStoryStudioAgentSession", () => {
  let container: HTMLDivElement;
  let root: Root;
  let queryClient: QueryClient;
  let session: StoryStudioAgentSession | null;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    session = null;
    resetRuntime();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    queryClient.clear();
    container.remove();
  });

  it("starts a fresh turn through useChat, under one id for the message and the command", async () => {
    await render(createBootstrap());

    await act(async () => {
      await session!.submit("Rewrite chapter one.", "send");
    });

    expect(runtime.chat.sendMessage).toHaveBeenCalledOnce();
    expect(runtime.view.send).not.toHaveBeenCalled();
    const sent = runtime.chat.sendMessage.mock.calls[0]![0] as {
      id: string;
      metadata: { clientMessageId: string };
    };
    // Two ids would guarantee a duplicate at the seam on the next reload: the
    // server persists the submission under `clientMessageId`, and the channel
    // carries it under `UIMessage.id`.
    expect(sent.id).toBe(sent.metadata.clientMessageId);
  });

  /**
   * THE SEED MUST NOT MOVE UNDER THE RECONCILER.
   *
   * `useMessageSync` takes the NEWEST seeded id as its seam, pages the channel
   * back to it, and composes `seed ⧺ live`. Its contract says the seed is read
   * once per channel. `bootstrap.history` is not that — it is re-fetched every
   * time a write lands, so it grows as the conversation does. Handing the grown
   * copy back re-seams against a seed that already contains the live tail and
   * composes the same turns twice: the creator watches the conversation they
   * just had render a second time, and a refresh "fixes" it because a fresh
   * mount starts from one consistent snapshot again. Observed in production.
   */
  it("holds the seed when a write grows the snapshot, so the turn is not composed twice", async () => {
    const bootstrap = createBootstrap();
    const first = [{ id: "m1", role: "user", parts: [{ type: "text", text: "hi" }] }];
    bootstrap.history = { ...bootstrap.history, messages: first } as never;
    await render(bootstrap);
    expect(runtime.syncSeed.current).toBe(first);

    // The write landed; the snapshot now also carries the reply the CHANNEL has
    // already delivered. The seam has moved.
    const grown = [...first, { id: "m2", role: "assistant", parts: [] }];
    await render({ ...bootstrap, history: { ...bootstrap.history, messages: grown } } as never);

    expect(runtime.syncSeed.current).toBe(first);
  });

  /**
   * ...but paging in EARLIER turns is the one growth that must be adopted. It
   * only adds to the front, so the seam does not move — and the panel renders
   * the overlay, not the seed, so refusing it would leave "load earlier turns"
   * clicking with nothing appearing.
   */
  it("adopts a seed that grew at the front, because the seam did not move", async () => {
    const bootstrap = createBootstrap();
    const current = [{ id: "m2", role: "user", parts: [{ type: "text", text: "now" }] }];
    bootstrap.history = { ...bootstrap.history, messages: current } as never;
    await render(bootstrap);
    expect(runtime.syncSeed.current).toBe(current);

    const withEarlier = [
      { id: "m0", role: "user", parts: [{ type: "text", text: "before" }] },
      ...current,
    ];
    await render({
      ...bootstrap,
      history: { ...bootstrap.history, messages: withEarlier },
    } as never);

    expect(runtime.syncSeed.current).toBe(withEarlier);
  });

  it("publishes a steer as a continuation of the live run and wakes it exactly once", async () => {
    runtime.view.send.mockResolvedValue({
      toInvocation: () => ({
        toJSON: () => ({ inputEventId: "event-1", sessionName: CHANNEL_NAME }),
      }),
    });
    liveRun();
    const bootstrap = createBootstrap();
    await render(bootstrap);

    await act(async () => {
      await session!.submit("Make it darker.", "steer");
    });

    // Not `useChat`: a second `sendMessage` during a live stream orphans the
    // first response. The transport's own continuation verb is the write path.
    expect(runtime.chat.sendMessage).not.toHaveBeenCalled();
    expect(runtime.view.send).toHaveBeenCalledOnce();
    expect(runtime.view.send.mock.calls[0]![1]).toEqual({ runId: RUN_ID });
    // Published once, woken once. Publishing and then also steering the
    // returned run would put the same prompt on the channel twice.
    expect(bootstrap.submitInvocation).toHaveBeenCalledOnce();
    expect(bootstrap.submitInvocation).toHaveBeenCalledWith(
      expect.objectContaining({ targetRunId: RUN_ID, delivery: "steer" }),
      { inputEventId: "event-1", sessionName: CHANNEL_NAME }
    );
  });

  /**
   * THE LAST MILE OF THE WEDGE.
   *
   * When a workflow dies without reporting, nothing is published on the channel
   * to say so — there is no workflow left to publish it. The server reconciles
   * its own state on the next submission and frees the thread, but THIS client
   * still believes a turn is live, so it keeps steering into a run that has
   * ended. Without the refresh the creator sends the same message twice and the
   * second one fails for the same invisible reason as the first.
   */
  it("resends as a fresh turn when the run it steered into has ended", async () => {
    runtime.view.send.mockResolvedValue({
      toInvocation: () => ({
        toJSON: () => ({ inputEventId: "event-1", sessionName: CHANNEL_NAME }),
      }),
    });
    liveRun();
    const bootstrap = createBootstrap();
    // Fails the steer once, then lets the automatic fresh-turn retry through.
    (bootstrap.submitInvocation as unknown as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(
        new ApiRequestError(
          "STUDIO_AGENT_TARGET_RUN_INACTIVE",
          "The selected agent run is no longer active.",
          409
        )
      )
      .mockResolvedValue(undefined);
    await render(bootstrap);

    await act(async () => {
      await expect(session!.submit("Make it darker.", "steer")).resolves.toBe(true);
    });

    expect(bootstrap.refreshControlPlane).toHaveBeenCalled();
    // The retry goes out through the FRESH-send path, the only one that
    // publishes an input event carrying no target run. Rewriting the steer
    // server-side instead produces a turn the channel calls a continuation of a
    // corpse, and it dies waiting for a run-start that never comes.
    expect(runtime.chat.sendMessage).toHaveBeenCalledOnce();
  });

  it("does not re-read the control plane for an unrelated failure", async () => {
    runtime.view.send.mockResolvedValue({
      toInvocation: () => ({
        toJSON: () => ({ inputEventId: "event-1", sessionName: CHANNEL_NAME }),
      }),
    });
    liveRun();
    const bootstrap = createBootstrap();
    (bootstrap.submitInvocation as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ApiRequestError("NETWORK_ERROR", "Network connection failed", 0)
    );
    await render(bootstrap);

    await act(async () => {
      await expect(session!.submit("Make it darker.", "steer")).rejects.toThrow();
    });

    expect(bootstrap.refreshControlPlane).not.toHaveBeenCalled();
  });

  it("shows a steer immediately, because the message sync is gated while a stream is live", async () => {
    runtime.view.send.mockResolvedValue({
      toInvocation: () => ({ toJSON: () => ({ inputEventId: "e", sessionName: CHANNEL_NAME }) }),
    });
    liveRun();
    await render(createBootstrap());

    await act(async () => {
      await session!.submit("Make it darker.", "steer");
    });

    expect(promptTexts()).toContain("Make it darker.");
  });

  it("counts a queued prompt so the composer can say how many are waiting", async () => {
    runtime.view.send.mockResolvedValue({
      toInvocation: () => ({ toJSON: () => ({ inputEventId: "e", sessionName: CHANNEL_NAME }) }),
    });
    liveRun();
    await render(createBootstrap());

    await act(async () => {
      await session!.submit("And add a coda.", "enqueue");
    });

    expect(session?.queuedCount).toBe(1);
  });

  it("drops the optimistic steer without a trace if the publish is refused", async () => {
    runtime.view.send.mockRejectedValue(new Error("Studio Agent refused the steer."));
    liveRun();
    await render(createBootstrap());

    await act(async () => {
      await expect(session!.submit("Make it darker.", "steer")).rejects.toThrow(
        "Studio Agent refused the steer."
      );
    });

    expect(promptTexts()).not.toContain("Make it darker.");
  });

  it("refuses to steer when no turn is running", async () => {
    await render(createBootstrap());
    await act(async () => {
      await expect(session!.submit("Make it darker.", "steer")).rejects.toThrow(
        "delivery mode does not match"
      );
    });
    expect(runtime.view.send).not.toHaveBeenCalled();
  });

  it("refuses to start a second root turn while one is running", async () => {
    liveRun();
    await render(createBootstrap());
    await act(async () => {
      await expect(session!.submit("Rewrite chapter one.", "send")).rejects.toThrow(
        "delivery mode does not match"
      );
    });
    expect(runtime.chat.sendMessage).not.toHaveBeenCalled();
  });

  it("interrupts a live turn on the channel and tears down the local stream", async () => {
    liveRun();
    await render(createBootstrap());

    await act(async () => {
      await session!.cancelActiveRun();
    });

    expect(runtime.session.cancel).toHaveBeenCalledWith(RUN_ID);
    expect(runtime.chat.stop).toHaveBeenCalled();
  });

  it("cancels a turn that has been sent but has not been given a run id yet", async () => {
    // The agent mints the run id, so between `sendMessage` and `ai-run-start`
    // the browser has none — and that is exactly when someone who mistyped
    // reaches for Stop. The transport's abort path owns this window: it calls
    // `run.cancel()` keyed by the triggering input's codec-message-id, which the
    // agent buffers until its input lookup resolves.
    runtime.chat.status = "submitted";
    await render(createBootstrap());
    expect(session?.isRunning).toBe(true);

    await act(async () => {
      await session!.cancelActiveRun();
    });

    expect(runtime.chat.stop).toHaveBeenCalledOnce();
    // Nothing to address by run id yet; publishing `ai-cancel` with no target
    // would be a cancel for no run.
    expect(runtime.session.cancel).not.toHaveBeenCalled();
  });

  /**
   * THE WINDOW THE CHANNEL CANNOT REACH.
   *
   * `ai-cancel` fires the abort signal of a run object some activity is holding,
   * so it only stops a turn that is INSIDE a model step. Press stop while a tool
   * is executing, between two activities, or while the turn is parked on an
   * approval, and the worker has nothing registered to route it to: the panel
   * says "stopping" and the turn runs to completion anyway. The HTTP route is the
   * only thing that reaches the Temporal workflow, and it had ZERO callers.
   */
  it("also publishes the durable cancel, which is the only one that reaches a parked turn", async () => {
    liveRun();
    const bootstrap = createBootstrap();
    await render(bootstrap);

    await act(async () => {
      await session!.cancelActiveRun();
      await settle();
    });

    expect(runtime.session.cancel).toHaveBeenCalledWith(RUN_ID);
    expect(bootstrap.requestDurableCancel).toHaveBeenCalledWith(RUN_ID);
    // Order matters: the channel is milliseconds, the outbox is a poll interval.
    const channelAt = runtime.session.cancel.mock.invocationCallOrder[0]!;
    const durableAt = (bootstrap.requestDurableCancel as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!;
    expect(channelAt).toBeLessThan(durableAt);
  });

  it("reports a failed durable cancel without pretending the stop was undone", async () => {
    liveRun();
    const reportCommandError = vi.fn();
    const bootstrap = createBootstrap({
      reportCommandError,
      requestDurableCancel: vi.fn().mockRejectedValue(new Error("Run not found.")),
      overlayRef: { current: [] },
    });
    await render(bootstrap);

    // The fast path already published `ai-cancel`, so this must not throw and
    // must not clear `cancelling` — the turn may well be stopping.
    await act(async () => {
      await session!.cancelActiveRun();
      await settle();
    });

    expect(reportCommandError).toHaveBeenCalled();
    expect(session?.cancelling).toBe(true);
  });

  it("has nothing durable to cancel before the agent has minted a run id", async () => {
    runtime.chat.status = "submitted";
    const bootstrap = createBootstrap();
    await render(bootstrap);

    await act(async () => {
      await session!.cancelActiveRun();
      await settle();
    });

    expect(bootstrap.requestDurableCancel).not.toHaveBeenCalled();
  });

  it("keeps saying it is stopping until the turn actually settles", async () => {
    liveRun();
    await render(createBootstrap());

    await act(async () => {
      await session!.cancelActiveRun();
      await settle();
    });

    // Publishing `ai-cancel` is the whole of the client's part. Everything the
    // creator is waiting for happens after it, so clearing here would put the
    // panel back to "working" one tick after Stop was pressed.
    expect(session?.cancelling).toBe(true);
    expect(session?.isRunning).toBe(true);

    await act(async () => {
      endRun();
      await settle();
    });

    expect(session?.cancelling).toBe(false);
    expect(session?.isRunning).toBe(false);
  });

  it("does not open the next turn already claiming to be stopping", async () => {
    liveRun();
    await render(createBootstrap());
    await act(async () => {
      await session!.cancelActiveRun();
      await settle();
    });
    await act(async () => {
      endRun();
      await settle();
    });

    // `cancelling` is derived by ANDing the request against "a turn is in
    // flight", so the request has to be retired where the next turn begins —
    // otherwise the new turn inherits the previous turn's Stop.
    await act(async () => {
      await session!.submit("Rewrite chapter one.", "send");
      liveRun();
      emitRunChange();
      await settle();
    });

    expect(session?.isRunning).toBe(true);
    expect(session?.cancelling).toBe(false);
  });

  it("refuses a second stop while the first is still unwinding", async () => {
    liveRun();
    await render(createBootstrap());

    await act(async () => {
      await session!.cancelActiveRun();
      await settle();
    });
    await act(async () => {
      await session!.cancelActiveRun();
    });

    expect(runtime.session.cancel).toHaveBeenCalledOnce();
  });

  it("answers a suspended tool call through the library, with no second write beside it", async () => {
    await render(createBootstrap());

    await act(async () => {
      await session!.respondToToolApproval("approval-1", true);
    });

    expect(runtime.chat.addToolApprovalResponse).toHaveBeenCalledWith({
      id: "approval-1",
      approved: true,
    });
    // The decision travels as the transport's `tool-approval-response`, derived
    // from the overlay on the continuation. A POST here would be a second author
    // for one fact.
    expect(runtime.api.sendInvocation).not.toHaveBeenCalled();
    expect(runtime.view.send).not.toHaveBeenCalled();
  });

  it("arms the continuation that carries an approval back to the agent", async () => {
    await render(createBootstrap());

    // `addToolApprovalResponse` only rewrites the local part. Without this
    // predicate useChat never issues the continuation, so the transport never
    // derives the `tool-approval-response` and the agent waits for good.
    const sendAutomaticallyWhen = runtime.chatInit.current?.sendAutomaticallyWhen as
      | ((options: { messages: unknown[] }) => boolean)
      | undefined;
    expect(sendAutomaticallyWhen).toBeTypeOf("function");
    expect(sendAutomaticallyWhen!({ messages: [assistantWithAnsweredApproval()] })).toBe(true);
    expect(sendAutomaticallyWhen!({ messages: [assistantWithPendingApproval()] })).toBe(false);
  });

  it("re-reads the control plane when the channel says a run's lifecycle moved", async () => {
    liveRun();
    const bootstrap = createBootstrap();
    await render(bootstrap);
    expect(bootstrap.refreshControlPlane).not.toHaveBeenCalled();

    await act(async () => {
      endRun();
      await settle();
    });

    // Approvals, delegated tasks and applied writes have no wire shape. The
    // channel says WHEN to look; this is the looking.
    expect(bootstrap.refreshControlPlane).toHaveBeenCalled();
  });

  it("tells the canvas to re-read once the agent's write has landed", async () => {
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const bootstrap = createBootstrap();
    await render(bootstrap);
    expect(invalidate).not.toHaveBeenCalled();

    await render(
      createBootstrap({ history: { ...bootstrap.history, writeToken: "action-1:succeeded" } })
    );

    expect(invalidate).toHaveBeenCalled();
    const predicate = invalidate.mock.calls[0]![0]!.predicate!;
    expect(
      predicate({
        queryKey: storyProjectionQueryKey("workbench", "workspace-1", "project-1", "chapter-1"),
      } as never)
    ).toBe(true);
    expect(
      predicate({ queryKey: ["story-studio", "workbench", "workspace-1", "other"] } as never)
    ).toBe(false);
  });

  function promptTexts(): string[] {
    return (session?.timeline ?? []).flatMap((item) =>
      item.kind === "message" ? [item.message.text] : []
    );
  }

  /**
   * THE SPINNER THAT NEVER STOPPED.
   *
   * Every other unstick in the hook waits for somebody to publish something: the
   * domain terminal, the wire's `ai-run-end`, a rich failure part. A worker that
   * DIES publishes none of them, and there was no watchdog anywhere — so the
   * panel span until reload, indistinguishable from a slow model.
   */
  it("surfaces a turn that has gone silent, and re-reads the control plane once", async () => {
    // `shouldAdvanceTime` so the harness's own real `setTimeout(0)` settles
    // still resolve under the fake clock; the 120s window is advanced explicitly.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      liveRun();
      const refreshControlPlane = vi.fn();
      await render(createBootstrap({ refreshControlPlane }));

      expect(session?.stalled).toBe(false);
      expect(refreshControlPlane).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(119_000);
      });
      expect(session?.stalled).toBe(false);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000);
      });
      expect(session?.stalled).toBe(true);
      // Not just a message: if the run reached a terminal in Postgres and the
      // channel terminal was lost, this is what unsticks the panel for real.
      expect(refreshControlPlane).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not call a turn waiting on the creator a stall", async () => {
    // `shouldAdvanceTime` so the harness's own real `setTimeout(0)` settles
    // still resolve under the fake clock; the 120s window is advanced explicitly.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const bootstrap = createBootstrap({
        history: {
          messages: [],
          messageIds: new Set<string>(),
          runs: [waitingRun("waiting_for_approval")],
          activities: [],
          approvals: [],
          writeToken: "",
          writtenNodeIds: [],
        } as unknown as StoryStudioAgentBootstrap["history"],
      });
      await render(bootstrap);
      expect(session?.isRunning).toBe(true);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(300_000);
      });

      // An approval can legitimately sit unanswered for hours. Calling that a
      // stall would be lying about the most common pause there is.
      expect(session?.stalled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the stall the moment the channel speaks again", async () => {
    // `shouldAdvanceTime` so the harness's own real `setTimeout(0)` settles
    // still resolve under the fake clock; the 120s window is advanced explicitly.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      liveRun();
      const bootstrap = createBootstrap();
      await render(bootstrap);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(121_000);
      });
      expect(session?.stalled).toBe(true);

      // One more token arrives. The pulse is CONTENT, not the array's identity —
      // `useMessageSync` replaces the array wholesale on a snapshot refresh,
      // including the refresh the watchdog itself triggers, and keying on
      // identity would let that hide a real stall forever. So this has to be a
      // real change in what the channel has delivered.
      runtime.chat.messages = [
        { id: "assistant-1", role: "assistant", parts: [{ type: "text", text: "..." }] },
      ];
      await render(bootstrap);

      expect(session?.stalled).toBe(false);

      // ... and a re-render that delivers nothing new does NOT reset the window.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      await render(bootstrap);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(61_000);
      });
      expect(session?.stalled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not arm the watchdog when nothing is in flight", async () => {
    // `shouldAdvanceTime` so the harness's own real `setTimeout(0)` settles
    // still resolve under the fake clock; the 120s window is advanced explicitly.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const refreshControlPlane = vi.fn();
      await render(createBootstrap({ refreshControlPlane }));
      expect(session?.isRunning).toBe(false);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(600_000);
      });

      expect(session?.stalled).toBe(false);
      expect(refreshControlPlane).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  async function render(bootstrap: StoryStudioAgentBootstrap) {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="en-US" messages={{}}>
          <QueryClientProvider client={queryClient}>
            <SessionHarness
              input={bootstrap}
              onSession={(value) => {
                session = value;
              }}
            />
          </QueryClientProvider>
        </NextIntlClientProvider>
      );
      await settle();
    });
  }
});

function BootstrapHarness({
  onBootstrap,
}: {
  onBootstrap: (bootstrap: StoryStudioAgentBootstrap) => void;
}) {
  onBootstrap(
    useStoryStudioAgentBootstrap({
      projectId: "project-1",
      chapterId: "chapter-1",
      workspaceId: "workspace-1",
      active: true,
    })
  );
  return null;
}

/**
 * Declared once, outside the render helper.
 *
 * A component defined inside the helper would be a new type on every call, so
 * React would unmount and remount the tree instead of re-rendering it — and the
 * two "has this changed since last time?" guards under test live in refs that a
 * remount silently resets.
 */
function SessionHarness({
  input,
  onSession,
}: {
  input: StoryStudioAgentBootstrap;
  onSession: (session: StoryStudioAgentSession) => void;
}) {
  onSession(useStoryStudioAgentSession(input));
  return null;
}

const THREAD_ID = "00000000-0000-4000-8000-000000000001";
const RUN_ID = "00000000-0000-4000-8000-000000000030";
const CHANNEL_NAME = `studio-agent:thread:${THREAD_ID}`;
const HISTORY_MESSAGE_ID = "00000000-0000-4000-8000-000000000029";
const OLDER_MESSAGE_ID = "00000000-0000-4000-8000-000000000027";
const EARLIEST_ROOT_RUN_ID = "019f8d30-0000-7000-8000-000000000001";

function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** A control-plane run parked on the creator, which is silent by design. */
function waitingRun(status: "waiting_for_approval" | "waiting_for_input") {
  return {
    id: RUN_ID,
    parentRunId: null,
    title: "",
    summary: null,
    error: null,
    status,
    progress: null,
    createdAt: "2026-07-28T00:00:00.000Z",
    startedAt: "2026-07-28T00:00:00.000Z",
    completedAt: null,
  };
}

function resetRuntime() {
  runtime.ApiClient.mockClear();
  for (const mock of Object.values(runtime.api)) mock.mockReset();
  runtime.view.send.mockReset();
  runtime.view.runs.mockReset().mockReturnValue([]);
  runtime.view.on.mockReset().mockReturnValue(() => undefined);
  runtime.session.cancel.mockReset().mockResolvedValue(undefined);
  runtime.session.on.mockReset().mockReturnValue(() => undefined);
  runtime.chat.messages = [];
  runtime.chat.sendMessage.mockReset().mockResolvedValue(undefined);
  runtime.chat.stop.mockReset().mockResolvedValue(undefined);
  runtime.chat.addToolApprovalResponse.mockReset().mockResolvedValue(undefined);
  runtime.chat.status = "ready";
  runtime.chatInit.current = null;
  runtime.uploadFileViaSignedUrl.mockReset().mockResolvedValue({
    mediaAssetId: "00000000-0000-4000-8000-000000000070",
    variantId: "00000000-0000-4000-8000-000000000072",
    storageKey: "studio-agent/reference.webp",
    url: "https://media.example.test/reference.webp",
  });

  runtime.api.createRealtimeGrant.mockResolvedValue({
    channel: CHANNEL_NAME,
    ttlMs: 300_000,
    tokenRequest: {
      keyName: "app.key",
      mac: "mac",
      nonce: "nonce",
      capability: `{"${CHANNEL_NAME}":["subscribe","publish","history"]}`,
      timestamp: 1,
    },
  });
  runtime.api.resolveThread.mockResolvedValue({
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    thread: thread(),
    created: false,
  });
  runtime.api.getSnapshot.mockResolvedValue(
    snapshot({ messages: [historyMessage(HISTORY_MESSAGE_ID, 1, "Rewrite chapter one.")] })
  );
  runtime.api.registerAttachment.mockResolvedValue({
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    attachment: canonicalAttachment,
    created: true,
  });
  runtime.api.deleteAttachment.mockResolvedValue({
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    attachmentId: canonicalAttachment.attachmentId,
    cleanupStatus: "scheduled",
  });
}

/** Put an active run on the wire, the way `ai-run-start` does. */
function liveRun() {
  runtime.view.runs.mockReturnValue([
    { runId: RUN_ID, clientId: "client", invocationId: "invocation", steps: [], status: "active" },
  ]);
}

/** An assistant turn holding one approval the creator has answered. */
function assistantWithAnsweredApproval() {
  return {
    id: "assistant-1",
    role: "assistant" as const,
    parts: [
      {
        type: "tool-story.canvas.write",
        toolCallId: "call-1",
        state: "approval-responded",
        input: { sceneId: "scene-1" },
        approval: { id: "approval-1", approved: true },
      },
    ],
  };
}

/** The same turn before the creator answered. */
function assistantWithPendingApproval() {
  return {
    id: "assistant-1",
    role: "assistant" as const,
    parts: [
      {
        type: "tool-story.canvas.write",
        toolCallId: "call-1",
        state: "approval-requested",
        input: { sceneId: "scene-1" },
        approval: { id: "approval-1" },
      },
    ],
  };
}

function endRun() {
  runtime.view.runs.mockReturnValue([
    {
      runId: RUN_ID,
      clientId: "client",
      invocationId: "invocation",
      steps: [],
      status: "complete",
    },
  ]);
  emitRunChange();
}

/**
 * What makes a `runs()` change visible.
 *
 * The hook subscribes to the view and re-reads on notification; swapping the
 * mock's return value alone changes nothing it can see, so a test that forgets
 * this asserts against the PREVIOUS run list and passes for the wrong reason.
 */
function emitRunChange() {
  for (const call of runtime.view.on.mock.calls) {
    const [event, handler] = call as unknown as [string, () => void];
    if (event === "run") handler();
  }
}

function createBootstrap(
  overrides: Partial<StoryStudioAgentBootstrap> = {}
): StoryStudioAgentBootstrap {
  return {
    projectId: "project-1",
    chapterId: "chapter-1",
    workspaceId: "workspace-1",
    status: "ready",
    error: null,
    thread: thread() as unknown as StoryStudioAgentBootstrap["thread"],
    history: {
      messages: [],
      messageIds: new Set<string>(),
      runs: [],
      activities: [],
      approvals: [],
      writeToken: "",
      writtenNodeIds: [],
    },
    conversationKey: `${THREAD_ID}:0`,
    realtime: { client: null, channelName: CHANNEL_NAME, status: "connected", error: null },
    hasEarlierTurns: false,
    loadingEarlierTurns: false,
    policyUpdating: false,
    commandError: null,
    clearCommandError: vi.fn(),
    reportCommandError: vi.fn(),
    retry: vi.fn(),
    loadEarlierTurns: vi.fn().mockResolvedValue(undefined),
    refreshControlPlane: vi.fn(),
    buildInvocation: vi.fn(
      (input: Parameters<StoryStudioAgentBootstrap["buildInvocation"]>[0]) => ({
        threadId: THREAD_ID,
        clientMessageId: input.clientMessageId,
        parts: input.parts,
        targetRunId: input.targetRunId,
        delivery: input.delivery,
        scope: {
          workspaceId: "workspace-1",
          container: {
            resourceType: "story.project" as const,
            resourceId: "project-1",
            revision: null,
          },
          focus: null,
        },
        locale: "en-US",
      })
    ),
    submitInvocation: vi.fn().mockResolvedValue(undefined),
    requestDurableCancel: vi.fn().mockResolvedValue(undefined),
    overlayRef: { current: [] },
    uploadAttachment: vi.fn(),
    updatePermissionMode: vi.fn(),
    resolveApproval: vi.fn(),
    ...overrides,
  } as StoryStudioAgentBootstrap;
}

function thread() {
  const permissionPolicy = {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    policyId: "00000000-0000-4000-8000-000000000020",
    revision: 1,
    mode: "smart" as const,
    rules: [],
    createdAt: "2026-07-24T12:00:00.000Z",
  };
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    threadId: THREAD_ID,
    surfaceId: "story.studio",
    scenario: { id: "story.studio.assistant", version: "1.0.0" },
    scope: {
      workspaceId: "workspace-1",
      container: { resourceType: "story.project", resourceId: "project-1", revision: null },
      focus: null,
    },
    title: null,
    ownerActorId: "actor-1",
    status: "active" as const,
    permissionPolicy,
    activeRunId: null,
    createdAt: "2026-07-24T12:00:00.000Z",
    updatedAt: "2026-07-24T12:00:00.000Z",
  };
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    thread: thread(),
    messages: [],
    runs: [],
    actions: [],
    approvals: [],
    inputs: [],
    activities: [],
    turnWindow: { earliestRootRunId: null, hasEarlier: false },
    latestEventSequence: 0,
    ...overrides,
  };
}

function historyMessage(messageId: string, ordinal: number, text: string) {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    messageId,
    clientMessageId: messageId,
    threadId: THREAD_ID,
    runId: null,
    ordinal,
    role: "user" as const,
    status: "completed" as const,
    parts: [{ type: "text" as const, format: "plain_text" as const, text }],
    createdAt: "2026-07-24T12:01:00.000Z",
    completedAt: "2026-07-24T12:01:00.000Z",
  };
}

const canonicalAttachment = {
  type: "attachment" as const,
  attachmentId: "00000000-0000-4000-8000-000000000071",
  fileName: "reference.webp",
  mediaType: "image/webp",
  sizeBytes: 5,
  status: "ready" as const,
};
