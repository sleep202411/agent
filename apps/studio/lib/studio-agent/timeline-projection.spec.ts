import type { RunInfo } from "@ably/ai-transport/react";
import { describe, expect, it } from "vitest";

import { EMPTY_STUDIO_AGENT_HISTORY_SEED, type StudioAgentHistorySeed } from "./history-seed";
import { projectStudioAgentPanel, selectStudioAgentChildRuns } from "./timeline-projection";
import {
  STUDIO_AGENT_ACTIVITY_DATA_PART,
  STUDIO_AGENT_ATTACHMENT_DATA_PART,
  STUDIO_AGENT_CANVAS_PREVIEW_DATA_PART,
  STUDIO_AGENT_FAILURE_DATA_PART,
  type StudioAgentUIMessage,
} from "./transport-contract";
import type { StudioAgentActivityView, StudioAgentRunView } from "./view-model";

const THREAD_ID = "00000000-0000-4000-8000-000000000001";
const RUN_ID = "00000000-0000-4000-8000-000000000010";
const CHILD_RUN_ID = "00000000-0000-4000-8000-000000000011";

describe("projectStudioAgentPanel — streaming", () => {
  it("marks a reply that is still arriving, and settles it when the part is done", () => {
    const arriving = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [assistantMessage([{ type: "text", text: "Once upon", state: "streaming" }])],
      wireRuns: [],
    });
    expect(bubbles(arriving)).toEqual([{ role: "assistant", text: "Once upon", streaming: true }]);

    const settled = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [assistantMessage([{ type: "text", text: "Once upon a time.", state: "done" }])],
      wireRuns: [],
    });
    expect(bubbles(settled)).toEqual([
      { role: "assistant", text: "Once upon a time.", streaming: false },
    ]);
  });

  it("projects one row when a reconnect repeats the same domain message", () => {
    const duplicate = assistantMessage([{ type: "text", text: "One answer.", state: "done" }]);
    const state = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [duplicate, { ...duplicate }],
      wireRuns: [],
    });

    expect(bubbles(state)).toEqual([{ role: "assistant", text: "One answer.", streaming: false }]);
    expect(new Set(state.timeline.map((item) => `${item.kind}:${item.id}`)).size).toBe(
      state.timeline.length
    );
  });
});

/**
 * D8, THE PANEL HALF.
 *
 * A reply longer than one Ably message is rolled onto a fresh one mid-flight
 * (`apps/studio-agent-runtime/src/append-ceiling.ts`): the agent publishes
 * `text-end` for the segment that filled up and `text-start` under a new id for
 * the continuation, so the browser's fold produces TWO text parts for one reply.
 * The creator must never see the seam — no second bubble, no gap, no duplicated
 * word, and no remount that would lose the scroll anchor.
 *
 * The merge itself predates the splitter; these are the assertions that keep it,
 * stated in terms of the continuation rather than of "consecutive parts", so a
 * future edit that flushes the bubble between parts fails here instead of
 * cutting every long reply in half in production.
 */
describe("projectStudioAgentPanel — a reply split across Ably messages", () => {
  it("renders a rolled continuation as one continuous bubble", () => {
    const state = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [
        assistantMessage([
          // Segment one filled its 60 KiB budget and was closed.
          { type: "text", text: "The chapter opens", state: "done" },
          // The continuation, still arriving under a fresh stream id.
          { type: "text", text: " and does not stop.", state: "streaming" },
        ]),
      ],
      wireRuns: [],
    });

    expect(bubbles(state)).toEqual([
      {
        role: "assistant",
        // Concatenated with no separator: the roll happens between two bytes of
        // one sentence, so anything inserted here would be visible corruption.
        text: "The chapter opens and does not stop.",
        // The LAST segment's state is the reply's state — the first being `done`
        // says only that one message stopped growing.
        streaming: true,
      },
    ]);
  });

  it("keeps the bubble's identity across the roll, so the row does not remount", () => {
    const before = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [
        assistantMessage([{ type: "text", text: "The chapter opens", state: "streaming" }]),
      ],
      wireRuns: [],
    });
    const after = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [
        assistantMessage([
          { type: "text", text: "The chapter opens", state: "done" },
          { type: "text", text: " and does not stop.", state: "streaming" },
        ]),
      ],
      wireRuns: [],
    });

    const rowId = (state: ReturnType<typeof projectStudioAgentPanel>) =>
      state.timeline.find((item) => item.kind === "message")?.id;
    expect(rowId(after)).toBe(rowId(before));
  });

  it("still breaks the bubble where the agent put real work between two segments", () => {
    const state = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [
        assistantMessage([
          { type: "text", text: "Reading the bible.", state: "done" },
          {
            type: "data-studio-agent-activity",
            id: "activity-1",
            data: {
              activityId: "activity-1",
              kind: "generate",
              label: "studio_agent.activity.generating_response",
              detail: null,
              progress: null,
              status: "succeeded",
              startedAt: "2026-07-28T10:00:02.000Z",
              completedAt: "2026-07-28T10:00:03.000Z",
            },
          },
          { type: "text", text: "Here is the scene.", state: "streaming" },
        ]),
      ],
      wireRuns: [],
    });

    // Two bubbles, because an activity between them is a real boundary — the
    // continuation merge must not swallow it.
    expect(bubbles(state).map((bubble) => bubble.text)).toEqual([
      "Reading the bible.",
      "Here is the scene.",
    ]);
  });
});

