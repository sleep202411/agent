import {
  STUDIO_AGENT_SCHEMA_VERSION,
  type StudioAgentAction,
  type StudioAgentEvent,
  type StudioAgentEventType,
} from "@repo/shared";
import { describe, expect, it } from "vitest";

import {
  appendStudioAgentEvents,
  createStudioAgentEventState,
  createStudioAgentEventStateFromSnapshot,
  hydrateStudioAgentEarlierTurns,
  hydrateStudioAgentEventState,
  hydrateStudioAgentSubmitResult,
  selectStudioAgentChildRuns,
  selectStudioAgentTimeline,
  summarizeStudioAgentChildRuns,
} from "./event-reducer";

const threadId = "thread-1";
const rootRunId = "run-parent";

describe("Studio Agent event reducer", () => {
  it("deduplicates replayed events and waits for gaps before projecting ordered deltas", () => {
    const started = event(
      1,
      "assistant.segment.started",
      {
        messageId: "message-1",
        segmentId: "segment-1",
        ordinal: 0,
        kind: "answer",
        format: "plain_text",
      },
      rootRunId
    );
    const firstDelta = event(
      2,
      "assistant.segment.delta",
      {
        messageId: "message-1",
        segmentId: "segment-1",
        delta: "hello ",
      },
      rootRunId
    );
    const secondDelta = event(
      3,
      "assistant.segment.delta",
      {
        messageId: "message-1",
        segmentId: "segment-1",
        delta: "world",
      },
      rootRunId
    );

    const withGap = appendStudioAgentEvents(createStudioAgentEventState(threadId), [
      secondDelta,
      started,
    ]);

    expect(withGap.cursor?.sequence).toBe(1);
    expect(withGap.messages["message-1"]?.text).toBe("");

    const replayed = appendStudioAgentEvents(withGap, [
      secondDelta,
      firstDelta,
      started,
      firstDelta,
    ]);

    expect(replayed.cursor).toEqual({
      eventId: "event-3",
      sequence: 3,
      value: "3",
    });
    expect(replayed.journal.map((entry) => entry.sequence)).toEqual([1, 2, 3]);
    expect(replayed.messages["message-1"]?.text).toBe("hello world");
  });

  it("updates a hydrated assistant message instead of duplicating it by segment id", () => {
    const state = hydrateStudioAgentEventState(createStudioAgentEventState(threadId, 1), {
      messages: [
        {
          schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
          messageId: "message-1",
          clientMessageId: null,
          threadId,
          runId: rootRunId,
          ordinal: 1,
          role: "assistant",
          status: "streaming",
          parts: [{ type: "text", format: "plain_text", text: "hello " }],
          createdAt: timestamp(1),
          completedAt: null,
        },
      ],
    });
    const replayed = appendStudioAgentEvents(state, [
      event(
        2,
        "assistant.segment.delta",
        {
          messageId: "message-1",
          segmentId: "segment-1",
          delta: "world",
        },
        rootRunId
      ),
    ]);

    expect(Object.keys(replayed.messages)).toEqual(["message-1"]);
    expect(replayed.messages["message-1"]?.text).toBe("hello world");
  });

  it("advances an opaque reconnect cursor only through a contiguous snapshot tail", () => {
    const state = createStudioAgentEventState(threadId, 10);
    const sequenceTwelve = event(
      12,
      "activity.started",
      {
        activityId: "activity-1",
        parentActivityId: null,
        kind: "read",
        label: "activity",
        startedAt: timestamp(12),
      },
      rootRunId
    );
    const sequenceEleven = event(11, "run.started", { startedAt: timestamp(11) }, rootRunId);

    const withGap = appendStudioAgentEvents(state, [sequenceTwelve]);
    expect(withGap.cursor).toBeNull();
    expect(withGap.activities).toEqual({});

    const contiguous = appendStudioAgentEvents(withGap, [sequenceEleven]);
    expect(contiguous.cursor?.value).toBe("12");
    expect(contiguous.activities["activity-1"]?.status).toBe("running");
  });

  it("projects child runs and aggregates terminal and approval state", () => {
    const events: StudioAgentEvent[] = [
      event(1, "run.started", { startedAt: timestamp(1) }, rootRunId),
      event(2, "run.started", { startedAt: timestamp(2) }, "run-child-1", rootRunId),
      event(3, "run.started", { startedAt: timestamp(3) }, "run-child-2", rootRunId),
      event(
        4,
        "run.completed",
        {
          outputMessageId: null,
          summary: null,
          completedAt: timestamp(4),
        },
        "run-child-1",
        rootRunId
      ),
      event(
        5,
        "run.waiting",
        { reason: "approval", referenceId: "approval-1" },
        "run-child-2",
        rootRunId
      ),
    ];

    const state = appendStudioAgentEvents(createStudioAgentEventState(threadId), events);
    const children = selectStudioAgentChildRuns(state, rootRunId);
    const summary = summarizeStudioAgentChildRuns(children);

    expect(children.map((run) => run.id)).toEqual(["run-child-1", "run-child-2"]);
    expect(summary).toMatchObject({
      total: 2,
      waitingApproval: 1,
      succeeded: 1,
      terminal: 1,
      progress: 0.5,
    });
  });

  it("projects cancellation requests and resumed runs without treating either as terminal", () => {
    const started = event(1, "run.started", { startedAt: timestamp(1) }, rootRunId);
    const cancelling = event(
      2,
      "run.cancellation_requested",
      { requestedAt: timestamp(2), requestedByInputId: null },
      rootRunId
    );
    const resumed = event(
      3,
      "run.resumed",
      { resumedAt: timestamp(3), resumedFrom: "input", referenceId: "input-1" },
      rootRunId
    );

    const cancellingState = appendStudioAgentEvents(createStudioAgentEventState(threadId), [
      started,
      cancelling,
    ]);
    expect(cancellingState.runs[rootRunId]?.status).toBe("cancelling");

    const resumedState = appendStudioAgentEvents(cancellingState, [resumed]);
    expect(resumedState.runs[rootRunId]).toMatchObject({
      status: "running",
      completedAt: null,
      progress: null,
    });
  });

  it("projects context compaction as an ordered, renderer-neutral timeline item", () => {
    const compacted = event(
      1,
      "context.compacted",
      {
        checkpointId: "00000000-0000-4000-8000-000000000040",
        scope: "thread_prefix",
        coveredThroughMessageId: "00000000-0000-4000-8000-000000000041",
        coveredMessageCount: 120,
        retainedMessageCount: 24,
        summaryHash: "a".repeat(64),
        sourceHash: "b".repeat(64),
        compactedAt: timestamp(1),
      },
      rootRunId
    );

    const state = appendStudioAgentEvents(createStudioAgentEventState(threadId), [compacted]);
    expect(selectStudioAgentTimeline(state)).toEqual([
      expect.objectContaining({
        kind: "context_compaction",
        compaction: expect.objectContaining({
          coveredMessageCount: 120,
          retainedMessageCount: 24,
        }),
      }),
    ]);
  });

  it("projects capability execution as the same compact activity timeline used by model work", () => {
    const actionRecord = action("running", timestamp(2), null);
    const state = appendStudioAgentEvents(createStudioAgentEventState(threadId), [
      event(1, "action.proposed", { action: actionRecord }, rootRunId),
      event(
        2,
        "action.started",
        {
          actionId: actionRecord.actionId,
          executionId: "00000000-0000-4000-8000-000000000052",
          startedAt: timestamp(2),
        },
        rootRunId
      ),
      event(
        3,
        "action.completed",
        {
          execution: {
            schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
            executionId: "00000000-0000-4000-8000-000000000052",
            actionId: actionRecord.actionId,
            status: "succeeded",
            output: null,
            error: null,
            changeSet: null,
            startedAt: timestamp(2),
            completedAt: timestamp(3),
          },
        },
        rootRunId
      ),
    ]);

    expect(selectStudioAgentTimeline(state)).toEqual([
      expect.objectContaining({
        kind: "activity",
        activity: expect.objectContaining({
          id: `action:${actionRecord.actionId}`,
          kind: "execute",
          label: "Update story canvas",
          status: "succeeded",
          startedAt: timestamp(2),
          completedAt: timestamp(3),
        }),
      }),
    ]);
  });

  it("restores completed capability activities from the canonical action snapshot", () => {
    const state = createStudioAgentEventStateFromSnapshot({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      thread: thread(),
      messages: [],
      runs: [],
      actions: [action("succeeded", timestamp(2), timestamp(3))],
      approvals: [],
      inputs: [],
      activities: [],
      turnWindow: { earliestRootRunId: null, hasEarlier: false },
      latestEventSequence: 7,
    });

    expect(selectStudioAgentTimeline(state)).toEqual([
      expect.objectContaining({
        kind: "activity",
        activity: expect.objectContaining({
          label: "Update story canvas",
          status: "succeeded",
          startedAt: timestamp(2),
          completedAt: timestamp(3),
        }),
      }),
    ]);
  });

  it("restores explicit activities with their durable hierarchy, progress, and event order", () => {
    const state = createStudioAgentEventStateFromSnapshot({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      thread: thread(),
      messages: [],
      runs: [],
      actions: [],
      approvals: [],
      inputs: [],
      activities: [
        {
          schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
          activityId: "00000000-0000-4000-8000-000000000061",
          runId: "00000000-0000-4000-8000-000000000062",
          parentActivityId: "00000000-0000-4000-8000-000000000060",
          kind: "analyze",
          label: "Analyze the story",
          detail: "Comparing the two branches",
          progress: 0.6,
          status: "running",
          startedAt: timestamp(2),
          completedAt: null,
          firstEventSequence: 4,
          lastEventSequence: 9,
        },
      ],
      turnWindow: { earliestRootRunId: null, hasEarlier: false },
      latestEventSequence: 9,
    });

    expect(selectStudioAgentTimeline(state)).toEqual([
      expect.objectContaining({
        sequence: 4,
        activity: expect.objectContaining({
          parentActivityId: "00000000-0000-4000-8000-000000000060",
          detail: "Comparing the two branches",
          progress: 0.6,
          sequence: 4,
          lastSequence: 9,
        }),
      }),
    ]);
  });

  it("anchors an assistant reply behind its generating activity on replay", () => {
    // Persisted truth: the assistant message row is inserted during allocation
    // a few milliseconds BEFORE its generating activity starts, and its
    // createdAt is immutable. Sorting by that raw createdAt drops the reply
    // above the activity on replay, even though the live stream renders the
    // activity first. Anchoring the reply to its generating activity keeps both
    // consistent across a refresh (regression guard for the reorder bug).
    const runId = "00000000-0000-4000-8000-000000000032";
    const replay = createStudioAgentEventStateFromSnapshot({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      thread: thread(),
      messages: [
        {
          schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
          messageId: "00000000-0000-4000-8000-000000000030",
          clientMessageId: null,
          threadId: "00000000-0000-4000-8000-000000000002",
          runId,
          ordinal: 0,
          role: "assistant",
          status: "completed",
          parts: [{ type: "text", format: "plain_text", text: "Hi" }],
          createdAt: timestamp(3),
          completedAt: timestamp(6),
        },
      ],
      runs: [],
      actions: [],
      approvals: [],
      inputs: [],
      activities: [
        {
          schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
          activityId: "00000000-0000-4000-8000-000000000031",
          runId,
          parentActivityId: null,
          kind: "generate",
          label: "studio_agent.activity.generating_response",
          detail: null,
          progress: null,
          status: "succeeded",
          startedAt: timestamp(4),
          completedAt: timestamp(6),
          firstEventSequence: 4,
          lastEventSequence: 7,
        },
      ],
      turnWindow: { earliestRootRunId: null, hasEarlier: false },
      latestEventSequence: 7,
    });

    expect(selectStudioAgentTimeline(replay).map((item) => item.kind)).toEqual([
      "activity",
      "message",
    ]);
  });

  it("anchors each reply of a multi-step run to its own generate step", () => {
    // A run that replies, runs a tool, then replies again emits two generate
    // steps; the Nth generate produces the Nth reply. Anchoring both replies to
    // the run's *last* generate would drop the first reply below the tool step —
    // pairing by step index keeps generate→reply→execute→generate→reply.
    const runId = "00000000-0000-4000-8000-000000000032";
    const activity = (id: string, kind: "generate" | "analyze", seq: number) => ({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      activityId: id,
      runId,
      parentActivityId: null,
      kind,
      label: `studio_agent.activity.${kind}`,
      detail: null,
      progress: null,
      status: "succeeded" as const,
      startedAt: timestamp(seq),
      completedAt: timestamp(seq + 1),
      firstEventSequence: seq,
      lastEventSequence: seq + 1,
    });
    const reply = (id: string, ordinal: number, text: string, seq: number) => ({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      messageId: id,
      clientMessageId: null,
      threadId: "00000000-0000-4000-8000-000000000002",
      runId,
      ordinal,
      role: "assistant" as const,
      status: "completed" as const,
      parts: [{ type: "text" as const, format: "plain_text" as const, text }],
      createdAt: timestamp(seq),
      completedAt: timestamp(seq + 1),
    });
    const replay = createStudioAgentEventStateFromSnapshot({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      thread: thread(),
      // reply rows are allocated a tick before their generate step starts.
      messages: [
        reply("00000000-0000-4000-8000-000000000040", 0, "First reply", 3),
        reply("00000000-0000-4000-8000-000000000041", 1, "Second reply", 7),
      ],
      runs: [],
      actions: [],
      approvals: [],
      inputs: [],
      activities: [
        activity("00000000-0000-4000-8000-000000000050", "generate", 4),
        activity("00000000-0000-4000-8000-000000000051", "analyze", 6),
        activity("00000000-0000-4000-8000-000000000052", "generate", 8),
      ],
      turnWindow: { earliestRootRunId: null, hasEarlier: false },
      latestEventSequence: 9,
    });

    const rendered = selectStudioAgentTimeline(replay).map((item) => {
      if (item.kind === "message") return `message:${item.message.text}`;
      if (item.kind === "activity") return `activity:${item.activity.kind}`;
      return item.kind;
    });
    expect(rendered).toEqual([
      "activity:generate",
      "message:First reply",
      "activity:analyze",
      "activity:generate",
      "message:Second reply",
    ]);
  });

  it("surfaces an unreported root failure and renders formal activity cancellation", () => {
    const failed = appendStudioAgentEvents(createStudioAgentEventState(threadId), [
      event(1, "run.started", { startedAt: timestamp(1) }, rootRunId),
      event(
        2,
        "run.failed",
        {
          error: {
            code: "runtime.preflight_failed",
            message: "The story scope could not be loaded.",
            retryable: true,
            details: null,
          },
          failedAt: timestamp(2),
        },
        rootRunId
      ),
    ]);
    expect(selectStudioAgentTimeline(failed)).toEqual([
      expect.objectContaining({
        kind: "run",
        run: expect.objectContaining({
          status: "failed",
          summary: "The story scope could not be loaded.",
        }),
      }),
    ]);

    const cancelled = appendStudioAgentEvents(createStudioAgentEventState(threadId), [
      event(1, "run.started", { startedAt: timestamp(1) }, rootRunId),
      event(
        2,
        "activity.started",
        {
          activityId: "activity-1",
          parentActivityId: null,
          kind: "analyze",
          label: "Analyzing story",
          startedAt: timestamp(2),
        },
        rootRunId
      ),
      event(
        3,
        "activity.cancelled",
        {
          activityId: "activity-1",
          cancelledAt: timestamp(3),
        },
        rootRunId
      ),
      event(
        4,
        "run.cancelled",
        {
          reason: "Cancelled by the creator.",
          cancelledAt: timestamp(4),
        },
        rootRunId
      ),
    ]);
    expect(selectStudioAgentTimeline(cancelled)).toEqual([
      expect.objectContaining({
        kind: "activity",
        activity: expect.objectContaining({
          id: "activity-1",
          status: "cancelled",
          completedAt: timestamp(3),
        }),
      }),
    ]);
  });

  it("keeps a newly submitted turn after older snapshot messages in the timeline", () => {
    const state = createStudioAgentEventStateFromSnapshot({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      thread: thread(),
      messages: [
        {
          schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
          messageId: "00000000-0000-4000-8000-000000000010",
          clientMessageId: "00000000-0000-4000-8000-000000000014",
          threadId: "00000000-0000-4000-8000-000000000002",
          runId: null,
          ordinal: 0,
          role: "user",
          status: "completed",
          parts: [{ type: "text", format: "plain_text", text: "older" }],
          createdAt: timestamp(1),
          completedAt: timestamp(1),
        },
      ],
      runs: [],
      actions: [],
      approvals: [],
      inputs: [],
      activities: [],
      turnWindow: { earliestRootRunId: null, hasEarlier: false },
      latestEventSequence: 10,
    });
    const submitted = hydrateStudioAgentSubmitResult(state, {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      message: {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        messageId: "00000000-0000-4000-8000-000000000011",
        clientMessageId: "00000000-0000-4000-8000-000000000015",
        threadId: "00000000-0000-4000-8000-000000000002",
        runId: "00000000-0000-4000-8000-000000000012",
        ordinal: 1,
        role: "user",
        status: "accepted",
        parts: [{ type: "text", format: "plain_text", text: "newer" }],
        createdAt: timestamp(2),
        completedAt: null,
      },
      run: {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        runId: "00000000-0000-4000-8000-000000000012",
        threadId: "00000000-0000-4000-8000-000000000002",
        rootRunId: "00000000-0000-4000-8000-000000000012",
        parentRunId: null,
        kind: "turn",
        task: null,
        trigger: "message",
        triggerMessageId: "00000000-0000-4000-8000-000000000011",
        scenario: { id: "story.studio.assistant", version: "1.0.0" },
        permissionPolicy: permissionPolicy(),
        status: "queued",
        phase: null,
        createdAt: timestamp(2),
        startedAt: null,
        completedAt: null,
        error: null,
      },
      input: null,
    });

    expect(
      selectStudioAgentTimeline(submitted)
        .filter((item) => item.kind === "message")
        .map((item) => item.message.text)
    ).toEqual(["older", "newer"]);
    expect(submitted.runs["00000000-0000-4000-8000-000000000012"]?.createdAt).toBe(timestamp(2));
  });

  it("never regresses a terminal run when a later REST hydrate reports cancelling", () => {
    const runId = "00000000-0000-4000-8000-000000000012";
    const runRecord = (status: "cancelled" | "cancelling") => ({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      runId,
      threadId: "00000000-0000-4000-8000-000000000002",
      rootRunId: runId,
      parentRunId: null,
      kind: "turn" as const,
      task: null,
      trigger: "message" as const,
      triggerMessageId: null,
      scenario: { id: "story.studio.assistant", version: "1.0.0" },
      permissionPolicy: permissionPolicy(),
      status,
      phase: null,
      createdAt: timestamp(2),
      startedAt: timestamp(3),
      completedAt: status === "cancelled" ? timestamp(4) : null,
      error: null,
    });
    // The live SSE stream already drove the run to a terminal `cancelled`.
    const state = createStudioAgentEventStateFromSnapshot({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      thread: thread(),
      messages: [],
      runs: [runRecord("cancelled")],
      actions: [],
      approvals: [],
      inputs: [],
      activities: [],
      turnWindow: { earliestRootRunId: null, hasEarlier: false },
      latestEventSequence: 10,
    });
    expect(state.runs[runId]?.status).toBe("cancelled");
    // The cancel POST resolves afterwards with the intermediate `cancelling`
    // projection; hydrating it must not resurrect the run (would strand the
    // composer as "running" forever).
    const rehydrated = hydrateStudioAgentEventState(state, {
      runs: [runRecord("cancelling")],
    });
    expect(rehydrated.runs[runId]?.status).toBe("cancelled");
  });

  it("retains canonical attachment metadata when hydrating persisted messages", () => {
    const state = createStudioAgentEventStateFromSnapshot({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      thread: thread(),
      messages: [
        {
          schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
          messageId: "00000000-0000-4000-8000-000000000013",
          clientMessageId: "00000000-0000-4000-8000-000000000016",
          threadId: "00000000-0000-4000-8000-000000000002",
          runId: null,
          ordinal: 0,
          role: "user",
          status: "completed",
          parts: [
            {
              type: "attachment",
              attachmentId: "00000000-0000-4000-8000-000000000071",
              fileName: "reference.webp",
              mediaType: "image/webp",
              sizeBytes: 4_096,
              status: "ready",
            },
          ],
          createdAt: timestamp(1),
          completedAt: timestamp(1),
        },
      ],
      runs: [],
      actions: [],
      approvals: [],
      inputs: [],
      activities: [],
      turnWindow: { earliestRootRunId: null, hasEarlier: false },
      latestEventSequence: 0,
    });

    expect(state.messages["00000000-0000-4000-8000-000000000013"]).toMatchObject({
      text: "",
      attachments: [
        {
          attachmentId: "00000000-0000-4000-8000-000000000071",
          fileName: "reference.webp",
          mediaType: "image/webp",
          sizeBytes: 4_096,
          status: "ready",
        },
      ],
    });
  });
});

