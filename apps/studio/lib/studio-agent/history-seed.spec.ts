import type { AgentHistoryPage } from "@repo/shared/agent-platform";
import { describe, expect, it } from "vitest";

import {
  createStudioAgentHistorySeed,
  prependStudioAgentHistorySeed,
  refreshStudioAgentHistorySeed,
} from "./history-seed";

describe("durable Agent Platform history", () => {
  it("accepts the canonical empty transcript for a new conversation", async () => {
    const seed = await createStudioAgentHistorySeed(page());

    expect(seed.messages).toEqual([]);
    expect(seed.messageIds.size).toBe(0);
    expect(seed.nextCursor).toBeNull();
    expect(seed.writeToken).toBe("");
    expect(seed.writtenNodeIds).toEqual([]);
  });

  it("validates canonical UI messages and retains the opaque pagination cursor", async () => {
    const seed = await createStudioAgentHistorySeed(
      page({
        messages: [
          {
            id: "message-1",
            role: "user",
            parts: [{ type: "text", text: "Make the arrival more dramatic." }],
            metadata: { conversationId: CONVERSATION_ID },
          },
        ],
        nextCursor: "opaque:older-page",
      })
    );

    expect(seed.messages).toHaveLength(1);
    expect(seed.messageIds.has("message-1")).toBe(true);
    expect(seed.nextCursor).toBe("opaque:older-page");
    expect(seed.runs).toEqual([]);
    expect(seed.activities).toEqual([]);
  });

  it("derives canvas invalidation only from a canonical successful Story write", async () => {
    const seed = await createStudioAgentHistorySeed(
      page({
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            parts: [
              {
                type: "tool-story_apply_change_set",
                toolCallId: "tool-call-1",
                state: "output-available",
                input: {
                  schemaVersion: "story-change-set/v2",
                  operations: [],
                },
                output: {
                  status: "succeeded",
                  data: {
                    schemaVersion: "story-change-result/v2",
                    draftRevision: 17,
                    affectedNodeIds: ["intro-night", "xinyi-arrival"],
                  },
                },
              },
            ],
          },
        ],
      })
    );

    expect(seed.writeToken).toBe("assistant-1:tool-call-1:17");
    expect(seed.writtenNodeIds).toEqual(["intro-night", "xinyi-arrival"]);
  });

  it("does not invalidate the canvas for a failed or malformed tool result", async () => {
    const seed = await createStudioAgentHistorySeed(
      page({
        messages: [
          {
            id: "assistant-1",
            role: "assistant",
            parts: [
              {
                type: "tool-story_apply_change_set",
                toolCallId: "tool-call-1",
                state: "output-available",
                input: {},
                output: {
                  status: "failed",
                  data: {
                    schemaVersion: "story-change-result/v2",
                    draftRevision: 18,
                    affectedNodeIds: ["must-not-refresh"],
                  },
                },
              },
            ],
          },
        ],
      })
    );

    expect(seed.writeToken).toBe("");
    expect(seed.writtenNodeIds).toEqual([]);
  });

  it("prepends older pages in chronological order and removes overlap", async () => {
    const current = await createStudioAgentHistorySeed(
      page({
        messages: [
          textMessage("message-2", "assistant", "Second"),
          textMessage("message-3", "user", "Third"),
        ],
        nextCursor: "cursor-2",
      })
    );
    const older = await createStudioAgentHistorySeed(
      page({
        messages: [
          textMessage("message-1", "user", "First"),
          textMessage("message-2", "assistant", "Second"),
        ],
        nextCursor: null,
      })
    );

    const merged = prependStudioAgentHistorySeed(current, older);

    expect(merged.messages.map((message) => message.id)).toEqual([
      "message-1",
      "message-2",
      "message-3",
    ]);
    expect(merged.nextCursor).toBeNull();
  });

  it("refreshes the live window without discarding pages already loaded by the creator", async () => {
    const previous = await createStudioAgentHistorySeed(
      page({
        messages: [
          textMessage("message-1", "user", "Old"),
          textMessage("message-2", "assistant", "Current"),
        ],
        nextCursor: "cursor-before-message-1",
      })
    );
    const window = await createStudioAgentHistorySeed(
      page({
        messages: [
          textMessage("message-2", "assistant", "Current"),
          textMessage("message-3", "user", "New"),
        ],
        nextCursor: "cursor-before-message-2",
      })
    );

    const refreshed = refreshStudioAgentHistorySeed(previous, window);

    expect(refreshed.messages.map((message) => message.id)).toEqual([
      "message-1",
      "message-2",
      "message-3",
    ]);
    expect(refreshed.nextCursor).toBe("cursor-before-message-1");
  });

  it("does not resurrect earlier pagination after the creator exhausted it", async () => {
    const previous = await createStudioAgentHistorySeed(
      page({
        messages: [textMessage("message-1", "user", "Old")],
        nextCursor: null,
      })
    );
    const window = await createStudioAgentHistorySeed(
      page({
        messages: [
          textMessage("message-1", "user", "Old"),
          textMessage("message-2", "assistant", "New"),
        ],
        nextCursor: "cursor-from-refreshed-window",
      })
    );

    const refreshed = refreshStudioAgentHistorySeed(previous, window);

    expect(refreshed.nextCursor).toBeNull();
  });

  it("rejects corrupt durable messages instead of rendering invented history", async () => {
    await expect(
      createStudioAgentHistorySeed(
        page({
          messages: [
            {
              id: "message-1",
              role: "user",
              parts: [{ type: "text" }],
            },
          ],
        })
      )
    ).rejects.toThrow();
  });
});

const CONVERSATION_ID = "00000000-0000-4000-8000-000000000003";

function page(overrides: Partial<AgentHistoryPage> = {}): AgentHistoryPage {
  return {
    schemaVersion: "agent-history-page/v1",
    messages: [],
    nextCursor: null,
    ...overrides,
  };
}

function textMessage(id: string, role: "user" | "assistant", text: string) {
  return {
    id,
    role,
    parts: [{ type: "text", text }],
  };
}