describe("projectStudioAgentPanel — work steps fold into the reply that produced them", () => {
  it("keeps an activity in the position the agent published it, between two runs of text", () => {
    const state = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [
        assistantMessage([
          { type: "text", text: "Reading the bible.", state: "done" },
          activityPart({ activityId: "activity-1", label: "read.bible", status: "succeeded" }),
          { type: "text", text: "Here are the shots.", state: "done" },
        ]),
      ],
      wireRuns: [],
    });

    expect(
      state.timeline.map((item) =>
        item.kind === "message" ? `text:${item.message.text}` : `${item.kind}:${item.id}`
      )
    ).toEqual(["text:Reading the bible.", "activity:activity-1", "text:Here are the shots."]);
  });

  it("replaces a running activity rather than stacking a second row for it", () => {
    const running = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [
        assistantMessage([
          activityPart({ activityId: "activity-1", label: "generate", status: "running" }),
        ]),
      ],
      wireRuns: [],
    });
    const finished = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [
        assistantMessage([
          activityPart({ activityId: "activity-1", label: "generate", status: "succeeded" }),
        ]),
      ],
      wireRuns: [],
    });

    expect(running.timeline).toHaveLength(1);
    expect(finished.timeline).toHaveLength(1);
    expect(activities(finished)[0]?.status).toBe("succeeded");
  });

  it("does not repeat a snapshot activity the channel already delivered as a part", () => {
    const state = projectStudioAgentPanel({
      history: seed({
        activities: [activityView({ id: "activity-1", runId: RUN_ID })],
      }),
      messages: [
        assistantMessage([
          activityPart({ activityId: "activity-1", label: "generate", status: "succeeded" }),
        ]),
      ],
      wireRuns: [],
    });

    expect(activities(state).map((activity) => activity.id)).toEqual(["activity-1"]);
  });

  /**
   * A STEP LEADS TO THE TEXT IT PRODUCED, SO IT RENDERS ABOVE IT.
   *
   * Snapshot activities used to trail their run's messages, which put
   * "Generating response" UNDER the answer it generated — backwards, and against
   * the owner's decision that work steps fold INTO the reply rather than sitting
   * beside it as their own turn.
   */
  it("puts a run's work steps above the reply they produced", () => {
    const state = projectStudioAgentPanel({
      history: seed({ activities: [activityView({ id: "activity-1", runId: RUN_ID })] }),
      messages: [assistantMessage([{ type: "text", text: "Hello.", state: "done" }])],
      wireRuns: [],
    });

    const kinds = state.timeline.map((item) => item.kind);
    expect(kinds.indexOf("activity")).toBeLessThan(kinds.indexOf("message"));
  });

  /**
   * ...but never above the creator's own prompt. The agent had not started
   * working when that was written, so a step in front of it would claim the
   * reply began before the question.
   */
  /**
   * THE PLACEHOLDER GOES WHEN THE THING IT STOOD FOR ARRIVES.
   *
   * `generate` is the reply's own placeholder — while it runs it is the honest
   * "something is happening" signal, and the instant the text is on screen it is
   * a tombstone for work the reader can already see. Leaving it produced
   * "Generating response ✓" sitting under the answer it generated.
   */
  it("drops the reply's placeholder once the reply is on screen", () => {
    const state = projectStudioAgentPanel({
      history: seed({
        activities: [activityView({ id: "activity-1", runId: RUN_ID, kind: "generate" })],
      }),
      messages: [assistantMessage([{ type: "text", text: "Hello.", state: "done" }])],
      wireRuns: [],
    });

    expect(activities(state)).toHaveLength(0);
    expect(bubbles(state)).toHaveLength(1);
  });

  it("keeps it while the reply is still coming, because that is the only sign of life", () => {
    const state = projectStudioAgentPanel({
      history: seed({
        // The run has to be in the snapshot for its steps to have anywhere to
        // hang — in production it always is; this is what a live turn looks like
        // before its first token.
        runs: [runView({ id: RUN_ID, status: "running" })],
        activities: [activityView({ id: "activity-1", runId: RUN_ID, kind: "generate" })],
      }),
      messages: [],
      wireRuns: [],
    });

    expect(activities(state).map((activity) => activity.id)).toEqual(["activity-1"]);
  });

  it("keeps every other kind of step, which still says something after the fact", () => {
    const state = projectStudioAgentPanel({
      history: seed({
        activities: [activityView({ id: "activity-1", runId: RUN_ID, kind: "execute" })],
      }),
      messages: [assistantMessage([{ type: "text", text: "Applied.", state: "done" }])],
      wireRuns: [],
    });

    expect(activities(state).map((activity) => activity.id)).toEqual(["activity-1"]);
  });

  it("never puts a work step above the prompt that asked for it", () => {
    const state = projectStudioAgentPanel({
      history: seed({ activities: [activityView({ id: "activity-1", runId: RUN_ID })] }),
      messages: [
        userMessage("Rewrite scene one.", { runId: RUN_ID }),
        assistantMessage([{ type: "text", text: "Done.", state: "done" }]),
      ],
      wireRuns: [],
    });

    const kinds = state.timeline.map((item) => item.kind);
    expect(kinds.indexOf("message")).toBeLessThan(kinds.indexOf("activity"));
  });
});

