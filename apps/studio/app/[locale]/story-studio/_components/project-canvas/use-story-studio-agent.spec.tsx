// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { STUDIO_AGENT_SCHEMA_VERSION } from "@repo/shared";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError } from "@/lib/api";
import { StudioAgentSseHttpError } from "@/lib/studio-agent";

import { storyProjectionQueryKey } from "./story-canvas-edit-policy";
import type { StoryStudioAgentSession } from "./use-story-studio-agent";
import { useStoryStudioAgent } from "./use-story-studio-agent";

const runtime = vi.hoisted(() => {
  const api = {
    resolveThread: vi.fn(),
    getSnapshot: vi.fn(),
    getEventPage: vi.fn(),
    eventStreamUrl: vi.fn(
      (threadId: string, cursor: string | null) =>
        `/stream/${threadId}?afterSequence=${cursor ?? ""}`
    ),
    eventStreamHeaders: vi.fn(() => ({ "x-fizz-workspace-id": "workspace-1" })),
    submitMessage: vi.fn(),
    registerAttachment: vi.fn(),
    deleteAttachment: vi.fn(),
    updatePermissionPolicy: vi.fn(),
    resolveApproval: vi.fn(),
    cancelRun: vi.fn(),
  };
  const uploadFileViaSignedUrl = vi.fn();
  const stream = {
    start: vi.fn(),
    stop: vi.fn(),
    acknowledge: vi.fn(),
  };
  return {
    api,
    uploadFileViaSignedUrl,
    stream,
    streamOptions: null as Record<string, unknown> | null,
    ApiClient: vi.fn(function MockStudioAgentApiClient() {
      return api;
    }),
    SseClient: vi.fn(function MockStudioAgentSseClient(options: Record<string, unknown>) {
      runtime.streamOptions = options;
      return stream;
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
    StudioAgentSseClient: runtime.SseClient,
  };
});

describe("useStoryStudioAgent", () => {
  let container: HTMLDivElement;
  let root: Root;
  let session: StoryStudioAgentSession | null;
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    session = null;
    Object.values(runtime.api).forEach((mock) => {
      if (typeof mock === "function" && "mockClear" in mock) mock.mockClear();
    });
    runtime.stream.start.mockClear();
    runtime.stream.stop.mockClear();
    runtime.stream.acknowledge.mockClear();
    runtime.ApiClient.mockClear();
    runtime.SseClient.mockClear();
    runtime.streamOptions = null;
    window.sessionStorage.clear();
    runtime.api.resolveThread.mockResolvedValue({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      thread: thread(),
      created: false,
    });
    runtime.api.getSnapshot.mockResolvedValue({
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
    });
    runtime.api.getEventPage.mockResolvedValue({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      events: [],
      latestSequence: 0,
      hasMore: false,
    });
    runtime.uploadFileViaSignedUrl.mockResolvedValue({
      mediaAssetId: "00000000-0000-4000-8000-000000000070",
      variantId: "00000000-0000-4000-8000-000000000072",
      storageKey: "studio-agent/reference.webp",
      url: "https://media.example.test/reference.webp",
    });
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
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("resolves the exact story scope, replays to the advertised sequence, and opens SSE", async () => {
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
          container: {
            resourceType: "story.project",
            resourceId: "project-1",
            revision: null,
          },
          focus: {
            resourceType: "story.chapter",
            resourceId: "chapter-1",
            revision: null,
          },
        },
        locale: "zh-CN",
      }),
      expect.any(AbortSignal)
    );
    expect(runtime.api.getEventPage).toHaveBeenCalledWith(
      thread().threadId,
      0,
      500,
      expect.any(AbortSignal)
    );
    expect(runtime.SseClient).toHaveBeenCalledOnce();
    expect(runtime.stream.start).toHaveBeenCalledOnce();
  });

  it("rebuilds the session when the user retries after a failed load", async () => {
    runtime.api.resolveThread
      .mockRejectedValueOnce(new Error("Temporary gateway failure"))
      .mockResolvedValueOnce({
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        thread: thread(),
        created: false,
      });

    await render();
    await waitUntilError();

    await act(async () => {
      session!.retry();
    });
    await waitUntilReady();

    expect(runtime.api.resolveThread).toHaveBeenCalledTimes(2);
    expect(runtime.SseClient).toHaveBeenCalledOnce();
    expect(runtime.stream.start).toHaveBeenCalledOnce();
  });

  it("serializes rapid submit attempts so one gesture cannot create duplicate runs", async () => {
    await render();
    await waitUntilReady();

    let resolveSubmission!: (value: ReturnType<typeof submitResult>) => void;
    runtime.api.submitMessage.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSubmission = resolve;
        })
    );

    let first!: Promise<boolean>;
    let duplicate!: Promise<boolean>;
    await act(async () => {
      first = session!.submit("Start with the inciting incident", "send");
      duplicate = session!.submit("Start with the inciting incident", "send");
      await duplicate;
    });
    expect(runtime.api.submitMessage).toHaveBeenCalledOnce();

    await act(async () => {
      resolveSubmission(submitResult());
      await first;
    });
    expect(session?.submitting).toBe(false);
    expect(session?.activeRun?.id).toBe("00000000-0000-4000-8000-000000000030");
  });

  it("reuses the canonical submission id when the response is lost and the same intent retries", async () => {
    runtime.api.submitMessage
      .mockRejectedValueOnce(new ApiRequestError("NETWORK_ERROR", "Network connection failed", 0))
      .mockResolvedValueOnce(submitResult());
    await render();
    await waitUntilReady();

    await act(async () => {
      await expect(session!.submit("Start with the inciting incident", "send")).rejects.toThrow(
        "Network connection failed"
      );
    });
    const firstRequest = runtime.api.submitMessage.mock.calls[0]?.[1];

    await act(async () => {
      await session!.submit("Start with the inciting incident", "send");
    });
    const retryRequest = runtime.api.submitMessage.mock.calls[1]?.[1];

    expect(firstRequest).toEqual(retryRequest);
    expect(firstRequest.clientMessageId).toEqual(expect.any(String));
  });

  it("rotates the submission id when the user materially changes a failed intent", async () => {
    runtime.api.submitMessage
      .mockRejectedValueOnce(new ApiRequestError("NETWORK_ERROR", "Network connection failed", 0))
      .mockResolvedValueOnce(submitResult());
    await render();
    await waitUntilReady();

    await act(async () => {
      await expect(session!.submit("Draft A", "send")).rejects.toThrow("Network connection failed");
    });
    const firstRequest = runtime.api.submitMessage.mock.calls[0]?.[1];

    await act(async () => {
      await session!.submit("Draft B", "send");
    });
    const changedRequest = runtime.api.submitMessage.mock.calls[1]?.[1];

    expect(changedRequest.clientMessageId).not.toBe(firstRequest.clientMessageId);
    expect(changedRequest.parts).toEqual([{ type: "text", format: "plain_text", text: "Draft B" }]);
  });

  it("returns a thread-bound lease that idempotently abandons its canonical artifact", async () => {
    await render();
    await waitUntilReady();
    const file = new File(["image"], "reference.webp", { type: "image/webp" });
    const controller = new AbortController();
    const onProgress = vi.fn();

    const lease = await session!.uploadAttachment(file, {
      signal: controller.signal,
      onProgress,
    });

    expect(lease.attachment).toEqual(canonicalAttachment);
    await expect(lease.abandon()).resolves.toBeUndefined();
    await expect(lease.abandon()).resolves.toBeUndefined();

    expect(runtime.api.deleteAttachment).toHaveBeenCalledOnce();
    expect(runtime.api.deleteAttachment).toHaveBeenCalledWith(
      thread().threadId,
      canonicalAttachment.attachmentId
    );
    expect(runtime.uploadFileViaSignedUrl).toHaveBeenCalledWith(file, {
      kind: "studio_agent_image",
      workspaceId: "workspace-1",
      contentType: "image/webp",
      signal: controller.signal,
      onProgress,
    });
    expect(runtime.api.registerAttachment).toHaveBeenCalledWith(
      thread().threadId,
      {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        mediaAssetId: "00000000-0000-4000-8000-000000000070",
        fileName: "reference.webp",
      },
      controller.signal
    );
  });

  it("routes supported documents through the dedicated document upload channel", async () => {
    await render();
    await waitUntilReady();
    const file = new File(["# Outline"], "outline.md", { type: "text/markdown" });

    await session!.uploadAttachment(file, {
      signal: new AbortController().signal,
      onProgress: vi.fn(),
    });

    expect(runtime.uploadFileViaSignedUrl).toHaveBeenCalledWith(
      file,
      expect.objectContaining({
        kind: "studio_agent_document",
        contentType: "text/markdown",
      })
    );
  });

  it("best-effort abandons a registration that completes after its upload was cancelled", async () => {
    await render();
    await waitUntilReady();
    const file = new File(["image"], "reference.webp", { type: "image/webp" });
    const controller = new AbortController();
    let resolveRegistration!: (value: {
      schemaVersion: typeof STUDIO_AGENT_SCHEMA_VERSION;
      attachment: typeof canonicalAttachment;
      created: boolean;
    }) => void;
    runtime.api.registerAttachment.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRegistration = resolve;
        })
    );

    const upload = session!.uploadAttachment(file, {
      signal: controller.signal,
      onProgress: vi.fn(),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.api.registerAttachment).toHaveBeenCalledOnce();
    controller.abort();
    resolveRegistration({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      attachment: canonicalAttachment,
      created: true,
    });

    await expect(upload).rejects.toThrow(
      "The active Studio Agent conversation changed during registration."
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.api.deleteAttachment).toHaveBeenCalledWith(
      thread().threadId,
      canonicalAttachment.attachmentId
    );
  });

  it("submits an attachment-only turn without changing delivery semantics", async () => {
    runtime.api.submitMessage.mockResolvedValue(submitResult());
    await render();
    await waitUntilReady();

    await act(async () => {
      await session!.submit("", "send", [canonicalAttachment]);
    });

    expect(runtime.api.submitMessage).toHaveBeenCalledWith(thread().threadId, {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      clientMessageId: expect.any(String),
      parts: [canonicalAttachment],
      scope: {
        workspaceId: "workspace-1",
        container: {
          resourceType: "story.project",
          resourceId: "project-1",
          revision: null,
        },
        focus: {
          resourceType: "story.chapter",
          resourceId: "chapter-1",
          revision: null,
        },
      },
      locale: "zh-CN",
      targetRunId: null,
      delivery: null,
    });
  });

  it("resolves a persistent approval and its permission grant in one atomic command", async () => {
    runtime.api.getSnapshot.mockResolvedValue(snapshotWithPendingApproval());
    await render();
    await waitUntilReady();

    let completeResolution!: (value: ReturnType<typeof approvalResolutionResult>) => void;
    runtime.api.resolveApproval.mockImplementation(
      () =>
        new Promise((resolve) => {
          completeResolution = resolve;
        })
    );

    let first!: Promise<void>;
    let duplicate!: Promise<void>;
    await act(async () => {
      first = session!.resolveApproval(approvalId, "approved", true);
      duplicate = session!.resolveApproval(approvalId, "approved", true);
      await duplicate;
    });

    expect(runtime.api.updatePermissionPolicy).not.toHaveBeenCalled();
    expect(runtime.api.resolveApproval).toHaveBeenCalledOnce();
    expect(runtime.api.resolveApproval).toHaveBeenCalledWith(thread().threadId, approvalId, {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      decision: "approved",
      actionInputHash,
      note: null,
      persistentGrant: {
        expectedPolicyRevision: 1,
        capability: {
          id: "story.canvas.write",
          version: "1.2.0",
        },
      },
    });

    await act(async () => {
      completeResolution(approvalResolutionResult());
      await first;
    });

    expect(session?.thread?.permissionPolicy.revision).toBe(2);
    expect(session?.eventState.approvals[approvalId]).toMatchObject({
      status: "approved",
      capability: "story.canvas.write",
      capabilityVersion: "1.2.0",
    });
  });

  it("surfaces protocol ordering corruption and closes the live stream", async () => {
    await render();
    await waitUntilReady();
    const onEvents = runtime.streamOptions?.onEvents as
      | ((events: readonly ReturnType<typeof runStartedEvent>[]) => void)
      | undefined;
    expect(onEvents).toBeTypeOf("function");

    await act(async () => {
      onEvents?.([runStartedEvent("00000000-0000-4000-8000-000000000050")]);
      onEvents?.([runStartedEvent("00000000-0000-4000-8000-000000000051")]);
    });

    expect(runtime.stream.stop).toHaveBeenCalledOnce();
    expect(session?.streamError?.message).toContain("ordering became inconsistent");
  });

  it("invalidates the canvas projections when the agent applies a change-set", async () => {
    await render();
    await waitUntilReady();

    const workbenchKey = storyProjectionQueryKey(
      "workbench",
      "workspace-1",
      "project-1",
      "chapter-1"
    );
    const layoutKey = storyProjectionQueryKey(
      "canvas-layout",
      "workspace-1",
      "project-1",
      "chapter-1"
    );
    // Agent edits a chapter other than the one currently viewed — must still refetch.
    const otherChapterKey = storyProjectionQueryKey(
      "workbench",
      "workspace-1",
      "project-1",
      "chapter-9"
    );
    const unrelatedKey = ["story-studio", "current-release", "workspace-1", "project-1"] as const;
    queryClient.setQueryData(workbenchKey, { revision: 1 });
    queryClient.setQueryData(layoutKey, { revision: 1 });
    queryClient.setQueryData(otherChapterKey, { revision: 1 });
    queryClient.setQueryData(unrelatedKey, { ok: true });

    const onEvents = runtime.streamOptions?.onEvents as
      | ((events: readonly ReturnType<typeof changesetAppliedEvent>[]) => void)
      | undefined;
    expect(onEvents).toBeTypeOf("function");

    await act(async () => {
      onEvents?.([changesetAppliedEvent()]);
    });

    expect(queryClient.getQueryState(workbenchKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(layoutKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(otherChapterKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(unrelatedKey)?.isInvalidated).toBe(false);
    // A non-mutating event must not thrash the canvas.
    expect(session?.streamError).toBeNull();
  });

  it("raises the shared authentication flow when the live stream expires", async () => {
    await render();
    await waitUntilReady();
    const unauthorized = vi.fn();
    window.addEventListener("fizz:unauthorized", unauthorized);

    const onError = runtime.streamOptions?.onError as ((error: Error) => void) | undefined;
    await act(async () => {
      onError?.(new StudioAgentSseHttpError(401));
    });

    expect(unauthorized).toHaveBeenCalledOnce();
    window.removeEventListener("fizz:unauthorized", unauthorized);
  });

  it("requests only the live tail on load and mirrors the reported window", async () => {
    runtime.api.getSnapshot.mockResolvedValue(
      snapshotPage({ earliestRootRunId: EARLIEST_ROOT_RUN_ID, hasEarlier: true })
    );

    await render();
    await waitUntilReady();

    expect(runtime.api.getSnapshot).toHaveBeenCalledWith(thread().threadId, {
      signal: expect.any(AbortSignal),
    });
    expect(session!.hasEarlierTurns).toBe(true);
  });

  it("loads one earlier turn window at a time", async () => {
    runtime.api.getSnapshot.mockResolvedValue(
      snapshotPage({ earliestRootRunId: EARLIEST_ROOT_RUN_ID, hasEarlier: true })
    );
    await render();
    await waitUntilReady();
    runtime.api.getSnapshot.mockClear();

    await act(async () => {
      await Promise.all([session!.loadEarlierTurns(), session!.loadEarlierTurns()]);
    });

    expect(runtime.api.getSnapshot).toHaveBeenCalledTimes(1);
    expect(runtime.api.getSnapshot).toHaveBeenCalledWith(thread().threadId, {
      beforeRootRunId: EARLIEST_ROOT_RUN_ID,
      signal: expect.any(AbortSignal),
    });
  });

  it("discards an earlier page whose session generation was superseded", async () => {
    // The thread id is container-scoped, so a chapter switch resolves the SAME
    // thread. Guarding on it would splice turns from a discarded window into a
    // freshly reset transcript and leave a hole no cursor can fill.
    runtime.api.getSnapshot.mockResolvedValue(
      snapshotPage({ earliestRootRunId: EARLIEST_ROOT_RUN_ID, hasEarlier: true })
    );
    await render();
    await waitUntilReady();

    let releasePage: (() => void) | null = null;
    // The discarded page advertises a window the fresh session does not have,
    // so a merge is observable even without reaching into the record maps.
    runtime.api.getSnapshot.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releasePage = () =>
            resolve(
              snapshotPage({ earliestRootRunId: STALE_ROOT_RUN_ID, hasEarlier: true }, [
                historyMessage(STALE_MESSAGE_ID, 1, "from the discarded window"),
              ])
            );
        })
    );
    const pending = session!.loadEarlierTurns();
    // Guards the test itself: if the request never went out, the assertions
    // below would pass against a load that never happened.
    expect(runtime.api.getSnapshot).toHaveBeenCalledWith(thread().threadId, {
      beforeRootRunId: EARLIEST_ROOT_RUN_ID,
      signal: expect.any(AbortSignal),
    });

    runtime.api.getSnapshot.mockResolvedValue(
      snapshotPage({ earliestRootRunId: null, hasEarlier: false })
    );
    await render("chapter-2");
    await waitUntilReady();

    await act(async () => {
      releasePage?.();
      await pending;
    });

    expect(session!.eventState.messages[STALE_MESSAGE_ID]).toBeUndefined();
    expect(session!.hasEarlierTurns).toBe(false);
  });

  async function render(chapterId = "chapter-1") {
    await act(async () => {
      root.render(
        <NextIntlClientProvider locale="zh-CN" messages={{}}>
          <QueryClientProvider client={queryClient}>
            <Harness chapterId={chapterId} onSession={(value) => (session = value)} />
          </QueryClientProvider>
        </NextIntlClientProvider>
      );
    });
  }

  async function waitUntilReady() {
    for (let attempt = 0; attempt < 20 && session?.status !== "ready"; attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(session?.status).toBe("ready");
  }

  async function waitUntilError() {
    for (let attempt = 0; attempt < 20 && session?.status !== "error"; attempt += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
    expect(session?.status).toBe("error");
  }
});

