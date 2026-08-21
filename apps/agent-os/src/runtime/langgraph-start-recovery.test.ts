import { AIMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { MemorySaver } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";

import { AgentOsCheckpointExecutionSupersededError } from "./checkpointer.js";
import { EventJournal } from "./event-journal.js";
import { InMemoryStoryDomain } from "./in-memory-domain.js";
import { AgentOsJournalReportError } from "./journal-reporter.js";
import {
  LangGraphRunService,
  type LangGraphRunSnapshot,
  type StartLangGraphRunInput,
} from "./langgraph-run-service.js";

const RUN_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const TURN_ID = "33333333-3333-4333-8333-333333333333";
const MESSAGE_ID = "44444444-4444-4444-8444-444444444444";
const ASSISTANT_MESSAGE_ID = "55555555-5555-4555-8555-555555555555";

describe("LangGraph initial-start recovery", () => {
  it("retains the start command after a runtime failure even when an earlier checkpoint exists", async () => {
    const admitted = new EventJournal();
    admitted.append({
      sessionId: inputSession(),
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      type: "UserMessage",
      data: {
        turnId: TURN_ID,
        messageId: MESSAGE_ID,
        text: "Continue the story.",
      },
    });
    const service = new LangGraphRunService(vi.fn() as never);
    const internals = serviceInternals(service);
    internals.persist = vi.fn(async () => ({
      startExecutionDisposition: "accepted" as const,
    }));
    internals.persistUntilAccepted = vi.fn();
    internals.runGraphTurn = vi.fn(async () => {
      throw new Error("journal response lost after an external tool result");
    });
    const input = {
      ...startInput(),
      clientSubmissionId: "88888888-8888-4888-8888-888888888888",
      startExecution: {
        executionToken: "99999999-9999-4999-8999-999999999999",
        executionAttemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        executionEpoch: 1,
      },
    };

    await service.beginStart(input, {
      status: "running",
      events: admitted.all(),
      pendingApproval: null,
      pendingUserInput: null,
      pendingExternal: null,
      assistantText: null,
      projectKind: "story",
      workbenchMode: "story",
      workbenchContext: null,
      skillMountSnapshot: skillSnapshot(),
      startExecutionPending: true,
      startExecutionCheckpointId: "checkpoint-before-tool-result",
      startExecutionCheckpointNamespace: "",
      startExecutionCheckpointThreadId: CONVERSATION_ID,
      startExecutionCheckpointMessageId: MESSAGE_ID,
    });
    await internals.inflight.get(RUN_ID);

    expect(service.getSnapshot(RUN_ID)).toMatchObject({
      status: "running",
      startExecution: {
        checkpointId: "checkpoint-before-tool-result",
        checkpointMessageId: MESSAGE_ID,
      },
    });
    expect(
      service
        .getSnapshot(RUN_ID)
        ?.journal.all()
        .some((event) => event.type === "RunFailed")
    ).toBe(false);
    expect(internals.persistUntilAccepted).not.toHaveBeenCalled();
  });

  it("contains an async fenced putWrites rejection after cancellation without crashing the Worker", async () => {
    const writeStarted = deferred<void>();
    const rejectWrite = deferred<void>();
    const checkpointer = new (class extends MemorySaver {
      private firstWrite = true;

      override async putWrites(...args: Parameters<MemorySaver["putWrites"]>): Promise<void> {
        if (!this.firstWrite) return super.putWrites(...args);
        this.firstWrite = false;
        writeStarted.resolve(undefined);
        await rejectWrite.promise;
        throw new AgentOsCheckpointExecutionSupersededError(
          "Terminal Agent OS run cancelled cannot write checkpoints"
        );
      }
    })();
    const service = new LangGraphRunService();
    const internals = serviceInternals(service);
    internals.persist = vi.fn(async () => ({
      startExecutionDisposition: "accepted" as const,
    }));
    internals.persistUntilAccepted = vi.fn();
    const input = {
      ...startInput(),
      clientSubmissionId: "88888888-8888-4888-8888-888888888888",
      startExecution: {
        executionToken: "99999999-9999-4999-8999-999999999999",
        executionAttemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        executionEpoch: 1,
      },
      model: fakeModel().respond(new AIMessage("This result must not survive cancellation.")),
      domain: new InMemoryStoryDomain(),
      checkpointer,
    };
    const unhandled: unknown[] = [];
    const recordUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", recordUnhandled);

    try {
      await service.beginStart(input, {
        status: "running",
        events: admittedUserJournal().all(),
        pendingApproval: null,
        pendingUserInput: null,
        pendingExternal: null,
        assistantText: null,
        projectKind: "story",
        workbenchMode: "story",
        workbenchContext: null,
        skillMountSnapshot: skillSnapshot(),
        startExecutionPending: true,
        startExecutionCheckpointId: null,
        startExecutionCheckpointNamespace: null,
        startExecutionCheckpointThreadId: null,
        startExecutionCheckpointMessageId: null,
      });
      await writeStarted.promise;
      const work = internals.inflight.get(RUN_ID);
      expect(work).toBeDefined();

      await service.cancel(RUN_ID, "Stopped during checkpoint persistence");
      rejectWrite.resolve(undefined);
      await work;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(unhandled).toEqual([]);
      expect(service.getSnapshot(RUN_ID)?.status).toBe("cancelled");
      expect(
        service
          .getSnapshot(RUN_ID)
          ?.journal.all()
          .some((event) => event.type === "RunFailed")
      ).toBe(false);
      expect(internals.persistUntilAccepted).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", recordUnhandled);
      rejectWrite.resolve(undefined);
    }
  });

  it.each(["start", "continuation"] as const)(
    "observes detached %s execution and checkpoint-release rejections",
    async (kind) => {
      const service = new LangGraphRunService(vi.fn() as never);
      const internals = serviceInternals(service);
      const unhandled: unknown[] = [];
      const recordUnhandled = (reason: unknown): void => {
        unhandled.push(reason);
      };
      const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
      process.on("unhandledRejection", recordUnhandled);

      try {
        internals.observeExecutionWork({
          work: Promise.reject(new Error(`${kind} catch handler failed`)),
          runId: RUN_ID,
          kind,
          cleanup: async () => {
            throw new Error(`${kind} checkpoint release failed`);
          },
        });
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(unhandled).toEqual([]);
        const logs = stderr.mock.calls.map(([line]) => String(line));
        expect(logs.some((line) => line.includes('"phase":"execution"'))).toBe(true);
        expect(logs.some((line) => line.includes(`${kind} catch handler failed`))).toBe(true);
        expect(logs.some((line) => line.includes('"phase":"cleanup"'))).toBe(true);
        expect(logs.some((line) => line.includes(`${kind} checkpoint release failed`))).toBe(true);
      } finally {
        process.off("unhandledRejection", recordUnhandled);
        stderr.mockRestore();
      }
    }
  );

  it("does not start a newer epoch while the prior checkpoint owner still holds the thread", async () => {
    const oldRelease = deferred<void>();
    const streamSignals = new Map<number, AbortSignal>();
    const graphFactory = vi.fn(
      (options: { runtime: { startExecution?: { executionEpoch: number } } }) => {
        const epoch = options.runtime.startExecution?.executionEpoch ?? 0;
        const release = oldRelease;
        return {
          getState: vi.fn(async () => emptyState()),
          streamEvents: vi.fn(async (_payload: unknown, config: { signal: AbortSignal }) => {
            streamSignals.set(epoch, config.signal);
            return {
              async *[Symbol.asyncIterator]() {
                await release.promise;
              },
            };
          }),
          invoke: vi.fn(),
        };
      }
    );
    const service = new LangGraphRunService(graphFactory as never);
    const internals = serviceInternals(service);
    let durableEvents = admittedUserJournal().all();
    internals.persist = vi.fn(async (snapshot) => {
      durableEvents = snapshot.journal.all();
      return { startExecutionDisposition: "accepted" as const };
    });
    internals.admitDurableStart = vi.fn(async (input, _admissionId) =>
      service.beginStart(input, {
        status: "running",
        events: durableEvents,
        pendingApproval: null,
        pendingUserInput: null,
        pendingExternal: null,
        assistantText: null,
        projectKind: "story",
        workbenchMode: "story",
        workbenchContext: null,
        skillMountSnapshot: skillSnapshot(),
        startExecutionPending: true,
        startExecutionCheckpointId: null,
        startExecutionCheckpointNamespace: null,
        startExecutionCheckpointThreadId: null,
        startExecutionCheckpointMessageId: null,
      })
    );
    const token = "99999999-9999-4999-8999-999999999999";
    const firstInput = {
      ...startInput(),
      clientSubmissionId: "88888888-8888-4888-8888-888888888888",
      startExecution: {
        executionToken: token,
        executionAttemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
        executionEpoch: 1,
      },
    };
    await service.beginDurableStart(firstInput);
    const oldWork = internals.inflight.get(RUN_ID)!;

    const secondInput = {
      ...firstInput,
      startExecution: {
        executionToken: token,
        executionAttemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
        executionEpoch: 2,
      },
    };
    await expect(service.beginDurableStart(secondInput)).rejects.toMatchObject({
      name: "StartExecutionSupersededError",
      runId: RUN_ID,
    });

    expect(graphFactory).toHaveBeenCalledTimes(1);
    expect(streamSignals.has(2)).toBe(false);
    expect(internals.inflight.get(RUN_ID)).toBe(oldWork);

    oldRelease.resolve(undefined);
    await oldWork;
    expect(internals.inflight.has(RUN_ID)).toBe(false);
  });

  it("does not let a superseded continuation epoch cancel the newer owner after a late abort error", async () => {
    const releaseOld = deferred<void>();
    const streamStarted = deferred<void>();
    const graph = {
      getState: vi.fn(async () => emptyState()),
      streamEvents: vi.fn(async () => ({
        async *[Symbol.asyncIterator]() {
          streamStarted.resolve(undefined);
          await releaseOld.promise;
          const error = new Error("old continuation aborted after takeover");
          error.name = "AbortError";
          throw error;
        },
      })),
      invoke: vi.fn(),
    };
    const { service, snapshot, input } = fixture(graph);
    const internals = serviceInternals(service);
    const oldOwner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
    snapshot.continuationExecution = {
      executionToken: "99999999-9999-4999-8999-999999999999",
      executionAttemptId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
      executionEpoch: 1,
      executionOwnerId: oldOwner,
    };
    internals.persist = vi.fn(async () => ({
      continuationExecutionDisposition: "accepted" as const,
    }));
    const cancel = vi.spyOn(service, "cancel");
    const oldAbort = new AbortController();
    const oldWork = internals.runGraphTurn({
      input: { ...input, continuationExecution: snapshot.continuationExecution },
      journal: snapshot.journal,
      turnId: TURN_ID,
      resume: null,
      signal: oldAbort.signal,
      expectedContinuationExecutionOwnerId: oldOwner,
    });
    await streamStarted.promise;

    const newer = {
      ...snapshot,
      continuationExecution: {
        ...snapshot.continuationExecution,
        executionAttemptId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
        executionEpoch: 2,
        executionOwnerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
      },
    };
    internals.snapshots.set(RUN_ID, newer);
    oldAbort.abort();
    releaseOld.resolve(undefined);
    await expect(oldWork).resolves.toBeUndefined();

    expect(cancel).not.toHaveBeenCalled();
    expect(internals.snapshots.get(RUN_ID)).toBe(newer);
    expect(internals.snapshots.get(RUN_ID)?.continuationExecution).toMatchObject({
      executionEpoch: 2,
      executionOwnerId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
    });
  });

  it("projects the next checkpointed HITL without resubmitting the consumed answer", async () => {
    const oldRequestId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const nextApprovalId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const state = {
      values: { messages: [] },
      tasks: [
        {
          interrupts: [
            {
              value: {
                kind: "tool_approval",
                approvalId: nextApprovalId,
                toolCallId: "next-sensitive-write",
                toolId: "characters.upsert",
                arguments: { characterId: "hero" },
                title: "Apply the next change",
                description: "Review the next durable write.",
              },
            },
          ],
        },
      ],
      config: checkpointConfig("checkpoint-after-consumed-command"),
    };
    const graph = {
      getState: vi.fn(async () => state),
      streamEvents: vi.fn(),
      invoke: vi.fn(),
    };
    const { service, snapshot, input } = fixture(graph);
    const internals = serviceInternals(service);
    const ownerId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    snapshot.continuationExecution = {
      executionToken: "99999999-9999-4999-8999-999999999999",
      executionAttemptId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      executionEpoch: 2,
      executionOwnerId: ownerId,
    };
    snapshot.continuationCommand = {
      kind: "user_input",
      runId: RUN_ID,
      turnId: TURN_ID,
      responseId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      requestId: oldRequestId,
      answers: { aspect_ratio: "landscape_16_9" },
      projectId: input.projectId,
      conversationId: CONVERSATION_ID,
      actorId: input.actorId,
      modelProfileId: input.modelProfileId,
      projectKind: "story",
      workbenchMode: "story",
      permissionMode: "smart",
      skillMountSnapshot: skillSnapshot(),
    };
    internals.persist = vi.fn(async () => ({
      continuationExecutionDisposition: "accepted" as const,
    }));
    internals.persistUntilAccepted = vi.fn(async () => undefined);

    await internals.runGraphTurn({
      input: { ...input, continuationExecution: snapshot.continuationExecution },
      journal: snapshot.journal,
      turnId: TURN_ID,
      resume: { requestId: oldRequestId, answers: snapshot.continuationCommand.answers },
      signal: new AbortController().signal,
      expectedContinuationExecutionOwnerId: ownerId,
      continuationCommand: snapshot.continuationCommand,
    });

    expect(graph.streamEvents).not.toHaveBeenCalled();
    expect(graph.invoke).not.toHaveBeenCalled();
    expect(service.getSnapshot(RUN_ID)).toMatchObject({
      status: "waiting_for_approval",
      pendingApproval: { approvalId: nextApprovalId },
    });
    expect(
      snapshot.journal.all().filter((event) => event.type === "ApprovalRequired")
    ).toHaveLength(1);
    expect(internals.persistUntilAccepted).toHaveBeenCalledWith(
      expect.objectContaining({ status: "waiting_for_approval" }),
      "human_interaction_pause"
    );
  });

  it("never invokes the original HumanMessage after a stream/checkpoint failure", async () => {
    const invoke = vi.fn();
    const graph = {
      getState: vi.fn(async () => emptyState()),
      streamEvents: vi.fn(async () =>
        failingStream(new AgentOsJournalReportError(RUN_ID, 409, "AGENT_OS_START_EXECUTION_FENCED"))
      ),
      invoke,
    };
    const { service, snapshot, input } = fixture(graph);

    await expect(runGraphTurn(service, input, snapshot)).rejects.toMatchObject({
      status: 409,
    });
    expect(graph.streamEvents).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("closes a checkpoint-complete partial segment with the same message id", async () => {
    const journal = new EventJournal();
    journal.append({
      sessionId: inputSession(),
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      type: "UserMessage",
      data: {
        turnId: TURN_ID,
        messageId: MESSAGE_ID,
        text: "Continue the story.",
      },
    });
    journal.append({
      sessionId: inputSession(),
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      type: "MessageStarted",
      data: {
        turnId: TURN_ID,
        messageId: ASSISTANT_MESSAGE_ID,
        segmentKind: "response",
      },
    });
    journal.append({
      sessionId: inputSession(),
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      type: "MessageDelta",
      data: {
        turnId: TURN_ID,
        messageId: ASSISTANT_MESSAGE_ID,
        delta: "Hello ",
      },
    });
    const completedState = {
      values: {
        messages: [
          { id: MESSAGE_ID, role: "user", content: "Continue the story." },
          { id: "ai-checkpoint-1", role: "assistant", content: "Hello world" },
        ],
      },
      tasks: [],
      config: {
        configurable: {
          thread_id: CONVERSATION_ID,
          checkpoint_ns: "",
          checkpoint_id: "checkpoint-complete",
        },
      },
    };
    const graph = {
      getState: vi.fn(async () => completedState),
      streamEvents: vi.fn(),
      invoke: vi.fn(),
    };
    const { service, snapshot, input } = fixture(graph, journal);
    snapshot.activeMessage = {
      turnId: TURN_ID,
      messageId: ASSISTANT_MESSAGE_ID,
      segmentKind: "response",
      text: "Hello ",
    };
    snapshot.assistantText = "Hello ";

    await runGraphTurn(service, input, snapshot);

    const events = journal.all();
    expect(events.filter((event) => event.type === "MessageStarted")).toHaveLength(1);
    expect(
      events
        .filter((event) => event.type === "MessageDelta")
        .map((event) => event.data.delta)
        .join("")
    ).toBe("Hello world");
    expect(events.filter((event) => event.type === "MessageCompleted")).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          messageId: ASSISTANT_MESSAGE_ID,
          text: "Hello world",
        }),
      }),
    ]);
    expect(graph.streamEvents).not.toHaveBeenCalled();
    expect(graph.invoke).not.toHaveBeenCalled();
  });

  it.each([
    ["without prior conversation history", []],
    [
      "with a prior assistant message",
      [{ id: "historical-ai", role: "assistant", content: "Earlier answer." }],
    ],
  ])("supersedes a partial segment ahead of the checkpoint %s", async (_label, history) => {
    const journal = new EventJournal();
    journal.append({
      sessionId: inputSession(),
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      type: "UserMessage",
      data: {
        turnId: TURN_ID,
        messageId: MESSAGE_ID,
        text: "Continue the story.",
      },
    });
    journal.append({
      sessionId: inputSession(),
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      type: "MessageStarted",
      data: {
        turnId: TURN_ID,
        messageId: ASSISTANT_MESSAGE_ID,
        segmentKind: "response",
      },
    });
    journal.append({
      sessionId: inputSession(),
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      type: "MessageDelta",
      data: {
        turnId: TURN_ID,
        messageId: ASSISTANT_MESSAGE_ID,
        delta: "Abandoned partial ",
      },
    });
    let phase: "before" | "after" = "before";
    const before = {
      values: {
        messages: [...history, { id: MESSAGE_ID, role: "user", content: "Continue the story." }],
      },
      tasks: [{ id: "pending-model" }],
      config: checkpointConfig("checkpoint-before-model"),
    };
    const after = {
      values: {
        messages: [
          ...history,
          { id: MESSAGE_ID, role: "user", content: "Continue the story." },
          { id: "fresh-ai", role: "assistant", content: "Fresh answer." },
        ],
      },
      tasks: [],
      config: checkpointConfig("checkpoint-fresh-answer"),
    };
    const graph = {
      getState: vi.fn(async () => (phase === "before" ? before : after)),
      streamEvents: vi.fn(async () => ({
        async *[Symbol.asyncIterator]() {
          yield {
            event: "on_chat_model_stream",
            data: { chunk: { content: "Fresh answer." } },
          };
          phase = "after";
          yield {
            event: "on_chat_model_end",
            data: { output: { content: "Fresh answer." } },
          };
        },
      })),
      invoke: vi.fn(),
    };
    const { service, snapshot, input } = fixture(graph, journal);
    snapshot.activeMessage = {
      turnId: TURN_ID,
      messageId: ASSISTANT_MESSAGE_ID,
      segmentKind: "response",
      text: "Abandoned partial ",
    };
    snapshot.assistantText = "Abandoned partial ";

    await runGraphTurn(service, input, snapshot);

    const completed = journal.all().filter((event) => event.type === "MessageCompleted");
    expect(completed[0]).toMatchObject({
      data: {
        messageId: ASSISTANT_MESSAGE_ID,
        text: "Abandoned partial ",
        finishReason: "superseded",
      },
    });
    expect(completed.at(-1)).toMatchObject({
      data: {
        text: "Fresh answer.",
        finishReason: "stop",
      },
    });
    expect(completed.at(-1)?.data.messageId).not.toBe(ASSISTANT_MESSAGE_ID);
    expect(completed.at(-1)?.data.text).not.toContain("Abandoned partial");
    expect(graph.invoke).not.toHaveBeenCalled();
  });

  it("does not duplicate a completed assistant segment when only RunCompleted is missing", async () => {
    const journal = new EventJournal();
    journal.append({
      sessionId: inputSession(),
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      type: "UserMessage",
      data: {
        turnId: TURN_ID,
        messageId: MESSAGE_ID,
        text: "Continue the story.",
      },
    });
    journal.append({
      sessionId: inputSession(),
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      type: "MessageStarted",
      data: {
        turnId: TURN_ID,
        messageId: ASSISTANT_MESSAGE_ID,
        segmentKind: "response",
      },
    });
    journal.append({
      sessionId: inputSession(),
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      type: "MessageDelta",
      data: {
        turnId: TURN_ID,
        messageId: ASSISTANT_MESSAGE_ID,
        delta: "Already complete.",
      },
    });
    journal.append({
      sessionId: inputSession(),
      runId: RUN_ID,
      conversationId: CONVERSATION_ID,
      type: "MessageCompleted",
      data: {
        turnId: TURN_ID,
        messageId: ASSISTANT_MESSAGE_ID,
        text: "Already complete.",
        finishReason: "stop",
      },
    });
    const completedState = {
      values: {
        messages: [
          { id: MESSAGE_ID, role: "user", content: "Continue the story." },
          { id: "checkpoint-ai", role: "assistant", content: "Already complete." },
        ],
      },
      tasks: [],
      config: checkpointConfig("checkpoint-complete-message"),
    };
    const graph = {
      getState: vi.fn(async () => completedState),
      streamEvents: vi.fn(),
      invoke: vi.fn(),
    };
    const { service, snapshot, input } = fixture(graph, journal);
    snapshot.assistantText = "Already complete.";

    await runGraphTurn(service, input, snapshot);

    expect(journal.all().filter((event) => event.type === "MessageStarted")).toHaveLength(1);
    expect(journal.all().filter((event) => event.type === "MessageCompleted")).toHaveLength(1);
    expect(journal.all().filter((event) => event.type === "RunCompleted")).toHaveLength(1);
    expect(graph.streamEvents).not.toHaveBeenCalled();
  });

  it("does not publish an external pause until the matching ToolMessage is checkpointed", async () => {
    let phase: "before" | "tool" = "before";
    let pauseAbsentInsideTool = false;
    let runtimeOnToolEvent:
      | ((event: {
          type: "ToolCompleted";
          toolId: string;
          toolCallId: string;
          data: Record<string, unknown>;
        }) => Promise<void>)
      | undefined;
    const graph = {
      getState: vi.fn(async () =>
        phase === "before"
          ? emptyState()
          : {
              ...emptyState(),
              values: {
                messages: [
                  {
                    tool_call_id: "story-author-call-1",
                    content: JSON.stringify({ ok: true }),
                  },
                ],
              },
              config: {
                configurable: {
                  thread_id: CONVERSATION_ID,
                  checkpoint_ns: "",
                  checkpoint_id: "checkpoint-tool-result",
                },
              },
            }
      ),
      streamEvents: vi.fn(async () => ({
        async *[Symbol.asyncIterator]() {
          if (!runtimeOnToolEvent) throw new Error("tool event callback missing");
          await runtimeOnToolEvent({
            type: "ToolCompleted",
            toolId: "story.author",
            toolCallId: "story-author-call-1",
            data: {
              result: { runId: "99999999-9999-4999-8999-999999999999" },
              agentHandoff: {
                kind: "external_job",
                jobId: "99999999-9999-4999-8999-999999999999",
                startedMessage: "I am preparing the proposal.",
              },
            },
          });
          pauseAbsentInsideTool = !snapshotJournal
            .all()
            .some((event) => event.type === "RunPaused");
          yield { event: "on_tool_end", data: {} };
          phase = "tool";
          yield { event: "on_chain_end", data: {} };
        },
      })),
      invoke: vi.fn(),
    };
    let snapshotJournal = new EventJournal();
    const graphFactory = vi.fn(
      (options: { runtime: { onToolEvent?: typeof runtimeOnToolEvent } }) => {
        runtimeOnToolEvent = options.runtime.onToolEvent;
        return graph;
      }
    );
    const service = new LangGraphRunService(graphFactory as never);
    const input = startInput();
    const snapshot = baseSnapshot(snapshotJournal);
    serviceInternals(service).snapshots.set(RUN_ID, snapshot);

    await runGraphTurn(service, input, snapshot);

    expect(pauseAbsentInsideTool).toBe(true);
    expect(service.getSnapshot(RUN_ID)).toMatchObject({
      status: "waiting_for_external",
      pendingExternal: {
        jobId: "99999999-9999-4999-8999-999999999999",
        toolCallId: "story-author-call-1",
      },
    });
    expect(
      snapshotJournal
        .all()
        .filter((event) => event.type === "RunPaused")
        .at(-1)?.data
    ).toMatchObject({
      status: "waiting_for_external",
      externalJobId: "99999999-9999-4999-8999-999999999999",
    });
    expect(graph.invoke).not.toHaveBeenCalled();
  });
});