describe("projectStudioAgentPanel — a tool call the agent proposed", () => {
  it("renders the library's tool part as the step row, in the position it was published", () => {
    const state = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [
        assistantMessage([
          { type: "text", text: "Applying the edit.", state: "done" },
          toolPart({
            toolCallId: "call-1",
            toolName: "story.canvas.write",
            state: "output-available",
            output: { applied: true },
          }),
        ]),
      ],
      wireRuns: [],
    });

    expect(
      state.timeline.map((item) =>
        item.kind === "message" ? `text:${item.message.text}` : item.kind
      )
    ).toEqual(["text:Applying the edit.", "activity"]);
    const [row] = activities(state);
    expect(row?.kind).toBe("execute");
    expect(row?.label).toBe("story.canvas.write");
    expect(row?.status).toBe("succeeded");
    expect(row?.detail).toContain("applied");
  });

  it("maps the tool part's three states onto the step row's three outcomes", () => {
    const statusFor = (part: StudioAgentUIMessage["parts"][number]) =>
      activities(
        projectStudioAgentPanel({
          history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
          messages: [assistantMessage([part])],
          wireRuns: [],
        })
      )[0]?.status;

    expect(
      statusFor(
        toolPart({
          toolCallId: "call-1",
          toolName: "story.canvas.write",
          state: "input-available",
          input: { sceneId: "scene-1" },
        })
      )
    ).toBe("running");
    expect(
      statusFor(
        toolPart({
          toolCallId: "call-1",
          toolName: "story.canvas.write",
          state: "output-available",
          output: { applied: true },
        })
      )
    ).toBe("succeeded");
    expect(
      statusFor(
        toolPart({
          toolCallId: "call-1",
          toolName: "story.canvas.write",
          state: "output-error",
          errorText: "The scene is locked.",
        })
      )
    ).toBe("failed");
  });

  it("sends the panel back to the control plane when a tool call resolves", () => {
    const proposed = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [
        assistantMessage([
          toolPart({
            toolCallId: "call-1",
            toolName: "story.canvas.write",
            state: "input-available",
            input: { sceneId: "scene-1" },
          }),
        ]),
      ],
      wireRuns: [wireRun(RUN_ID, "active")],
    });
    const resolved = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [
        assistantMessage([
          toolPart({
            toolCallId: "call-1",
            toolName: "story.canvas.write",
            state: "output-available",
            output: { applied: true },
          }),
        ]),
      ],
      wireRuns: [wireRun(RUN_ID, "active")],
    });

    // The capability's effect is a Postgres fact with no wire shape; the tool
    // part settling is the only honest signal that it is time to re-read.
    expect(resolved.revalidationToken).not.toBe(proposed.revalidationToken);
  });
});

describe("projectStudioAgentPanel — a tool call the agent suspended on", () => {
  it("renders an approval-requested tool part as a question, not as a step that is running", () => {
    const state = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [
        assistantMessage([
          { type: "text", text: "This rewrites four scenes.", state: "done" },
          toolPart({
            toolCallId: "call-1",
            toolName: "story.canvas.write",
            state: "approval-requested",
            input: { sceneId: "scene-1" },
            approval: { id: "approval-1" },
          }),
        ]),
      ],
      wireRuns: [],
    });

    // Without a row of its own it falls through to the step mapping and shows a
    // spinner forever: the creator is never asked, so the turn never resumes.
    expect(state.timeline.map((item) => item.kind)).toEqual(["message", "toolApproval"]);
    expect(toolApprovals(state)).toEqual([
      {
        id: "approval-1",
        toolCallId: "call-1",
        toolName: "story.canvas.write",
        runId: RUN_ID,
        input: JSON.stringify({ sceneId: "scene-1" }, null, 2),
        decision: null,
      },
    ]);
  });

  it("keeps the row in place once answered, stating the decision the creator made", () => {
    const approved = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [
        assistantMessage([
          toolPart({
            toolCallId: "call-1",
            toolName: "story.canvas.write",
            state: "approval-responded",
            input: { sceneId: "scene-1" },
            approval: { id: "approval-1", approved: true },
          }),
        ]),
      ],
      wireRuns: [],
    });
    const denied = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [
        assistantMessage([
          toolPart({
            toolCallId: "call-1",
            toolName: "story.canvas.write",
            state: "approval-responded",
            input: { sceneId: "scene-1" },
            approval: { id: "approval-1", approved: false },
          }),
        ]),
      ],
      wireRuns: [],
    });

    expect(toolApprovals(approved)[0]?.decision).toBe("approved");
    expect(toolApprovals(denied)[0]?.decision).toBe("denied");
    // The decision is the panel's signal that the control plane may have moved.
    expect(approved.revalidationToken).not.toBe(denied.revalidationToken);
  });

  it("shows a refused call as stopped rather than as still running", () => {
    const state = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [
        assistantMessage([
          toolPart({
            toolCallId: "call-1",
            toolName: "story.canvas.write",
            state: "output-denied",
            input: { sceneId: "scene-1" },
            approval: { id: "approval-1", approved: false },
          }),
        ]),
      ],
      wireRuns: [],
    });

    // `output-denied` is a terminal state the SDK reaches only through a
    // refusal. Falling through to the default left it spinning for good.
    expect(activities(state).map((activity) => activity.status)).toEqual(["cancelled"]);
  });
});