describe("Studio Agent earlier turn windows", () => {
  function snapshotPage(
    messages: ReturnType<typeof historyMessage>[],
    overrides: { threadId?: string } = {}
  ) {
    const base = thread();
    return {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      thread: overrides.threadId ? { ...base, threadId: overrides.threadId } : base,
      messages,
      runs: [],
      actions: [],
      approvals: [],
      inputs: [],
      activities: [],
      turnWindow: { earliestRootRunId: null, hasEarlier: false },
      latestEventSequence: 7,
    };
  }

  it("merges an earlier turn window without moving the live base sequence, cursor or journal", () => {
    const state = createStudioAgentEventStateFromSnapshot(
      snapshotPage([historyMessage("00000000-0000-4000-8000-000000000090", 9, "newest")])
    );

    const merged = hydrateStudioAgentEarlierTurns(
      state,
      snapshotPage([historyMessage("00000000-0000-4000-8000-000000000091", 1, "oldest")])
    );

    // An earlier page carries only settled history. If it moved baseSequence
    // the reducer would start discarding live events it has not yet seen.
    expect(merged.baseSequence).toBe(state.baseSequence);
    expect(merged.cursor).toEqual(state.cursor);
    expect(merged.journal).toEqual(state.journal);
    expect(merged.messages["00000000-0000-4000-8000-000000000091"]?.text).toBe("oldest");
    expect(merged.messages["00000000-0000-4000-8000-000000000090"]?.text).toBe("newest");
  });

  it("orders a prepended turn ahead of the live tail", () => {
    const state = createStudioAgentEventStateFromSnapshot(
      snapshotPage([historyMessage("00000000-0000-4000-8000-000000000090", 9, "newest")])
    );

    const merged = hydrateStudioAgentEarlierTurns(
      state,
      snapshotPage([historyMessage("00000000-0000-4000-8000-000000000091", 1, "oldest")])
    );

    expect(
      selectStudioAgentTimeline(merged)
        .filter((item) => item.kind === "message")
        .map((item) => (item.kind === "message" ? item.message.text : null))
    ).toEqual(["oldest", "newest"]);
  });

  it("rejects a history page from another conversation", () => {
    const state = createStudioAgentEventStateFromSnapshot(snapshotPage([]));

    expect(() =>
      hydrateStudioAgentEarlierTurns(
        state,
        snapshotPage([], { threadId: "00000000-0000-4000-8000-0000000000ff" })
      )
    ).toThrow(/does not belong to this conversation/);
  });
});