function fixture(graph: object, journal = new EventJournal()) {
  const graphFactory = vi.fn(() => graph);
  const service = new LangGraphRunService(graphFactory as never);
  const input = startInput();
  const snapshot = baseSnapshot(journal);
  serviceInternals(service).snapshots.set(RUN_ID, snapshot);
  return { service, snapshot, input };
}

function serviceInternals(service: LangGraphRunService) {
  return service as unknown as {
    snapshots: Map<string, LangGraphRunSnapshot>;
    inflight: Map<string, Promise<void>>;
    aborts: Map<string, AbortController>;
    startHeartbeatTimers: Map<string, ReturnType<typeof setInterval>>;
    admitDurableStart(
      input: StartLangGraphRunInput,
      admissionId: symbol
    ): Promise<LangGraphRunSnapshot>;
    persist(snapshot: LangGraphRunSnapshot): Promise<{
      startExecutionDisposition?: "granted" | "accepted";
      continuationExecutionDisposition?: "granted" | "accepted";
    }>;
    persistUntilAccepted(snapshot: LangGraphRunSnapshot, reason: string): Promise<void>;
    observeExecutionWork(input: {
      work: Promise<void>;
      runId: string;
      kind: "start" | "continuation";
      cleanup(): Promise<void>;
    }): void;
    runGraphTurn(input: {
      input: StartLangGraphRunInput;
      journal: EventJournal;
      turnId: string;
      resume: unknown;
      signal: AbortSignal;
      expectedContinuationExecutionOwnerId?: string;
      continuationCommand?: LangGraphRunSnapshot["continuationCommand"];
    }): Promise<void>;
  };
}