describe("projectStudioAgentPanel — a turn that is waiting on the creator", () => {
  it("reads a suspended run as waiting, not as working", () => {
    const state = projectStudioAgentPanel({
      history: seed({ runs: [runView({ id: RUN_ID, status: "running" })] }),
      messages: [],
      wireRuns: [wireRun(RUN_ID, "suspended")],
    });

    // The agent has parked and the next move is the creator's. Falling through
    // to the unrecognised-status default made this read `running`, so every
    // subscriber showed 'working' through a silence that was a question.
    expect(state.runs.find((run) => run.id === RUN_ID)?.status).toBe("waiting_for_approval");
  });

  it("does not hand a parked run a finished run's progress", () => {
    const state = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [],
      wireRuns: [wireRun(RUN_ID, "suspended")],
    });

    // progress 1 is what would let the composer unlock on a turn the creator
    // still owes an answer to.
    expect(state.runs.find((run) => run.id === RUN_ID)?.progress).toBeNull();
  });
});

describe("projectStudioAgentPanel — a turn that ends", () => {
  it("unlocks a run the wire ended but the control plane never terminalized", () => {
    const state = projectStudioAgentPanel({
      history: seed({ runs: [runView({ id: RUN_ID, status: "running" })] }),
      messages: [],
      wireRuns: [wireRun(RUN_ID, "complete")],
    });

    expect(state.activeRun).toBeNull();
    expect(state.runs.find((run) => run.id === RUN_ID)?.status).toBe("succeeded");
  });

  it("keeps the control plane's terminal when it has one, because it is the specific one", () => {
    const state = projectStudioAgentPanel({
      history: seed({ runs: [runView({ id: RUN_ID, status: "cancelled" })] }),
      messages: [],
      wireRuns: [wireRun(RUN_ID, "complete")],
    });

    expect(state.runs.find((run) => run.id === RUN_ID)?.status).toBe("cancelled");
  });

  it("settles a dangling tool call when its parent run is cancelled", () => {
    const state = projectStudioAgentPanel({
      history: seed({ runs: [runView({ id: RUN_ID, status: "cancelled" })] }),
      messages: [
        assistantMessage([
          toolPart({
            toolCallId: "call-1",
            toolName: "story_get_snapshot",
            state: "input-available",
            input: { schemaVersion: "story-read/v2" },
          }),
        ]),
      ],
      wireRuns: [],
    });

    expect(activities(state).map((activity) => activity.status)).toEqual(["cancelled"]);
    expect(activities(state)[0]?.completedAt).toBe("2026-07-28T10:00:05.000Z");
  });

  it.each([
    ["story_get_snapshot", "read"],
    ["story_query_source_material", "search"],
    ["story_apply_change_set", "execute"],
    ["future_capability", "execute"],
  ] as const)("projects %s with the correct product activity kind", (toolName, kind) => {
    const state = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [
        assistantMessage([
          toolPart({
            toolCallId: `call-${toolName}`,
            toolName,
            state: "input-available",
            input: {},
          }),
        ]),
      ],
      wireRuns: [wireRun(RUN_ID, "active")],
    });

    expect(activities(state)[0]?.kind).toBe(kind);
  });

  it("settles a dangling snapshot activity when its parent run fails", () => {
    const state = projectStudioAgentPanel({
      history: seed({
        runs: [runView({ id: RUN_ID, status: "failed" })],
        activities: [
          activityView({
            id: "activity-1",
            runId: RUN_ID,
            status: "running",
          }),
        ],
      }),
      messages: [],
      wireRuns: [],
    });

    expect(activities(state).map((activity) => activity.status)).toEqual(["failed"]);
  });

  it("prefers the agent's rich failure over the wire's numeric error", () => {
    const state = projectStudioAgentPanel({
      history: seed({ runs: [runView({ id: RUN_ID, status: "running" })] }),
      messages: [
        assistantMessage([
          {
            type: STUDIO_AGENT_FAILURE_DATA_PART,
            id: `${RUN_ID}:failure`,
            data: {
              runId: RUN_ID,
              error: {
                code: "studio_agent.capability_result_invalid",
                message: "The capability ran but its result was not recorded.",
                retryable: false,
                details: { issues: [{ path: "scenes.0.title", message: "required" }] },
              },
              failedAt: "2026-07-28T10:00:00.000Z",
            },
          },
        ]),
      ],
      wireRuns: [wireRunError(RUN_ID, 50000, "agent stopped")],
    });

    expect(state.turnFailure?.error?.code).toBe("studio_agent.capability_result_invalid");
    expect(state.turnFailure?.error?.details).toEqual({
      issues: [{ path: "scenes.0.title", message: "required" }],
    });
  });

  it("never leaks a raw realtime SDK failure into the creator message flow", () => {
    const state = projectStudioAgentPanel({
      history: seed({ runs: [runView({ id: RUN_ID, status: "running" })] }),
      messages: [userMessage("Hello.", { runId: RUN_ID })],
      wireRuns: [
        wireRunError(
          RUN_ID,
          104008,
          "mutableMessages rejected namespace agent at private upstream host"
        ),
      ],
    });

    expect(state.turnFailure?.error).toMatchObject({
      code: "AGENT_REALTIME_DELIVERY_FAILED",
      messageKey: "agent.error.realtime_delivery_failed",
      retryable: true,
    });
    expect(state.turnFailure?.error?.message).not.toContain("mutableMessages");
    expect(state.turnFailure?.summary).not.toContain("private upstream");
  });

  /**
   * The owner's ruling (2026-07-31): errors are part of the message flow. The
   * pinned card beside the composer is gone, so the newest failed turn MUST
   * render as an in-flow row of the transcript — that row is where the retry
   * affordance lives, and a projection that suppresses it hides the failure.
   */
  it("renders the newest failed turn as one in-flow row after its own messages", () => {
    const state = projectStudioAgentPanel({
      history: seed({ runs: [runView({ id: RUN_ID, status: "failed" })] }),
      messages: [
        userMessage("Hello.", { runId: RUN_ID }),
        assistantMessage([{ type: "text", text: "Hello back.", state: "done" }]),
      ],
      wireRuns: [],
    });

    expect(bubbles(state).map((bubble) => bubble.text)).toEqual(["Hello.", "Hello back."]);
    const runRows = state.timeline.filter((item) => item.kind === "run");
    expect(runRows).toHaveLength(1);
    expect(runRows[0]?.id).toBe(RUN_ID);
    // In flow: after the turn's messages, not pinned outside the conversation.
    expect(state.timeline.at(-1)?.kind).toBe("run");
    expect(state.turnFailure?.id).toBe(RUN_ID);
  });

  it("renders the newest failure exactly once — no pinned duplicate, no missing row", () => {
    const state = projectStudioAgentPanel({
      history: seed({ runs: [runView({ id: RUN_ID, status: "failed" })] }),
      messages: [userMessage("Hello.", { runId: RUN_ID })],
      wireRuns: [],
    });

    expect(state.timeline.filter((item) => item.kind === "run" && item.id === RUN_ID)).toHaveLength(
      1
    );
    expect(state.turnFailure?.id).toBe(RUN_ID);
  });

  it("keeps the newest failure's row even when a failed step already tells its story", () => {
    // An OLDER failure whose non-execute step failed loudly is suppressed —
    // its activity row is the record. The NEWEST failure is different: its row
    // carries the retry affordance, so the loud step must not swallow it.
    const OLD_RUN_ID = "00000000-0000-4000-8000-000000000012";
    const state = projectStudioAgentPanel({
      history: seed({
        runs: [
          {
            ...runView({ id: OLD_RUN_ID, status: "failed" }),
            createdAt: "2026-07-28T09:00:00.000Z",
          },
          runView({ id: RUN_ID, status: "failed" }),
        ],
        activities: [
          {
            ...activityView({
              id: "old-generate",
              runId: OLD_RUN_ID,
              kind: "generate",
              status: "failed",
            }),
            startedAt: "2026-07-28T09:00:00.000Z",
          },
          activityView({ id: "new-generate", runId: RUN_ID, kind: "generate", status: "failed" }),
        ],
      }),
      messages: [],
      wireRuns: [],
    });

    const runRows = state.timeline.filter((item) => item.kind === "run");
    expect(runRows.map((item) => item.id)).toEqual([RUN_ID]);
    expect(state.turnFailure?.id).toBe(RUN_ID);
  });

  it("appends the newest failure when no durable row or message can position it", () => {
    // A wire-only terminal: the domain never recorded the run and no message
    // mentions it, so nothing in the draft items would ever flush a row for
    // it. It is still the newest turn's outcome and must reach the timeline.
    const state = projectStudioAgentPanel({
      history: seed({}),
      messages: [userMessage("Hello.", { runId: null })],
      wireRuns: [wireRunError(RUN_ID, 50000, "agent stopped")],
    });

    expect(state.turnFailure?.id).toBe(RUN_ID);
    const runRows = state.timeline.filter((item) => item.kind === "run");
    expect(runRows.map((item) => item.id)).toEqual([RUN_ID]);
    expect(state.timeline.at(-1)?.kind).toBe("run");
  });
});

