import {
  STUDIO_AGENT_SCHEMA_VERSION,
  type StudioAgentAction,
  type StudioAgentMessage,
  type StudioAgentThreadSnapshot,
} from "@repo/shared";
import { describe, expect, it } from "vitest";

import {
  createStudioAgentHistorySeed,
  prependStudioAgentHistorySeed,
  refreshStudioAgentHistorySeed,
} from "./history-seed";
import { STUDIO_AGENT_ATTACHMENT_DATA_PART } from "./transport-contract";

const THREAD_ID = "00000000-0000-4000-8000-000000000001";
const RUN_ID = "00000000-0000-4000-8000-000000000010";

describe("createStudioAgentHistorySeed", () => {
  it("keys the seam on the domain message id, which is the only id the channel also carries", () => {
    const seed = createStudioAgentHistorySeed(
      snapshot({
        messages: [
          message({ messageId: "message-2", ordinal: 2, role: "assistant", text: "Second." }),
          message({ messageId: "message-1", ordinal: 1, role: "user", text: "First." }),
        ],
      })
    );

    expect(seed.messages.map((entry) => entry.id)).toEqual(["message-1", "message-2"]);
    expect([...seed.messageIds]).toEqual(["message-1", "message-2"]);
  });

  /**
   * THE SEAM, AND THE DUPLICATE TURN IT CAUSED.
   *
   * `useMessagesWithSeed` walks the channel backwards until it meets the newest
   * SEEDED id. A user message reaches Ably under the id the BROWSER minted —
   * stored as `clientMessageId` — while the server keeps a row id of its own
   * that has never been on the channel. Seeding the row id makes the seam
   * unfindable, so the walk appends the entire live window and the creator
   * watches the turn they just had render a second time. Observed in
   * production; a refresh "fixed" it only because by then the assistant message
   * (whose ids do agree) was the newest seeded one.
   */
  it("seeds a user message under the id the channel carries, not the server's row id", () => {
    const seed = createStudioAgentHistorySeed(
      snapshot({
        messages: [
          {
            ...message({ messageId: "row-id-v7", ordinal: 1, role: "user", text: "你好" }),
            clientMessageId: "channel-id-v4",
          },
        ],
      })
    );

    expect(seed.messages[0]?.id).toBe("channel-id-v4");
    // And the projection's own seed/live discriminator has to agree with it.
    expect([...seed.messageIds]).toEqual(["channel-id-v4"]);
  });

  it("seeds an assistant message under its row id, which IS its channel id", () => {
    // The control plane allocates the assistant id and the agent publishes under
    // it, so there is no second id to prefer — and no `clientMessageId` either.
    const seed = createStudioAgentHistorySeed(
      snapshot({
        messages: [
          message({ messageId: "assistant-row-id", ordinal: 1, role: "assistant", text: "Hi." }),
        ],
      })
    );

    expect(seed.messages[0]?.id).toBe("assistant-row-id");
  });

  it("carries an attachment as the data part the composer republishes", () => {
    const seed = createStudioAgentHistorySeed(
      snapshot({
        messages: [
          {
            ...message({ messageId: "message-1", ordinal: 1, role: "user", text: "Look." }),
            parts: [
              { type: "text", format: "plain_text", text: "Look." },
              {
                type: "attachment",
                attachmentId: "attachment-1",
                fileName: "board.png",
                mediaType: "image/png",
                sizeBytes: 1024,
                status: "ready",
              },
            ],
          },
        ],
      })
    );

    expect(seed.messages[0]?.parts.map((part) => part.type)).toEqual([
      "text",
      STUDIO_AGENT_ATTACHMENT_DATA_PART,
    ]);
  });
});

describe("the write token", () => {
  it("moves only when a capability action reaches a terminal status", () => {
    const proposed = createStudioAgentHistorySeed(
      snapshot({ actions: [action({ actionId: "action-1", status: "running", completed: false })] })
    );
    const running = createStudioAgentHistorySeed(
      snapshot({ actions: [action({ actionId: "action-1", status: "running", completed: false })] })
    );
    const succeeded = createStudioAgentHistorySeed(
      snapshot({
        actions: [action({ actionId: "action-1", status: "succeeded", completed: true })],
      })
    );

    expect(running.writeToken).toBe(proposed.writeToken);
    expect(succeeded.writeToken).not.toBe(proposed.writeToken);
  });

  it("counts a write the server could not record, because the draft may still have moved", () => {
    const failed = createStudioAgentHistorySeed(
      snapshot({ actions: [action({ actionId: "action-1", status: "failed", completed: true })] })
    );
    expect(failed.writeToken).toContain("action-1:failed");
  });

  it("does not move when an older page is paged in behind the current window", () => {
    const current = createStudioAgentHistorySeed(
      snapshot({
        messages: [message({ messageId: "message-2", ordinal: 2, role: "user", text: "Now." })],
        actions: [action({ actionId: "action-2", status: "succeeded", completed: true })],
      })
    );
    const older = createStudioAgentHistorySeed(
      snapshot({
        messages: [message({ messageId: "message-1", ordinal: 1, role: "user", text: "Before." })],
        actions: [action({ actionId: "action-1", status: "succeeded", completed: true })],
      })
    );

    const merged = prependStudioAgentHistorySeed(current, older);
    expect(merged.messages.map((entry) => entry.id)).toEqual(["message-1", "message-2"]);
    expect(merged.writeToken).toBe(current.writeToken);
  });
});