function runGraphTurn(
  service: LangGraphRunService,
  input: StartLangGraphRunInput,
  snapshot: LangGraphRunSnapshot
) {
  return serviceInternals(service).runGraphTurn({
    input,
    journal: snapshot.journal,
    turnId: TURN_ID,
    resume: null,
    signal: new AbortController().signal,
  });
}

function baseSnapshot(journal: EventJournal): LangGraphRunSnapshot {
  return {
    runId: RUN_ID,
    activeTurnId: TURN_ID,
    status: "running",
    journal,
    projectId: "66666666-6666-4666-8666-666666666666",
    actorId: "user-1",
    modelProfileId: "test-model",
    conversationId: CONVERSATION_ID,
    projectKind: "story",
    workbenchMode: "story",
    skillMountSnapshot: skillSnapshot(),
  };
}

function startInput(): StartLangGraphRunInput {
  return {
    runId: RUN_ID,
    conversationId: CONVERSATION_ID,
    projectId: "66666666-6666-4666-8666-666666666666",
    actorId: "user-1",
    sessionId: inputSession(),
    turnId: TURN_ID,
    messageId: MESSAGE_ID,
    message: "Continue the story.",
    modelProfileId: "test-model",
    projectKind: "story",
    workbenchMode: "story",
    skillMountSnapshot: skillSnapshot(),
    model: {} as never,
    domain: {} as never,
    checkpointer: {} as never,
  };
}