describe("projectStudioAgentPanel — non-canonical canvas preview", () => {
  const preview = {
    schemaVersion: "story-canvas-preview/v1" as const,
    previewId: "preview-1",
    runId: RUN_ID,
    toolCallId: "call-write-1",
    chapterId: "00000000-0000-4000-8000-000000000020",
    baseDraftRevision: 7,
    baseContentHash: "a".repeat(64),
    baseLayoutRevision: 3,
    title: "Add the arrival scene",
    summary: "Adds one scene after the opening.",
    operations: [
      {
        kind: "story_graph.put_node" as const,
        payload: {
          intent: "create",
          node: {
            kind: "clip",
            nodeId: "arrival",
            clipKey: "ARRIVAL",
            description: "She arrives.",
            exit: { kind: "auto", nextNodeId: null },
          },
        },
      },
    ],
  };

  it("exposes an unsettled proposal without adding noise to the message river", () => {
    const state = projectStudioAgentPanel({
      history: seed({ runs: [runView({ id: RUN_ID, status: "running" })] }),
      messages: [
        assistantMessage([
          {
            type: STUDIO_AGENT_CANVAS_PREVIEW_DATA_PART,
            id: preview.previewId,
            data: preview,
          },
        ]),
      ],
      wireRuns: [],
    });

    expect(state.activeCanvasPreview).toEqual(preview);
    expect(state.timeline).toEqual([]);
  });

  it.each(["output-available", "output-error", "output-denied"] as const)(
    "discards the ghost overlay when the matching tool reaches %s",
    (toolState) => {
      const state = projectStudioAgentPanel({
        history: seed({ runs: [runView({ id: RUN_ID, status: "running" })] }),
        messages: [
          assistantMessage([
            {
              type: STUDIO_AGENT_CANVAS_PREVIEW_DATA_PART,
              id: preview.previewId,
              data: preview,
            },
            toolPart({
              toolCallId: preview.toolCallId,
              toolName: "story_apply_change_set",
              state: toolState,
              input: {},
              ...(toolState === "output-available" ? { output: { status: "succeeded" } } : {}),
              ...(toolState === "output-error" ? { errorText: "conflict" } : {}),
            }),
          ]),
        ],
        wireRuns: [],
      });

      expect(state.activeCanvasPreview).toBeNull();
    }
  );

  it("discards the ghost overlay when the parent run terminalizes", () => {
    const state = projectStudioAgentPanel({
      history: seed({ runs: [runView({ id: RUN_ID, status: "failed" })] }),
      messages: [
        assistantMessage([
          {
            type: STUDIO_AGENT_CANVAS_PREVIEW_DATA_PART,
            id: preview.previewId,
            data: preview,
          },
        ]),
      ],
      wireRuns: [],
    });

    expect(state.activeCanvasPreview).toBeNull();
  });
});