/**
 * WHERE THE AGENT WROTE, so the canvas can show it instead of silently
 * re-rendering a graph that moved under the creator.
 */
describe("the written nodes", () => {
  function patchAction(input: {
    actionId: string;
    status: StudioAgentAction["status"];
    completedAt: string | null;
    nodeIds: string[];
  }): StudioAgentAction {
    return {
      ...action({
        actionId: input.actionId,
        status: input.status,
        completed: input.completedAt !== null,
      }),
      completedAt: input.completedAt,
      input: {
        projectId: "019f7243-20c1-7054-a6fa-0a33da6efef1",
        chapterId: "93841064-8f71-4907-bce2-01d2653d18d6",
        baseDraftRevision: 1,
        baseLayoutRevision: 1,
        operations: input.nodeIds.map((nodeId, index) => ({
          operationId: `7d40bb58-b1c1-8056-9d29-92f3860c78f${index}`,
          kind: "story_graph.put_node",
          summary: "Write a story graph node.",
          payload: {
            intent: "create",
            node: {
              kind: "text",
              nodeId,
              title: { "en-US": "A node" },
              body: { "en-US": "Body." },
              exit: { kind: "auto", nextNodeId: null },
            },
          },
        })),
      } as StudioAgentAction["input"],
    };
  }

  it("points at the node the newest applied write touched", () => {
    const seed = createStudioAgentHistorySeed(
      snapshot({
        actions: [
          patchAction({
            actionId: "action-1",
            status: "succeeded",
            completedAt: "2026-07-28T10:00:02.000Z",
            nodeIds: ["older_node"],
          }),
          patchAction({
            actionId: "action-2",
            status: "succeeded",
            completedAt: "2026-07-28T10:00:09.000Z",
            nodeIds: ["newest_node"],
          }),
        ],
      })
    );

    // A viewport can point at one place; the history of every edit is not a
    // destination.
    expect(seed.writtenNodeIds).toEqual(["newest_node"]);
  });

  it("points nowhere for a write that failed, because it cannot be shown honestly", () => {
    const seed = createStudioAgentHistorySeed(
      snapshot({
        actions: [
          patchAction({
            actionId: "action-1",
            status: "failed",
            completedAt: "2026-07-28T10:00:02.000Z",
            nodeIds: ["never_written"],
          }),
        ],
      })
    );

    expect(seed.writtenNodeIds).toEqual([]);
  });

  it("points nowhere for a capability that wrote no node at all", () => {
    const seed = createStudioAgentHistorySeed(
      snapshot({
        actions: [action({ actionId: "action-1", status: "succeeded", completed: true })],
      })
    );

    expect(seed.writtenNodeIds).toEqual([]);
  });
});

describe("refreshStudioAgentHistorySeed", () => {
  it("takes the fresh window and keeps the earlier pages already paged in", () => {
    const loaded = prependStudioAgentHistorySeed(
      createStudioAgentHistorySeed(
        snapshot({
          messages: [message({ messageId: "message-2", ordinal: 2, role: "user", text: "Now." })],
        })
      ),
      createStudioAgentHistorySeed(
        snapshot({
          messages: [
            message({ messageId: "message-1", ordinal: 1, role: "user", text: "Before." }),
          ],
        })
      )
    );

    const refreshed = refreshStudioAgentHistorySeed(
      loaded,
      createStudioAgentHistorySeed(
        snapshot({
          messages: [
            message({ messageId: "message-2", ordinal: 2, role: "user", text: "Now." }),
            message({
              messageId: "message-3",
              ordinal: 3,
              role: "assistant",
              text: "Understood.",
            }),
          ],
          actions: [action({ actionId: "action-1", status: "succeeded", completed: true })],
        })
      )
    );

    expect(refreshed.messages.map((entry) => entry.id)).toEqual([
      "message-1",
      "message-2",
      "message-3",
    ]);
    expect(refreshed.writeToken).toContain("action-1:succeeded");
  });
});

/**
 * A reload while the agent is parked on a question.
 *
 * This is the one thing a refresh could destroy: the approval renders as a tool
 * part, tool parts are not persisted (`parts` is `text | attachment | resource`),
 * and `useMessagesWithSeed` seams on the newest seeded message so the channel's
 * richer copy of that same message is never walked. Rebuilt from the snapshot's
 * own approval + action rows, or the creator comes back to a turn waiting on them
 * with no way to answer it.
 */