function Harness({
  onSession,
  chapterId = "chapter-1",
}: {
  onSession: (session: StoryStudioAgentSession) => void;
  chapterId?: string;
}) {
  const session = useStoryStudioAgent({
    projectId: "project-1",
    chapterId,
    workspaceId: "workspace-1",
  });
  onSession(session);
  return null;
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
    threadId: "00000000-0000-4000-8000-000000000001",
    surfaceId: "story.studio",
    scenario: { id: "story.studio.assistant", version: "1.0.0" },
    scope: {
      workspaceId: "workspace-1",
      container: {
        resourceType: "story.project",
        resourceId: "project-1",
        revision: null,
      },
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

function submitResult() {
  const messageId = "00000000-0000-4000-8000-000000000029";
  const runId = "00000000-0000-4000-8000-000000000030";
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    message: {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      messageId,
      clientMessageId: "00000000-0000-4000-8000-000000000028",
      threadId: thread().threadId,
      runId,
      ordinal: 1,
      role: "user" as const,
      status: "accepted" as const,
      parts: [
        {
          type: "text" as const,
          format: "plain_text" as const,
          text: "Start with the inciting incident",
        },
      ],
      createdAt: "2026-07-24T12:01:00.000Z",
      completedAt: null,
    },
    run: {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      runId,
      threadId: thread().threadId,
      rootRunId: runId,
      parentRunId: null,
      kind: "turn" as const,
      task: null,
      trigger: "message" as const,
      triggerMessageId: messageId,
      scenario: { id: "story.studio.assistant", version: "1.0.0" },
      permissionPolicy: thread().permissionPolicy,
      status: "queued" as const,
      phase: null,
      createdAt: "2026-07-24T12:01:00.000Z",
      startedAt: null,
      completedAt: null,
      error: null,
    },
    input: null,
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

function changesetAppliedEvent() {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    eventId: "00000000-0000-4000-8000-000000000060",
    threadId: thread().threadId,
    runId: "00000000-0000-4000-8000-000000000052",
    rootRunId: "00000000-0000-4000-8000-000000000052",
    parentRunId: null,
    sequence: 1,
    occurredAt: "2026-07-24T12:03:00.000Z",
    type: "changeset.applied" as const,
    payload: {
      changeSetId: "00000000-0000-4000-8000-000000000061",
      actionId: "00000000-0000-4000-8000-000000000062",
      revisions: [
        {
          resourceType: "story.draft",
          resourceId: "project-1",
          revision: "2",
        },
      ],
      appliedAt: "2026-07-24T12:03:00.000Z",
    },
  };
}

function runStartedEvent(eventId: string) {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    eventId,
    threadId: thread().threadId,
    runId: "00000000-0000-4000-8000-000000000052",
    rootRunId: "00000000-0000-4000-8000-000000000052",
    parentRunId: null,
    sequence: 1,
    occurredAt: "2026-07-24T12:02:00.000Z",
    type: "run.started" as const,
    payload: { startedAt: "2026-07-24T12:02:00.000Z" },
  };
}

const actionId = "00000000-0000-4000-8000-000000000060";
const approvalId = "00000000-0000-4000-8000-000000000061";
const approvalRunId = "00000000-0000-4000-8000-000000000062";
const actionInputHash = "a".repeat(64);

function snapshotWithPendingApproval() {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    thread: thread(),
    messages: [],
    runs: [],
    actions: [
      {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        actionId,
        threadId: thread().threadId,
        runId: approvalRunId,
        capability: {
          id: "story.canvas.write",
          version: "1.2.0",
        },
        effect: "write" as const,
        risk: "medium" as const,
        status: "waiting_for_approval" as const,
        title: "Update story canvas",
        summary: "Apply the proposed story changes.",
        target: null,
        input: {},
        inputHash: actionInputHash,
        approvalId,
        idempotencyKey: null,
        output: null,
        error: null,
        createdAt: "2026-07-24T12:03:00.000Z",
        startedAt: null,
        completedAt: null,
      },
    ],
    approvals: [pendingApproval()],
    inputs: [],
    activities: [],
    turnWindow: { earliestRootRunId: null, hasEarlier: false },
    latestEventSequence: 0,
  };
}