function historyMessage(messageId: string, ordinal: number, text: string) {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    messageId,
    clientMessageId: null,
    threadId: "00000000-0000-4000-8000-000000000002",
    runId: rootRunId,
    ordinal,
    role: "user" as const,
    status: "completed" as const,
    parts: [{ type: "text" as const, format: "plain_text" as const, text }],
    createdAt: timestamp(ordinal),
    completedAt: timestamp(ordinal),
  };
}

function thread() {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    threadId: "00000000-0000-4000-8000-000000000002",
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
    permissionPolicy: permissionPolicy(),
    activeRunId: null,
    createdAt: timestamp(0),
    updatedAt: timestamp(0),
  };
}

function permissionPolicy() {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    policyId: "00000000-0000-4000-8000-000000000020",
    revision: 1,
    mode: "smart" as const,
    rules: [],
    createdAt: timestamp(0),
  };
}

function action(
  status: StudioAgentAction["status"],
  startedAt: string | null,
  completedAt: string | null
): StudioAgentAction {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    actionId: "00000000-0000-4000-8000-000000000051",
    threadId: "00000000-0000-4000-8000-000000000002",
    runId: rootRunId,
    capability: { id: "story.canvas.apply", version: "1.0.0" },
    effect: "write",
    risk: "medium",
    status,
    title: "Update story canvas",
    summary: "Apply the approved story change.",
    target: null,
    input: {},
    inputHash: "a".repeat(64),
    approvalId: null,
    idempotencyKey: "action-idempotency",
    output: null,
    error: null,
    createdAt: timestamp(1),
    startedAt,
    completedAt,
  };
}

type EventOf<TType extends StudioAgentEventType> = Extract<StudioAgentEvent, { type: TType }>;

function event<TType extends StudioAgentEventType>(
  sequence: number,
  type: TType,
  payload: EventOf<TType>["payload"],
  runId: string,
  parentRunId: string | null = null
): EventOf<TType> {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    eventId: `event-${sequence}`,
    threadId,
    runId,
    rootRunId,
    parentRunId,
    sequence,
    occurredAt: timestamp(sequence),
    type,
    payload,
  } as EventOf<TType>;
}

function timestamp(sequence: number): string {
  return new Date(sequence * 1_000).toISOString();
}