describe("createStudioAgentHistorySeed — a parked approval survives a reload", () => {
  it("puts the unanswered approval back on the assistant message that asked", () => {
    const seed = createStudioAgentHistorySeed(
      snapshot({
        messages: [
          message({ messageId: "message-1", ordinal: 1, role: "user", text: "Rewrite scene one." }),
          message({ messageId: "message-2", ordinal: 2, role: "assistant", text: "On it." }),
        ],
        actions: [
          action({
            actionId: "action-1",
            status: "waiting_for_approval",
            completed: false,
            toolCallId: "call_abc",
            actionInput: { sceneId: "s1" },
          }),
        ],
        approvals: [approval({ approvalId: "approval-1", actionId: "action-1" })],
      })
    );

    const parked = seed.messages
      .flatMap((entry) => entry.parts)
      .filter((part) => part.type.startsWith("tool-"));

    expect(parked).toHaveLength(1);
    expect(parked[0]).toMatchObject({
      type: "tool-cap_story_scene_write_9f2c1a4b7e60",
      toolCallId: "call_abc",
      state: "approval-requested",
      input: { sceneId: "s1" },
      // The DURABLE approval id, so `addToolApprovalResponse` answers the same
      // question the live part would have, across any number of reloads.
      approval: { id: "approval-1" },
    });
    // It belongs to the message that made the call, not the creator's prompt.
    expect(seed.messages[1]?.parts.some((part) => part.type.startsWith("tool-"))).toBe(true);
    expect(seed.messages[0]?.parts.some((part) => part.type.startsWith("tool-"))).toBe(false);
  });

  it("leaves an answered approval alone, so a decided turn does not ask twice", () => {
    const seed = createStudioAgentHistorySeed(
      snapshot({
        messages: [
          message({ messageId: "message-1", ordinal: 1, role: "assistant", text: "Done." }),
        ],
        actions: [action({ actionId: "action-1", status: "succeeded", completed: true })],
        approvals: [
          { ...approval({ approvalId: "approval-1", actionId: "action-1" }), status: "approved" },
        ],
      })
    );

    expect(
      seed.messages.flatMap((entry) => entry.parts).filter((p) => p.type.startsWith("tool-"))
    ).toHaveLength(0);
  });

  it("skips an approval whose action is outside the window rather than inventing a tool call", () => {
    const seed = createStudioAgentHistorySeed(
      snapshot({
        messages: [
          message({ messageId: "message-1", ordinal: 1, role: "assistant", text: "Thinking." }),
        ],
        actions: [],
        approvals: [approval({ approvalId: "approval-1", actionId: "action-missing" })],
      })
    );

    expect(
      seed.messages.flatMap((entry) => entry.parts).filter((p) => p.type.startsWith("tool-"))
    ).toHaveLength(0);
  });
});

function approval(input: {
  approvalId: string;
  actionId: string;
}): StudioAgentThreadSnapshot["approvals"][number] {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    approvalId: input.approvalId,
    threadId: THREAD_ID,
    runId: RUN_ID,
    actionId: input.actionId,
    status: "pending",
    reason: "This edit rewrites a published scene.",
    actionInputHash: "sha256:abc",
    requestedAt: "2026-07-28T10:00:01.000Z",
    expiresAt: null,
    decision: null,
  };
}

function snapshot(overrides: Partial<StudioAgentThreadSnapshot> = {}): StudioAgentThreadSnapshot {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    thread: {} as StudioAgentThreadSnapshot["thread"],
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

function message(input: {
  messageId: string;
  ordinal: number;
  role: "user" | "assistant";
  text: string;
}): StudioAgentMessage {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    messageId: input.messageId,
    clientMessageId: input.role === "user" ? input.messageId : null,
    threadId: THREAD_ID,
    runId: RUN_ID,
    ordinal: input.ordinal,
    role: input.role,
    status: "completed",
    parts: [{ type: "text", format: "plain_text", text: input.text }],
    createdAt: "2026-07-28T10:00:00.000Z",
    completedAt: "2026-07-28T10:00:01.000Z",
  };
}

function action(input: {
  actionId: string;
  status: StudioAgentAction["status"];
  completed: boolean;
  toolCallId?: string;
  runId?: string;
  actionInput?: StudioAgentAction["input"];
}): StudioAgentAction {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    actionId: input.actionId,
    threadId: THREAD_ID,
    runId: input.runId ?? RUN_ID,
    toolCallId: input.toolCallId ?? `call_${input.actionId}`,
    toolName: "cap_story_scene_write_9f2c1a4b7e60",
    capability: { id: "story.scene.write", version: "1.0.0" },
    effect: "write",
    risk: "medium",
    status: input.status,
    title: "Rewrite scene one",
    summary: "Applies the requested edit.",
    target: null,
    input: input.actionInput ?? {},
    inputHash: "sha256:abc",
    approvalId: null,
    idempotencyKey: null,
    output: null,
    error: null,
    createdAt: "2026-07-28T10:00:00.000Z",
    startedAt: "2026-07-28T10:00:01.000Z",
    completedAt: input.completed ? "2026-07-28T10:00:02.000Z" : null,
  };
}