function pendingApproval() {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    approvalId,
    threadId: thread().threadId,
    runId: approvalRunId,
    actionId,
    status: "pending" as const,
    reason: "The story canvas will be changed.",
    actionInputHash,
    requestedAt: "2026-07-24T12:03:01.000Z",
    expiresAt: null,
    decision: null,
  };
}

function approvalResolutionResult() {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    approval: {
      ...pendingApproval(),
      status: "approved" as const,
      decision: {
        decision: "approved" as const,
        actorId: "actor-1",
        note: null,
        decidedAt: "2026-07-24T12:03:02.000Z",
      },
    },
    permissionPolicy: {
      ...thread().permissionPolicy,
      revision: 2,
      rules: [
        {
          ruleId: approvalId,
          priority: 1_000,
          selector: {
            scenarioId: "story.studio.assistant",
            capabilityId: "story.canvas.write",
            capabilityVersion: "1.2.0",
            resourceType: null,
            effect: "write" as const,
            risk: "medium" as const,
          },
          decision: "allow" as const,
        },
      ],
    },
  };
}

const EARLIEST_ROOT_RUN_ID = "019f8d30-0000-7000-8000-000000000001";
const STALE_MESSAGE_ID = "019f8d30-0000-7000-8000-000000000002";
const STALE_ROOT_RUN_ID = "019f8d30-0000-7000-8000-000000000003";

function snapshotPage(
  turnWindow: { earliestRootRunId: string | null; hasEarlier: boolean },
  messages: ReturnType<typeof historyMessage>[] = []
) {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    thread: thread(),
    messages,
    runs: [],
    actions: [],
    approvals: [],
    inputs: [],
    activities: [],
    turnWindow,
    latestEventSequence: 0,
  };
}

function historyMessage(messageId: string, ordinal: number, text: string) {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    messageId,
    clientMessageId: null,
    threadId: thread().threadId,
    runId: null,
    ordinal,
    role: "user" as const,
    status: "completed" as const,
    parts: [{ type: "text" as const, format: "plain_text" as const, text }],
    createdAt: "2026-07-24T12:00:00.000Z",
    completedAt: "2026-07-24T12:00:00.000Z",
  };
}