describe("projectStudioAgentPanel — when to re-read the control plane", () => {
  it("changes the token when a run's wire lifecycle moves", () => {
    const before = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [],
      wireRuns: [wireRun(RUN_ID, "active")],
    });
    const after = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [],
      wireRuns: [wireRun(RUN_ID, "complete")],
    });

    expect(after.revalidationToken).not.toBe(before.revalidationToken);
  });

  it("changes the token when an agent step reaches a terminal status mid-run", () => {
    const before = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [
        assistantMessage([
          activityPart({ activityId: "activity-1", label: "generate", status: "running" }),
        ]),
      ],
      wireRuns: [wireRun(RUN_ID, "active")],
    });
    const after = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [
        assistantMessage([
          activityPart({ activityId: "activity-1", label: "generate", status: "succeeded" }),
        ]),
      ],
      wireRuns: [wireRun(RUN_ID, "active")],
    });

    expect(after.revalidationToken).not.toBe(before.revalidationToken);
  });

  it("holds the token still when nothing on the wire moved", () => {
    const input = {
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [
        assistantMessage([{ type: "text" as const, text: "Hi.", state: "done" as const }]),
      ],
      wireRuns: [wireRun(RUN_ID, "active")],
    };
    expect(projectStudioAgentPanel(input).revalidationToken).toBe(
      projectStudioAgentPanel(input).revalidationToken
    );
  });
});

describe("projectStudioAgentPanel — a prompt sent into a live turn", () => {
  it("shows the steer immediately, then drops the echo once the channel carries it", () => {
    const steer = userMessage("Make it darker.", { runId: RUN_ID, id: "steer-1" });

    const optimistic = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [assistantMessage([{ type: "text", text: "Drafting.", state: "streaming" }])],
      wireRuns: [wireRun(RUN_ID, "active")],
      pending: [steer],
    });
    expect(bubbles(optimistic).map((bubble) => bubble.text)).toEqual([
      "Drafting.",
      "Make it darker.",
    ]);

    const echoed = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [
        assistantMessage([{ type: "text", text: "Drafting.", state: "streaming" }]),
        steer,
      ],
      wireRuns: [wireRun(RUN_ID, "active")],
      pending: [steer],
    });
    expect(bubbles(echoed).map((bubble) => bubble.text)).toEqual(["Drafting.", "Make it darker."]);
  });

  it("keeps an optimistic prompt's row key when its durable id differs", () => {
    const clientMessageId = "client-message-1";
    const optimistic: StudioAgentUIMessage = {
      ...userMessage("Add a node.", { runId: null, id: "optimistic-id" }),
      metadata: {
        ...userMessage("Add a node.", { runId: null }).metadata,
        clientMessageId,
      },
    };
    const durable: StudioAgentUIMessage = {
      ...optimistic,
      id: "durable-id",
      metadata: {
        ...optimistic.metadata,
        runId: RUN_ID,
      },
    };
    const before = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [],
      pending: [optimistic],
      wireRuns: [],
    });
    const after = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [durable],
      pending: [optimistic],
      wireRuns: [],
    });

    expect(before.timeline.find((item) => item.kind === "message")?.id).toBe(
      after.timeline.find((item) => item.kind === "message")?.id
    );
  });
});

/**
 * A run the transcript never mentions still has a place in it.
 *
 * The control plane reports a turn REJECTED at admission as `failed`, and such
 * a turn never persists a prompt — so the conversation carries no message that
 * names it. It is real and the creator is owed its outcome; what it is not is
 * the outcome of whatever happens to be the newest turn.
 *
 * The fixture is the live 2026-07-31 conversation: an admission rejection at
 * 12:23 that produced no message, a failed turn at 14:26 that produced both,
 * and a successful turn at 14:34.
 */