function skillSnapshot() {
  return {
    schemaVersion: "project-skill-resolution/v1" as const,
    resolutionId: "77777777-7777-4777-8777-777777777777",
    ownerKind: "story" as const,
    projectId: "66666666-6666-4666-8666-666666666666",
    projectRevision: 0,
    scope: "agent_prompt" as const,
    workbenchMode: "story",
    sourceSurface: "agent_os:story",
    resolvedAt: "2026-08-21T00:00:00.000Z",
    skills: [],
    checksum: "0".repeat(64),
  };
}

function emptyState() {
  return {
    values: { messages: [] },
    tasks: [],
    config: {
      configurable: {
        thread_id: CONVERSATION_ID,
        checkpoint_ns: "",
        checkpoint_id: "checkpoint-before",
      },
    },
  };
}

function admittedUserJournal() {
  const journal = new EventJournal();
  journal.append({
    sessionId: inputSession(),
    runId: RUN_ID,
    conversationId: CONVERSATION_ID,
    type: "UserMessage",
    data: {
      turnId: TURN_ID,
      messageId: MESSAGE_ID,
      text: "Continue the story.",
    },
  });
  return journal;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function checkpointConfig(checkpointId: string) {
  return {
    configurable: {
      thread_id: CONVERSATION_ID,
      checkpoint_ns: "",
      checkpoint_id: checkpointId,
    },
  };
}

function failingStream(error: Error) {
  return {
    async *[Symbol.asyncIterator]() {
      throw error;
    },
  };
}

function inputSession() {
  return `agent-os:v1:conversation:${CONVERSATION_ID}`;
}
