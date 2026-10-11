import { afterEach, describe, expect, it, vi } from "vitest";

import { EventJournal } from "./event-journal.js";
import { LangGraphRunService, type LangGraphRunSnapshot } from "./langgraph-run-service.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const TURN_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_CONVERSATION_ID = "44444444-4444-4444-8444-444444444444";
const originalFetch = globalThis.fetch;
const originalDomainUrl = process.env.AGENT_OS_DOMAIN_URL;
const originalToken = process.env.AGENT_OS_INTERNAL_TOKEN;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalDomainUrl === undefined) delete process.env.AGENT_OS_DOMAIN_URL;
  else process.env.AGENT_OS_DOMAIN_URL = originalDomainUrl;
  if (originalToken === undefined) delete process.env.AGENT_OS_INTERNAL_TOKEN;
  else process.env.AGENT_OS_INTERNAL_TOKEN = originalToken;
  vi.restoreAllMocks();
});

describe("LangGraph journal persistence", () => {
  it("keeps token-protected standalone cancellation independent of a Gateway", async () => {
    delete process.env.AGENT_OS_DOMAIN_URL;
    process.env.AGENT_OS_INTERNAL_TOKEN = "internal-test-token";
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const service = new LangGraphRunService();
    const journal = new EventJournal();
    const runtime = service as unknown as { snapshots: Map<string, LangGraphRunSnapshot> };
    runtime.snapshots.set(RUN_ID, {
      runId: RUN_ID,
      activeTurnId: TURN_ID,
      status: "running",
      journal,
      projectId: "project-1",
      actorId: "actor-1",
      conversationId: CONVERSATION_ID,
      modelProfileId: "qwen3.7-plus",
    });
    const cancelled = await service.cancel(RUN_ID, "Stopped");
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.journal.all().map((event) => event.type)).toEqual(["RunCancelled"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    { status: "cancelled", live: false },
    { status: "completed", live: false },
    { status: "cancelled", live: true },
    { status: "completed", live: true },
  ] as const)(
    "adopts the Gateway's $status journal on Stop (live=$live) without a competing suffix",
    async ({ status, live }) => {
      process.env.AGENT_OS_DOMAIN_URL = "http://gateway.test";
      process.env.AGENT_OS_INTERNAL_TOKEN = "internal-test-token";
      const journal = new EventJournal();
      journal.append({
        sessionId: `agent-os:v1:conversation:${CONVERSATION_ID}`,
        runId: RUN_ID,
        conversationId: CONVERSATION_ID,
        type: "RunStarted",
        data: {
          turnId: TURN_ID,
          status: "running",
          workspaceType: "project_canvas",
          modelProfileId: "qwen3.7-plus",
        },
      });
      journal.append({
        sessionId: `agent-os:v1:conversation:${CONVERSATION_ID}`,
        runId: RUN_ID,
        conversationId: CONVERSATION_ID,
        type: status === "cancelled" ? "RunCancelled" : "RunCompleted",
        data: {
          turnId: TURN_ID,
          status,
          ...(status === "cancelled"
            ? {
                error: { code: "RUN_CANCELLED", message: "user_stop", retryable: false },
              }
            : {}),
        },
      });
      const fetchMock = vi.fn(async (_url, init) => {
        expect(init?.method).not.toBe("POST");
        return Response.json({
          ok: true,
          status,
          events: journal.all(),
          assistantText: "Planning",
        });
      });
      globalThis.fetch = fetchMock;
      const service = new LangGraphRunService();
      const controller = new AbortController();
      if (live) {
        const local = new EventJournal();
        local.restore(journal.all().slice(0, 1));
        const runtime = service as unknown as {
          snapshots: Map<string, LangGraphRunSnapshot>;
          aborts: Map<string, AbortController>;
        };
        runtime.snapshots.set(RUN_ID, {
          runId: RUN_ID,
          conversationId: CONVERSATION_ID,
          status: "running",
          journal: local,
          assistantText: "Stale local fragment",
        });
        runtime.aborts.set(RUN_ID, controller);
      }
      // Concurrent notification and graph abort handlers join one read. A
      // restarted Worker adopts the same result without a local snapshot.
      const [result, joined] = await Promise.all([
        service.cancel(RUN_ID, "user_stop"),
        service.cancel(RUN_ID, "user_stop"),
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(joined).toBe(result);
      if (live) expect(controller.signal.aborted).toBe(true);
      expect(result?.status).toBe(status);
      expect(result?.journal.all()).toEqual(journal.all());
      expect(service.getSnapshot(RUN_ID)?.status).toBe(status);
      const replay = await service.cancel(RUN_ID, "user_stop");
      expect(replay?.journal.all()).toEqual(journal.all());
    }
  );

  it.each(["uncommitted", "unavailable", "wrong_run", "incomplete", "sequence_gap"])(
    "does not invent a cancellation when the authoritative read is %s",
    async (outcome) => {
      process.env.AGENT_OS_DOMAIN_URL = "http://gateway.test";
      process.env.AGENT_OS_INTERNAL_TOKEN = "internal-test-token";
      const journal = new EventJournal();
      journal.append({
        sessionId: `agent-os:v1:conversation:${CONVERSATION_ID}`,
        runId: outcome === "wrong_run" ? OTHER_CONVERSATION_ID : RUN_ID,
        conversationId: CONVERSATION_ID,
        type: "RunStarted",
        data: {
          turnId: TURN_ID,
          status: "running",
          workspaceType: "project_canvas",
          modelProfileId: "qwen3.7-plus",
        },
      });
      const events = journal
        .all()
        .map((event) => ({ ...event, sequence: outcome === "sequence_gap" ? 2 : event.sequence }));
      const fetchMock = vi.fn(async (_url, init) => {
        expect(init?.method).not.toBe("POST");
        return outcome === "unavailable"
          ? new Response(null, { status: 503 })
          : Response.json({
              ok: true,
              status: outcome === "uncommitted" ? "running" : "cancelled",
              events,
            });
      });
      globalThis.fetch = fetchMock;
      const service = new LangGraphRunService();
      await expect(service.cancel(RUN_ID)).rejects.toThrow();
      expect(service.getSnapshot(RUN_ID)).toBeUndefined();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  );

  it("serializes full snapshots for the same run so an older write cannot win", async () => {
    process.env.AGENT_OS_DOMAIN_URL = "http://gateway.test";
    process.env.AGENT_OS_INTERNAL_TOKEN = "internal-test-token";
    let releaseFirst!: () => void;
    const firstMayFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const requestBodies: Array<{ events: unknown[]; lastSequence: number; status: string }> = [];
    globalThis.fetch = vi.fn(async (_url, init) => {
      requestBodies.push(JSON.parse(String(init?.body)));
      if (requestBodies.length === 1) await firstMayFinish;
      return new Response(null, { status: 204 });
    });

    const journal = new EventJournal();
    journal.append({
      sessionId: `agent-os:v1:conversation:${CONVERSATION_ID}`,
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      type: "RunStarted",
      data: {
        turnId: TURN_ID,
        status: "running",
        workspaceType: "project_canvas",
        modelProfileId: "creative-balanced",
      },
    });
    const snapshot: LangGraphRunSnapshot = {
      runId: RUN_ID,
      activeTurnId: TURN_ID,
      status: "running",
      journal,
      projectId: "project-1",
      actorId: "actor-1",
      conversationId: CONVERSATION_ID,
      modelProfileId: "creative-balanced",
    };
    const service = new LangGraphRunService();
    const persist = (
      service as unknown as {
        persist(value: LangGraphRunSnapshot): Promise<void>;
      }
    ).persist.bind(service);

    const firstWrite = persist(snapshot);
    await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    journal.append({
      sessionId: `agent-os:v1:conversation:${CONVERSATION_ID}`,
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      type: "RunCompleted",
      data: { turnId: TURN_ID, status: "completed" },
    });
    const secondWrite = persist({ ...snapshot, status: "completed" });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    releaseFirst();
    await Promise.all([firstWrite, secondWrite]);

    expect(requestBodies.map((body) => body.events.length)).toEqual([1, 2]);
    expect(requestBodies.map((body) => body.lastSequence)).toEqual([1, 2]);
    expect(requestBodies.map((body) => body.status)).toEqual(["running", "completed"]);
  });

  it("fails closed on a rejected Gateway write and lets the same run retry", async () => {
    process.env.AGENT_OS_DOMAIN_URL = "http://gateway.test";
    process.env.AGENT_OS_INTERNAL_TOKEN = "internal-test-token";
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    let attempt = 0;
    globalThis.fetch = vi.fn(async () => {
      attempt += 1;
      return new Response(null, { status: attempt === 1 ? 503 : 204 });
    });

    const journal = new EventJournal();
    journal.append({
      sessionId: `agent-os:v1:conversation:${CONVERSATION_ID}`,
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      type: "RunStarted",
      data: {
        turnId: TURN_ID,
        status: "running",
        workspaceType: "project_canvas",
        modelProfileId: "creative-balanced",
      },
    });
    const snapshot: LangGraphRunSnapshot = {
      runId: RUN_ID,
      activeTurnId: TURN_ID,
      status: "running",
      journal,
      projectId: "project-1",
      actorId: "actor-1",
      conversationId: CONVERSATION_ID,
      modelProfileId: "creative-balanced",
    };
    const service = new LangGraphRunService();
    const persist = (
      service as unknown as {
        persist(value: LangGraphRunSnapshot): Promise<void>;
      }
    ).persist.bind(service);

    await expect(persist(snapshot)).rejects.toThrow(/HTTP 503/);
    await expect(persist(snapshot)).resolves.toEqual({});
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("makes concurrent responseId retries await one durable acknowledgement", async () => {
    process.env.AGENT_OS_DOMAIN_URL = "http://gateway.test";
    process.env.AGENT_OS_INTERNAL_TOKEN = "internal-test-token";
    let releasePersist!: () => void;
    const mayPersist = new Promise<void>((resolve) => {
      releasePersist = resolve;
    });
    globalThis.fetch = vi.fn(async () => {
      await mayPersist;
      return new Response(null, { status: 204 });
    });

    const requestId = "44444444-4444-4444-8444-444444444444";
    const responseId = "55555555-5555-4555-8555-555555555555";
    const journal = new EventJournal();
    journal.append({
      sessionId: `agent-os:v1:conversation:${CONVERSATION_ID}`,
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      type: "RunStarted",
      data: {
        turnId: TURN_ID,
        status: "running",
        workspaceType: "project_canvas",
        modelProfileId: "creative-balanced",
      },
    });
    const pendingInput = {
      kind: "user_input" as const,
      requestId,
      turnId: TURN_ID,
      toolCallId: "tool-input-1",
      leadIn: "Choose a frame.",
      resumeAcknowledgement: "Thanks — I have the frame and will continue.",
      questions: [
        {
          id: "aspect_ratio",
          header: "Aspect ratio",
          question: "Which frame?",
          options: [
            { value: "portrait_9_16", label: "9:16 portrait" },
            { value: "landscape_16_9", label: "16:9 landscape" },
          ],
        },
      ],
    };
    journal.append({
      sessionId: `agent-os:v1:conversation:${CONVERSATION_ID}`,
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      type: "UserInputRequired",
      data: {
        turnId: TURN_ID,
        requestId,
        toolCallId: pendingInput.toolCallId,
        resumeAcknowledgement: pendingInput.resumeAcknowledgement,
        questions: pendingInput.questions,
      },
    });
    const service = new LangGraphRunService();
    const runGraphTurn = vi.fn(async () => undefined);
    const internals = service as unknown as {
      snapshots: Map<string, LangGraphRunSnapshot>;
      runGraphTurn: (input: unknown) => Promise<void>;
    };
    internals.runGraphTurn = runGraphTurn;
    internals.snapshots.set(RUN_ID, {
      runId: RUN_ID,
      activeTurnId: TURN_ID,
      status: "waiting_for_input",
      journal,
      pendingUserInput: pendingInput,
      projectId: "project-1",
      actorId: "actor-1",
      conversationId: CONVERSATION_ID,
      modelProfileId: "creative-balanced",
      projectKind: "story",
      workbenchMode: "story",
      skillMountSnapshot: {
        resolutionId: "66666666-6666-4666-8666-666666666666",
        skills: [],
      } as never,
    });
    const input = {
      runId: RUN_ID,
      sessionId: `agent-os:v1:conversation:${CONVERSATION_ID}`,
      conversationId: CONVERSATION_ID,
      requestId,
      responseId,
      answers: { aspect_ratio: "landscape_16_9" },
      modelProfileId: "creative-balanced",
      model: {} as never,
      domain: {} as never,
      checkpointer: {} as never,
      projectKind: "story" as const,
      workbenchMode: "story",
      projectId: "project-1",
      actorId: "actor-1",
    };

    const first = service.beginResumeUserInput(input);
    const duplicate = service.beginResumeUserInput(input);
    let duplicateSettled = false;
    void duplicate.then(
      () => {
        duplicateSettled = true;
      },
      () => {
        duplicateSettled = true;
      }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(duplicateSettled).toBe(false);

    releasePersist();
    await Promise.all([first, duplicate]);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    // The response worker only admits the durable continuation. A separately
    // leased dispatcher owns graph execution, so a crash after this return
    // cannot orphan the answer or double-resume the checkpoint.
    expect(runGraphTurn).not.toHaveBeenCalled();
    expect(service.getSnapshot(RUN_ID)?.continuationCommand).toMatchObject({
      kind: "user_input",
      requestId,
      responseId,
    });
    expect(journal.all().filter((event) => event.type === "UserInputResolved")).toHaveLength(1);
    expect(journal.all().filter((event) => event.type === "RunFailed")).toHaveLength(0);
  });

  it("persists one approval turn and one acknowledgement for concurrent retries", async () => {
    process.env.AGENT_OS_DOMAIN_URL = "http://gateway.test";
    process.env.AGENT_OS_INTERNAL_TOKEN = "internal-test-token";
    let releasePersist!: () => void;
    const mayPersist = new Promise<void>((resolve) => {
      releasePersist = resolve;
    });
    globalThis.fetch = vi.fn(async () => {
      await mayPersist;
      return new Response(null, { status: 204 });
    });

    const approvalId = "44444444-4444-4444-8444-444444444444";
    const responseId = "55555555-5555-4555-8555-555555555555";
    const journal = new EventJournal();
    const sessionId = `agent-os:v1:conversation:${CONVERSATION_ID}`;
    journal.append({
      sessionId,
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      type: "RunStarted",
      data: {
        turnId: TURN_ID,
        status: "running",
        workspaceType: "story",
        modelProfileId: "creative-balanced",
      },
    });
    journal.append({
      sessionId,
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      type: "ToolProposed",
      data: {
        turnId: TURN_ID,
        toolCallId: "tool-approval-1",
        toolId: "characters.upsert",
        arguments: { characters: [] },
        risk: "sensitive",
      },
    });
    journal.append({
      sessionId,
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      type: "ApprovalRequired",
      data: {
        turnId: TURN_ID,
        approvalId,
        toolCallId: "tool-approval-1",
        title: "Apply character changes",
        description: "Writes characters to the project.",
        reversible: false,
        actions: ["approve", "reject"],
      },
    });
    journal.append({
      sessionId,
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      type: "RunPaused",
      data: { turnId: TURN_ID, status: "waiting_for_approval" },
    });

    const service = new LangGraphRunService();
    const runGraphTurn = vi.fn(async () => undefined);
    const internals = service as unknown as {
      snapshots: Map<string, LangGraphRunSnapshot>;
      runGraphTurn: (input: unknown) => Promise<void>;
    };
    internals.runGraphTurn = runGraphTurn;
    internals.snapshots.set(RUN_ID, {
      runId: RUN_ID,
      activeTurnId: TURN_ID,
      status: "waiting_for_approval",
      journal,
      pendingApproval: {
        kind: "tool_approval",
        approvalId,
        turnId: TURN_ID,
        toolCallId: "tool-approval-1",
        toolId: "characters.upsert",
        arguments: { characters: [] },
        title: "Apply character changes",
        description: "Writes characters to the project.",
      },
      projectId: "project-1",
      actorId: "actor-1",
      conversationId: CONVERSATION_ID,
      modelProfileId: "creative-balanced",
      projectKind: "story",
      workbenchMode: "story",
      skillMountSnapshot: {
        resolutionId: "66666666-6666-4666-8666-666666666666",
        skills: [],
      } as never,
    });
    const input = {
      runId: RUN_ID,
      sessionId,
      conversationId: CONVERSATION_ID,
      approvalId,
      responseId,
      decision: "approve" as const,
      responseText: "已批准",
      locale: "zh-CN" as const,
      modelProfileId: "creative-balanced",
      model: {} as never,
      domain: {} as never,
      checkpointer: {} as never,
      projectKind: "story" as const,
      workbenchMode: "story",
      projectId: "project-1",
      actorId: "actor-1",
    };

    const first = service.beginResumeApproval(input);
    const duplicate = service.beginResumeApproval(input);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(runGraphTurn).not.toHaveBeenCalled();

    releasePersist();
    await Promise.all([first, duplicate]);
    expect(runGraphTurn).not.toHaveBeenCalled();
    expect(service.getSnapshot(RUN_ID)?.continuationCommand).toMatchObject({
      kind: "approval",
      approvalId,
      responseId,
    });
    expect(journal.all().filter((event) => event.type === "ApprovalResolved")).toHaveLength(1);
    expect(journal.all().filter((event) => event.type === "RunFailed")).toHaveLength(0);
    expect(
      journal
        .all()
        .filter(
          (event) => event.type === "MessageStarted" && event.data.segmentKind === "acknowledgement"
        )
    ).toHaveLength(1);
    const userDecision = journal.all().find((event) => event.type === "UserMessage");
    const acknowledgement = journal
      .all()
      .find(
        (event) =>
          event.type === "MessageCompleted" &&
          event.data.text === "已收到你的批准，我会继续执行此操作。"
      );
    expect(acknowledgement?.data.turnId).toBe(userDecision?.data.turnId);

    await expect(
      service.beginResumeApproval({
        ...input,
        responseText: "Approved",
        locale: "en-US",
      })
    ).rejects.toThrow(/different approval/);

    await expect(
      service.beginResumeApproval({
        ...input,
        responseId: "77777777-7777-4777-8777-777777777777",
      })
    ).rejects.toThrow(/already answered/);
  });

  it("accepts an exactly-correlated control-plane external handoff after journal divergence", async () => {
    process.env.AGENT_OS_DOMAIN_URL = "http://gateway.test";
    process.env.AGENT_OS_INTERNAL_TOKEN = "internal-test-token";
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const snapshot = waitingExternalSnapshot(EXTERNAL_JOB_ID);
    const localEventId = snapshot.journal.all()[0]!.id;
    globalThis.fetch = vi.fn(async (_input, init) => {
      if (init?.method === "POST") {
        return new Response(JSON.stringify({ code: "AGENT_OS_JOURNAL_DIVERGED" }), {
          status: 409,
        });
      }
      return new Response(JSON.stringify(durableExternalJournal(EXTERNAL_JOB_ID)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const service = new LangGraphRunService();
    const persistUntilAccepted = (
      service as unknown as {
        persistUntilAccepted(value: LangGraphRunSnapshot, reason: string): Promise<void>;
      }
    ).persistUntilAccepted.bind(service);

    await expect(persistUntilAccepted(snapshot, "external_handoff")).resolves.toBeUndefined();

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(snapshot.status).toBe("waiting_for_external");
    expect(snapshot.journal.all()[0]!.id).not.toBe(localEventId);
    expect(snapshot.journal.all()[0]!.id).toBe(DURABLE_EXTERNAL_EVENT_ID);
    expect(service.getSnapshot(RUN_ID)).toBe(snapshot);
  });

  it("rejects a divergent control-plane handoff with different correlation", async () => {
    process.env.AGENT_OS_DOMAIN_URL = "http://gateway.test";
    process.env.AGENT_OS_INTERNAL_TOKEN = "internal-test-token";
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const mismatches = [
      { jobId: OTHER_EXTERNAL_JOB_ID },
      { turnId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
      { toolCallId: "different-story-author-call" },
      { toolId: "story.other" },
    ];

    for (const mismatch of mismatches) {
      const snapshot = waitingExternalSnapshot(EXTERNAL_JOB_ID);
      const originalJournal = snapshot.journal;
      globalThis.fetch = vi.fn(async (_input, init) => {
        if (init?.method === "POST") {
          return new Response(JSON.stringify({ code: "AGENT_OS_JOURNAL_DIVERGED" }), {
            status: 409,
          });
        }
        return new Response(JSON.stringify(durableExternalJournal(EXTERNAL_JOB_ID, mismatch)), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });
      const service = new LangGraphRunService();
      const persistUntilAccepted = (
        service as unknown as {
          persistUntilAccepted(value: LangGraphRunSnapshot, reason: string): Promise<void>;
        }
      ).persistUntilAccepted.bind(service);

      await expect(persistUntilAccepted(snapshot, "external_handoff")).rejects.toThrow(/HTTP 409/);

      expect(globalThis.fetch).toHaveBeenCalledTimes(2);
      expect(snapshot.journal).toBe(originalJournal);
      expect(service.getSnapshot(RUN_ID)).toBeUndefined();
    }
  });

  it("returns an existing in-memory run for an identical durable-start retry", async () => {
    delete process.env.AGENT_OS_DOMAIN_URL;
    delete process.env.AGENT_OS_INTERNAL_TOKEN;
    globalThis.fetch = vi.fn();
    const service = new LangGraphRunService();
    const existing: LangGraphRunSnapshot = {
      runId: RUN_ID,
      activeTurnId: TURN_ID,
      status: "running",
      journal: new EventJournal(),
      conversationId: CONVERSATION_ID,
      projectId: "77777777-7777-4777-8777-777777777777",
      actorId: "actor-1",
      modelProfileId: "creative-balanced",
      startExecution: {
        ...startInput().startExecution,
        executionOwnerId: START_EXECUTION_OWNER_ID,
      },
    };
    (
      service as unknown as {
        snapshots: Map<string, LangGraphRunSnapshot>;
      }
    ).snapshots.set(RUN_ID, existing);

    const result = await service.beginDurableStart(startInput());

    expect(result).toBe(existing);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("replays a non-empty durable run after Worker restart without starting inference", async () => {
    process.env.AGENT_OS_DOMAIN_URL = "http://gateway.test";
    process.env.AGENT_OS_INTERNAL_TOKEN = "internal-test-token";
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            status: "completed",
            events: [durableEvent(1, "RunCompleted", { turnId: TURN_ID, status: "completed" })],
            pendingApproval: null,
            pendingUserInput: null,
            pendingExternal: null,
            assistantText: "The turn is already complete.",
            projectKind: "story",
            workbenchMode: "story",
            workbenchContext: null,
            skillMountSnapshot: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );
    const service = new LangGraphRunService();
    const beginStart = vi.spyOn(service, "beginStart");

    const result = await service.beginDurableStart(startInput());

    expect(beginStart).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      runId: RUN_ID,
      status: "completed",
      assistantText: "The turn is already complete.",
    });
    expect(result.journal.all()).toHaveLength(1);
  });

  it("never starts a queued row once any durable event exists", async () => {
    process.env.AGENT_OS_DOMAIN_URL = "http://gateway.test";
    process.env.AGENT_OS_INTERNAL_TOKEN = "internal-test-token";
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            status: "queued",
            events: [
              durableEvent(1, "RunStarted", {
                turnId: TURN_ID,
                status: "running",
                workspaceType: "story",
                modelProfileId: "creative-balanced",
              }),
            ],
            pendingApproval: null,
            pendingUserInput: null,
            pendingExternal: null,
            assistantText: null,
            projectKind: "story",
            workbenchMode: "story",
            workbenchContext: null,
            skillMountSnapshot: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );
    const service = new LangGraphRunService();
    const beginStart = vi.spyOn(service, "beginStart");

    const result = await service.beginDurableStart(startInput());

    expect(beginStart).not.toHaveBeenCalled();
    expect(result.status).toBe("queued");
    expect(result.journal.all()).toHaveLength(1);
  });

  it("serializes concurrent starts and launches only an empty queued reservation", async () => {
    process.env.AGENT_OS_DOMAIN_URL = "http://gateway.test";
    process.env.AGENT_OS_INTERNAL_TOKEN = "internal-test-token";
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            status: "queued",
            events: [
              durableEvent(1, "UserMessage", {
                turnId: TURN_ID,
                messageId: START_MESSAGE_ID,
                text: "Create an interactive story.",
              }),
            ],
            pendingApproval: null,
            pendingUserInput: null,
            pendingExternal: null,
            assistantText: null,
            projectKind: "story",
            workbenchMode: "story",
            workbenchContext: null,
            skillMountSnapshot: null,
            startExecutionPending: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );
    let releaseStart!: () => void;
    const mayStart = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const service = new LangGraphRunService();
    const started: LangGraphRunSnapshot = {
      runId: RUN_ID,
      activeTurnId: TURN_ID,
      status: "running",
      journal: new EventJournal(),
      conversationId: CONVERSATION_ID,
    };
    const beginStart = vi.spyOn(service, "beginStart").mockImplementation(async () => {
      await mayStart;
      return started;
    });

    const first = service.beginDurableStart(startInput());
    const duplicate = service.beginDurableStart(startInput());
    await vi.waitFor(() => expect(beginStart).toHaveBeenCalledTimes(1));
    releaseStart();

    const [firstResult, duplicateResult] = await Promise.all([first, duplicate]);
    expect(firstResult).toBe(started);
    expect(duplicateResult).toBe(started);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("fails closed when Gateway has no durable start reservation", async () => {
    process.env.AGENT_OS_DOMAIN_URL = "http://gateway.test";
    process.env.AGENT_OS_INTERNAL_TOKEN = "internal-test-token";
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, code: "RUN_NOT_FOUND" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    );
    const service = new LangGraphRunService();
    const beginStart = vi.spyOn(service, "beginStart");

    await expect(service.beginDurableStart(startInput())).rejects.toThrow(/no durable reservation/);
    expect(beginStart).not.toHaveBeenCalled();
  });

  it("refuses to replay a stale in-memory snapshot while the start execution is still pending", async () => {
    // An execution that died mid-turn leaves a `running` snapshot behind.
    // Answering the redispatch from it would make every retry a no-op and
    // strand the run on its admission prefix.
    process.env.AGENT_OS_DOMAIN_URL = "http://gateway.test";
    process.env.AGENT_OS_INTERNAL_TOKEN = "internal-test-token";
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            status: "running",
            events: [
              durableEvent(1, "UserMessage", {
                turnId: TURN_ID,
                messageId: START_MESSAGE_ID,
                text: "Create an interactive story.",
              }),
            ],
            pendingApproval: null,
            pendingUserInput: null,
            pendingExternal: null,
            assistantText: null,
            projectKind: "story",
            workbenchMode: "story",
            workbenchContext: null,
            skillMountSnapshot: null,
            startExecutionPending: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );
    const service = new LangGraphRunService();
    (
      service as unknown as {
        snapshots: Map<string, LangGraphRunSnapshot>;
      }
    ).snapshots.set(RUN_ID, {
      runId: RUN_ID,
      activeTurnId: TURN_ID,
      status: "running",
      journal: new EventJournal(),
      conversationId: CONVERSATION_ID,
      startExecution: {
        ...startInput().startExecution,
        executionOwnerId: START_EXECUTION_OWNER_ID,
      },
    });

    expect(await service.replayDurableStart(RUN_ID, CONVERSATION_ID)).toBeNull();
  });

  it("rejects a durable replay that belongs to another conversation", async () => {
    process.env.AGENT_OS_DOMAIN_URL = "http://gateway.test";
    process.env.AGENT_OS_INTERNAL_TOKEN = "internal-test-token";
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            status: "completed",
            events: [
              durableEvent(1, "RunCompleted", {
                turnId: TURN_ID,
                status: "completed",
              }),
            ],
            pendingApproval: null,
            pendingUserInput: null,
            pendingExternal: null,
            assistantText: "Done",
            projectKind: "story",
            workbenchMode: "story",
            workbenchContext: null,
            skillMountSnapshot: null,
            startExecutionPending: false,
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );

    const service = new LangGraphRunService();
    await expect(service.replayDurableStart(RUN_ID, OTHER_CONVERSATION_ID)).rejects.toThrow(
      `Agent OS run ${RUN_ID} does not belong to conversation ${OTHER_CONVERSATION_ID}`
    );
  });
});

const EXTERNAL_JOB_ID = "99999999-9999-4999-8999-999999999999";
const OTHER_EXTERNAL_JOB_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DURABLE_EXTERNAL_EVENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const EXTERNAL_TOOL_CALL_ID = "story-author-call-1";
const EXTERNAL_TOOL_ID = "story.author";
const START_SUBMISSION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const START_MESSAGE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const START_EXECUTION_TOKEN = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const START_EXECUTION_ATTEMPT_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const START_EXECUTION_OWNER_ID = "12121212-1212-4212-8212-121212121212";

function waitingExternalSnapshot(jobId: string): LangGraphRunSnapshot {
  const journal = new EventJournal();
  journal.append({
    sessionId: `agent-os:v1:conversation:${CONVERSATION_ID}`,
    runId: RUN_ID,
    conversationId: CONVERSATION_ID,
    type: "RunPaused",
    data: {
      turnId: TURN_ID,
      status: "waiting_for_external",
      externalJobId: jobId,
      toolCallId: EXTERNAL_TOOL_CALL_ID,
      toolId: EXTERNAL_TOOL_ID,
    },
  });
  return {
    runId: RUN_ID,
    activeTurnId: TURN_ID,
    status: "waiting_for_external",
    journal,
    pendingExternal: {
      kind: "external_job",
      jobId,
      startedMessage: "I am preparing the proposal.",
      turnId: TURN_ID,
      toolCallId: EXTERNAL_TOOL_CALL_ID,
      toolId: EXTERNAL_TOOL_ID,
    },
    assistantText: "I am preparing the proposal.",
    projectId: "77777777-7777-4777-8777-777777777777",
    actorId: "actor-1",
    conversationId: CONVERSATION_ID,
    modelProfileId: "creative-balanced",
    projectKind: "story",
    workbenchMode: "story",
  };
}

function durableExternalJournal(
  jobId: string,
  overrides: Partial<{
    jobId: string;
    turnId: string;
    toolCallId: string;
    toolId: string;
  }> = {}
) {
  const correlation = {
    jobId,
    turnId: TURN_ID,
    toolCallId: EXTERNAL_TOOL_CALL_ID,
    toolId: EXTERNAL_TOOL_ID,
    ...overrides,
  };
  return {
    ok: true,
    status: "waiting_for_external",
    events: [
      {
        ...durableEvent(1, "RunPaused", {
          turnId: correlation.turnId,
          status: "waiting_for_external",
          externalJobId: correlation.jobId,
          toolCallId: correlation.toolCallId,
          toolId: correlation.toolId,
        }),
        id: DURABLE_EXTERNAL_EVENT_ID,
      },
    ],
    pendingApproval: null,
    pendingUserInput: null,
    pendingExternal: {
      kind: "external_job",
      jobId: correlation.jobId,
      startedMessage: "I am preparing the proposal.",
      turnId: correlation.turnId,
      toolCallId: correlation.toolCallId,
      toolId: correlation.toolId,
    },
    assistantText: "I am preparing the proposal.",
    projectKind: "story",
    workbenchMode: "story",
    workbenchContext: null,
    skillMountSnapshot: null,
  };
}

function startInput() {
  return {
    runId: RUN_ID,
    conversationId: CONVERSATION_ID,
    projectId: "77777777-7777-4777-8777-777777777777",
    actorId: "actor-1",
    sessionId: `agent-os:v1:conversation:${CONVERSATION_ID}`,
    clientSubmissionId: START_SUBMISSION_ID,
    turnId: TURN_ID,
    messageId: START_MESSAGE_ID,
    startExecution: {
      executionToken: START_EXECUTION_TOKEN,
      executionAttemptId: START_EXECUTION_ATTEMPT_ID,
      executionEpoch: 1,
    },
    message: "Create an interactive story.",
    modelProfileId: "creative-balanced",
    projectKind: "story" as const,
    workbenchMode: "story",
    skillMountSnapshot: {
      resolutionId: "66666666-6666-4666-8666-666666666666",
      skills: [],
    } as never,
    model: {} as never,
    domain: {} as never,
    checkpointer: {} as never,
  };
}

function durableEvent(
  sequence: number,
  type: "UserMessage" | "RunStarted" | "RunPaused" | "RunCompleted",
  data: Record<string, unknown>
) {
  return {
    id: "88888888-8888-4888-8888-888888888888",
    protocolVersion: "fizz.agent.v1",
    sessionId: `agent-os:v1:conversation:${CONVERSATION_ID}`,
    runId: RUN_ID,
    conversationId: CONVERSATION_ID,
    sequence,
    timestamp: "2026-08-21T00:00:00.000Z",
    type,
    data,
  };
}