describe("projectStudioAgentPanel — a run the conversation never mentioned", () => {
  const ORPHAN_RUN_ID = "019fb820-deb1-76e4-8ea1-dec307be064b";
  const FAILED_RUN_ID = "019fb891-ff0f-7568-ad64-cb4e49790f8d";
  const SUCCEEDED_RUN_ID = "019fb899-0dd7-730c-a960-9a908344aa45";

  const state = () =>
    projectStudioAgentPanel({
      history: seed({
        runs: [
          {
            ...runView({ id: ORPHAN_RUN_ID, status: "failed" }),
            createdAt: "2026-07-31T12:23:09.745Z",
            completedAt: "2026-07-31T12:25:34.340Z",
            summary: "StoryOS could not start this request after repeated attempts.",
            error: {
              code: "AGENT_ADMISSION_EXHAUSTED",
              message: "StoryOS could not start this request after repeated attempts.",
              retryable: true,
              details: null,
            },
          },
          {
            ...runView({ id: FAILED_RUN_ID, status: "failed" }),
            createdAt: "2026-07-31T14:26:43.599Z",
            completedAt: "2026-07-31T14:27:03.467Z",
            summary: "StoryOS could not complete this request. Please retry.",
            error: {
              code: "AGENT_MESSAGE_RUN_IDENTITY_MISMATCH",
              message: "StoryOS could not complete this request. Please retry.",
              retryable: false,
              details: null,
            },
          },
          {
            ...runView({ id: SUCCEEDED_RUN_ID, status: "succeeded" }),
            createdAt: "2026-07-31T14:34:26.135Z",
            completedAt: "2026-07-31T14:34:32.473Z",
          },
        ],
      }),
      messages: [
        turnMessage({
          id: "db61e323-04b0-4b5d-b58f-344e5221e081",
          role: "user",
          runId: FAILED_RUN_ID,
          createdAt: "2026-07-31T14:26:45.879Z",
          parts: [{ type: "text", text: "Break this screenplay down.", state: "done" }],
        }),
        turnMessage({
          id: "8b822a3b-2159-4f42-ae3f-528f396a2d7b",
          role: "assistant",
          runId: FAILED_RUN_ID,
          createdAt: "2026-07-31T14:26:45.934Z",
          parts: [
            { type: "text", text: "Analysing the screenplay now.", state: "done" },
            toolPart({
              toolCallId: "call-analysis",
              toolName: "story_get_source_analysis",
              state: "output-error",
              errorText: "The analysis is not ready yet.",
            }),
          ],
        }),
        turnMessage({
          id: "9463e177-af7e-489e-b739-e73ac1fdf8cc",
          role: "user",
          runId: SUCCEEDED_RUN_ID,
          createdAt: "2026-07-31T14:34:28.061Z",
          parts: [{ type: "text", text: "Reply with two characters only.", state: "done" }],
        }),
        turnMessage({
          id: "4c623a3e-ffe2-4f0c-a9a1-9e4e96903a26",
          role: "assistant",
          runId: SUCCEEDED_RUN_ID,
          createdAt: "2026-07-31T14:34:28.091Z",
          parts: [{ type: "text", text: "Received.", state: "done" }],
        }),
      ],
      wireRuns: [],
    });

  it("does not hang its outcome off a later turn that succeeded", () => {
    const timeline = state().timeline;

    expect(timeline.at(-1)).toMatchObject({ kind: "message" });
    expect(
      timeline
        .slice(timeline.findIndex((item) => item.id.startsWith("9463e177")))
        .map((item) => item.kind)
    ).toEqual(["message", "message"]);
  });

  it("states it where it happened, above the turns that came after it", () => {
    const timeline = state().timeline;

    expect(timeline.map((item) => item.kind)).toEqual([
      "run",
      "message",
      "message",
      "activity",
      "run",
      "message",
      "message",
    ]);
    expect(timeline.flatMap((item) => (item.kind === "run" ? [item.run.id] : []))).toEqual([
      ORPHAN_RUN_ID,
      FAILED_RUN_ID,
    ]);
  });
});

describe("projectStudioAgentPanel — attachments and child runs", () => {
  it("hangs a prompt's attachments off its own bubble", () => {
    const state = projectStudioAgentPanel({
      history: EMPTY_STUDIO_AGENT_HISTORY_SEED,
      messages: [
        {
          id: "message-1",
          role: "user",
          metadata: { threadId: THREAD_ID, createdAt: "2026-07-28T10:00:00.000Z" },
          parts: [
            { type: "text", text: "Use this reference.", state: "done" },
            {
              type: STUDIO_AGENT_ATTACHMENT_DATA_PART,
              id: "attachment-1",
              data: {
                type: "attachment",
                attachmentId: "attachment-1",
                fileName: "reference.png",
                mediaType: "image/png",
                sizeBytes: 2048,
                status: "ready",
              },
            },
          ],
        },
      ],
      wireRuns: [],
    });

    const [bubble] = state.timeline;
    expect(bubble?.kind).toBe("message");
    if (bubble?.kind !== "message") throw new Error("expected a message row");
    expect(bubble.message.attachments.map((attachment) => attachment.fileName)).toEqual([
      "reference.png",
    ]);
  });

  it("keeps a delegated task out of the root timeline and reachable as a child run", () => {
    const state = projectStudioAgentPanel({
      history: seed({
        runs: [
          runView({ id: RUN_ID, status: "running" }),
          {
            ...runView({ id: CHILD_RUN_ID, status: "failed" }),
            parentRunId: RUN_ID,
            title: "Generate shots",
          },
        ],
      }),
      messages: [],
      wireRuns: [],
    });

    expect(state.timeline).toHaveLength(0);
    expect(selectStudioAgentChildRuns(state, RUN_ID).map((run) => run.id)).toEqual([CHILD_RUN_ID]);
  });
});

function bubbles(state: ReturnType<typeof projectStudioAgentPanel>) {
  return state.timeline.flatMap((item) =>
    item.kind === "message"
      ? [{ role: item.message.role, text: item.message.text, streaming: item.message.streaming }]
      : []
  );
}

