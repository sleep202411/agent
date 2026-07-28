import { describe, expect, it } from "vitest";

import {
  toStudioAgentToolApprovalInvocation,
  type StudioAgentUIMessage,
} from "./transport-contract";

const THREAD_ID = "019f8d10-0000-7000-8000-000000000001";
const RUN_ID = "019f8d10-0000-7000-8000-000000000004";

/**
 * THE PRODUCER THE SHIPPED APPROVAL UI NEVER HAD.
 *
 * `StudioAgentToolApproval`, the `toolApproval` timeline row,
 * `addToolApprovalResponse` and three locale files were all in the tree with
 * nothing on either side of them: the worker never marked a tool
 * `needsApproval`, so no `tool-approval-request` ever reached the browser, and
 * the continuation the creator's answer fires carried no body the control plane
 * could route. This function is that body.
 *
 * It has to read the answer back off the OVERLAY, because the continuation is
 * the one `useChat` send that carries no new message: the library recognises it
 * by "last message is an assistant already in the tree", derives the
 * `tool-approval-response` inputs from the overlay-vs-tree difference, and POSTs
 * with `messages` empty.
 */
describe("toStudioAgentToolApprovalInvocation", () => {
  it("carries every answered tool call, addressed by toolCallId, for the run the assistant names", () => {
    const body = toStudioAgentToolApprovalInvocation(THREAD_ID, [
      userMessage(),
      assistant([answered("call-1", true), answered("call-2", false)]),
    ]);

    expect(body).toEqual({
      kind: "tool_approval",
      threadId: THREAD_ID,
      // From the assistant's metadata — the same run the library stamps as the
      // continuation's `run-id` header, which is what makes the agent publish
      // `ai-run-resume` instead of a second `ai-run-start`.
      targetRunId: RUN_ID,
      decisions: [
        { toolCallId: "call-1", approved: true },
        { toolCallId: "call-2", approved: false },
      ],
    });
  });

  /**
   * A refusal is a decision, not an absence. Dropping it would leave the run
   * parked on an approval the creator has already answered.
   */
  it("keeps a denial as a decision", () => {
    const body = toStudioAgentToolApprovalInvocation(THREAD_ID, [
      assistant([answered("call-1", false)]),
    ]);

    expect(body?.decisions).toEqual([{ toolCallId: "call-1", approved: false }]);
  });

  it("declines a still-pending approval, which the creator has not answered", () => {
    const body = toStudioAgentToolApprovalInvocation(THREAD_ID, [assistant([pending("call-1")])]);

    expect(body).toBeNull();
  });

  it("declines a continuation with no approval on it rather than mislabelling it", () => {
    expect(
      toStudioAgentToolApprovalInvocation(THREAD_ID, [userMessage(), assistant([])])
    ).toBeNull();
    expect(toStudioAgentToolApprovalInvocation(THREAD_ID, [userMessage()])).toBeNull();
  });

  /**
   * An assistant with no `runId` is one the agent never stamped — a local
   * optimistic row. There is no run to resume, so there is nothing to send.
   */
  it("declines when the answered message names no run", () => {
    const message = assistant([answered("call-1", true)]);
    const body = toStudioAgentToolApprovalInvocation(THREAD_ID, [
      { ...message, metadata: { threadId: THREAD_ID } },
    ]);

    expect(body).toBeNull();
  });

  /**
   * `useChat` answers the approvals on the message they were requested on, and
   * a steer can land after it. The decision belongs to the LAST ASSISTANT, not
   * to the trailing message.
   */
  it("reads the last assistant even when a later user message trails it", () => {
    const body = toStudioAgentToolApprovalInvocation(THREAD_ID, [
      assistant([answered("call-1", true)]),
      userMessage("Actually, hold on."),
    ]);

    expect(body?.decisions).toEqual([{ toolCallId: "call-1", approved: true }]);
  });
});

function userMessage(text = "Delete scene one."): StudioAgentUIMessage {
  return {
    id: "user-1",
    role: "user",
    metadata: { threadId: THREAD_ID },
    parts: [{ type: "text", text, state: "done" }],
  };
}

function assistant(parts: StudioAgentUIMessage["parts"]): StudioAgentUIMessage {
  return {
    id: "assistant-1",
    role: "assistant",
    metadata: {
      threadId: THREAD_ID,
      runId: RUN_ID,
      rootRunId: RUN_ID,
      parentRunId: null,
      kind: "turn",
    },
    parts,
  };
}

/** The part shape `addToolApprovalResponse` leaves behind. */
function answered(toolCallId: string, approved: boolean): StudioAgentUIMessage["parts"][number] {
  return {
    type: "dynamic-tool",
    toolName: "cap_story_canvas_delete_scene_abc123abc123",
    toolCallId,
    state: "approval-responded",
    input: { sceneId: "scene-1" },
    approval: { id: `sdk-approval-${toolCallId}`, approved },
  };
}

/** The part shape `streamText` publishes for a gated call, before any answer. */
function pending(toolCallId: string): StudioAgentUIMessage["parts"][number] {
  return {
    type: "dynamic-tool",
    toolName: "cap_story_canvas_delete_scene_abc123abc123",
    toolCallId,
    state: "approval-requested",
    input: { sceneId: "scene-1" },
    approval: { id: `sdk-approval-${toolCallId}` },
  };
}
