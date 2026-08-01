import { describe, expect, it } from "vitest";

import { reconcileStudioAgentMessages } from "./message-reconciliation";
import type { StudioAgentUIMessage } from "./transport-contract";

describe("reconcileStudioAgentMessages", () => {
  it("keeps one stable row when the history seed and live tail overlap", () => {
    const durable = message("message-1", "The rain stopped.", "done");
    const live = message("message-1", "The rain stopped.", "done", {
      runId: "run-1",
    });

    const [reconciled] = reconcileStudioAgentMessages([durable, live]);

    expect(reconciled?.id).toBe("message-1");
    expect(reconciled?.metadata?.runId).toBe("run-1");
    expect(reconcileStudioAgentMessages([durable, live])).toHaveLength(1);
  });

  it("keeps the longest streaming observation without moving its first position", () => {
    const before = message("assistant-1", "金陵", "streaming");
    const after = message("assistant-1", "金陵的雨落了下来", "streaming");
    const next = message("user-2", "继续", "done", {}, "user");

    const reconciled = reconcileStudioAgentMessages([before, next, after]);

    expect(reconciled.map((item) => item.id)).toEqual(["assistant-1", "user-2"]);
    expect(reconciled[0]?.parts).toEqual([
      { type: "text", text: "金陵的雨落了下来", state: "streaming" },
    ]);
  });

  it("does not regress a complete durable reply to a shorter reconnect snapshot", () => {
    const complete = message("assistant-1", "The complete answer.", "done");
    const stale = message("assistant-1", "The complete", "streaming");

    const [reconciled] = reconcileStudioAgentMessages([complete, stale]);

    expect(reconciled?.parts).toEqual([
      { type: "text", text: "The complete answer.", state: "done" },
    ]);
  });

  it("collapses optimistic and durable creator echoes by clientMessageId", () => {
    const optimistic = message(
      "optimistic-id",
      "Add a node.",
      "done",
      { clientMessageId: "client-message-1" },
      "user"
    );
    const durable = message(
      "durable-id",
      "Add a node.",
      "done",
      {
        clientMessageId: "client-message-1",
        runId: "run-1",
      },
      "user"
    );

    const [reconciled] = reconcileStudioAgentMessages([optimistic, durable]);

    expect(reconciled?.id).toBe("optimistic-id");
    expect(reconciled?.metadata?.runId).toBe("run-1");
    expect(reconcileStudioAgentMessages([optimistic, durable])).toHaveLength(1);
  });

  it("does not coalesce two different messages with identical text", () => {
    const first = message("message-1", "你好", "done");
    const second = message("message-2", "你好", "done");

    expect(reconcileStudioAgentMessages([first, second])).toHaveLength(2);
  });
});

function message(
  id: string,
  text: string,
  state: "streaming" | "done",
  metadata: StudioAgentUIMessage["metadata"] = {},
  role: StudioAgentUIMessage["role"] = "assistant"
): StudioAgentUIMessage {
  return {
    id,
    role,
    metadata,
    parts: [{ type: "text", text, state }],
  };
}