function activities(state: ReturnType<typeof projectStudioAgentPanel>) {
  return state.timeline.flatMap((item) => (item.kind === "activity" ? [item.activity] : []));
}

function toolApprovals(state: ReturnType<typeof projectStudioAgentPanel>) {
  return state.timeline.flatMap((item) =>
    item.kind === "toolApproval" ? [item.toolApproval] : []
  );
}

function seed(overrides: {
  runs?: StudioAgentRunView[];
  activities?: StudioAgentActivityView[];
}): StudioAgentHistorySeed {
  return { ...EMPTY_STUDIO_AGENT_HISTORY_SEED, ...overrides };
}

function assistantMessage(parts: StudioAgentUIMessage["parts"]): StudioAgentUIMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    metadata: {
      threadId: THREAD_ID,
      runId: RUN_ID,
      createdAt: "2026-07-28T10:00:01.000Z",
      format: "markdown",
    },
    parts,
  };
}

function userMessage(
  text: string,
  { runId, id = "user-1" }: { runId: string | null; id?: string }
): StudioAgentUIMessage {
  return {
    id,
    role: "user",
    metadata: {
      threadId: THREAD_ID,
      ...(runId === null ? {} : { runId }),
      createdAt: "2026-07-28T10:00:00.000Z",
      format: "plain_text",
    },
    parts: [{ type: "text", text, state: "done" }],
  };
}

/** A durable history message: every one carries its own run and timestamp. */
function turnMessage(input: {
  id: string;
  role: "user" | "assistant";
  runId: string;
  createdAt: string;
  parts: StudioAgentUIMessage["parts"];
}): StudioAgentUIMessage {
  return {
    id: input.id,
    role: input.role,
    metadata: {
      threadId: THREAD_ID,
      runId: input.runId,
      createdAt: input.createdAt,
      format: input.role === "user" ? "plain_text" : "markdown",
    },
    parts: input.parts,
  };
}

function activityPart(input: {
  activityId: string;
  label: string;
  /** Defaults to a real work step. `generate` is the REPLY'S placeholder and is
   *  suppressed once the reply lands, so a test about positioning must not use
   *  it by accident. */
  kind?: StudioAgentActivityView["kind"];
  status: "running" | "succeeded" | "failed" | "cancelled";
}): StudioAgentUIMessage["parts"][number] {
  return {
    type: STUDIO_AGENT_ACTIVITY_DATA_PART,
    id: input.activityId,
    data: {
      activityId: input.activityId,
      kind: input.kind ?? "execute",
      label: input.label,
      status: input.status,
      detail: null,
      progress: null,
      startedAt: "2026-07-28T10:00:00.000Z",
      completedAt: input.status === "running" ? null : "2026-07-28T10:00:05.000Z",
    },
  };
}

/**
 * A tool call exactly as the AI SDK puts it on the wire.
 *
 * The transport carries these natively — `streamText` emits the part, the agent
 * publishes the result back onto the same part — which is what retired our
 * `action.proposed` / `action.started` / `action.completed` trio.
 */
function toolPart(input: {
  toolCallId: string;
  toolName: string;
  state:
    | "input-available"
    | "approval-requested"
    | "approval-responded"
    | "output-available"
    | "output-error"
    | "output-denied";
  input?: unknown;
  output?: unknown;
  errorText?: string;
  /** Present on every approval state; `approval.id` is what the creator answers. */
  approval?: { id: string; approved?: boolean };
}): StudioAgentUIMessage["parts"][number] {
  return {
    type: `tool-${input.toolName}`,
    toolCallId: input.toolCallId,
    state: input.state,
    input: input.input,
    output: input.output,
    errorText: input.errorText,
    approval: input.approval,
  } as StudioAgentUIMessage["parts"][number];
}

function runView(input: { id: string; status: StudioAgentRunView["status"] }): StudioAgentRunView {
  return {
    id: input.id,
    parentRunId: null,
    title: "",
    summary: null,
    error: null,
    status: input.status,
    progress: null,
    createdAt: "2026-07-28T10:00:00.000Z",
    startedAt: "2026-07-28T10:00:00.000Z",
    completedAt:
      input.status === "succeeded" || input.status === "failed" || input.status === "cancelled"
        ? "2026-07-28T10:00:05.000Z"
        : null,
  };
}

function activityView(input: {
  id: string;
  runId: string;
  kind?: StudioAgentActivityView["kind"];
  status?: StudioAgentActivityView["status"];
}): StudioAgentActivityView {
  return {
    id: input.id,
    runId: input.runId,
    parentActivityId: null,
    kind: input.kind ?? "execute",
    label: "generate",
    detail: null,
    progress: null,
    status: input.status ?? "succeeded",
    startedAt: "2026-07-28T10:00:00.000Z",
    completedAt: input.status === "running" ? null : "2026-07-28T10:00:05.000Z",
  };
}

function wireRun(
  runId: string,
  status: "active" | "suspended" | "complete" | "cancelled"
): RunInfo {
  return { runId, clientId: "client", invocationId: "invocation", steps: [], status };
}

function wireRunError(runId: string, code: number, message: string): RunInfo {
  return {
    runId,
    clientId: "client",
    invocationId: "invocation",
    steps: [],
    status: "error",
    error: { code, message, statusCode: 500 } as RunInfo["error"] & object,
  };
}
