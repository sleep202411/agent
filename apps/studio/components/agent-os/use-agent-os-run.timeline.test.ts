import { describe, expect, it } from "vitest";
import type { AgentOsEvent } from "@/lib/agent-os/api-client";
import {
  derivePendingApprovalFromEvents,
  messagesFromConversationHistory,
  rebuildRunTimelineFromEvents,
} from "./use-agent-os-run";

function ev(sequence: number, type: string, data: Record<string, unknown> = {}): AgentOsEvent {
  return {
    id: `e${sequence}`,
    protocolVersion: "fizz.agent.v1",
    sessionId: "s1",
    runId: "run-1",
    conversationId: "c1",
    sequence,
    timestamp: new Date(1_700_000_000_000 + sequence * 1000).toISOString(),
    type,
    data,
  };
}

describe("rebuildRunTimelineFromEvents", () => {
  it("places tools between pre-tool and post-tool assistant segments", () => {
    const events = [
      ev(1, "MessageDelta", { delta: "I will list shots. " }),
      ev(2, "ToolStarted", {
        toolId: "storyboard.listShots",
        toolCallId: "call-1",
      }),
      ev(3, "ToolCompleted", {
        toolId: "storyboard.listShots",
        toolCallId: "call-1",
      }),
      ev(4, "MessageDelta", { delta: "Found 3 shots." }),
      ev(5, "MessageCompleted", { text: "I will list shots. Found 3 shots." }),
    ];
    const rows = rebuildRunTimelineFromEvents(events, "run-1", "completed");
    const kinds = rows.map(
      (r) => `${r.role}:${r.meta?.kind ?? ""}:${r.meta?.phase ?? r.content.slice(0, 20)}`
    );
    expect(rows[0]?.role).toBe("assistant");
    expect(rows[0]?.content).toContain("I will list shots");
    expect(rows[1]?.role).toBe("tool");
    expect(rows[1]?.meta?.phase).toBe("completed");
    expect(rows[2]?.role).toBe("assistant");
    expect(rows[2]?.content).toContain("Found 3 shots");
    // Must not leave a stuck "started" row after completed.
    expect(rows.filter((r) => r.role === "tool")).toHaveLength(1);
    expect(kinds.length).toBeGreaterThanOrEqual(3);
  });

  it("collapses tool lifecycle onto one row", () => {
    const events = [
      ev(1, "ToolProposed", {
        toolId: "storyboard.upsertShots",
        toolCallId: "call-2",
      }),
      ev(2, "ToolStarted", {
        toolId: "storyboard.upsertShots",
        toolCallId: "call-2",
      }),
      ev(3, "ToolCompleted", {
        toolId: "storyboard.upsertShots",
        toolCallId: "call-2",
      }),
    ];
    const rows = rebuildRunTimelineFromEvents(events, "run-1", "completed");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.meta?.phase).toBe("completed");
  });

  it("keeps streaming assistant last while run is open", () => {
    const events = [
      ev(1, "ToolCompleted", {
        toolId: "storyboard.listShots",
        toolCallId: "call-1",
      }),
      ev(2, "MessageDelta", { delta: "Done." }),
    ];
    const rows = rebuildRunTimelineFromEvents(events, "run-1", "running");
    expect(rows.at(-1)?.role).toBe("assistant");
    expect(rows.at(-1)?.meta?.kind).toBe("streaming");
  });

  it("includes durable UserMessage and ApprovalResolved for history restore", () => {
    const events = [
      ev(1, "UserMessage", { text: "删除最后一个分镜" }),
      ev(2, "ToolCompleted", {
        toolId: "storyboard.listShots",
        toolCallId: "call-1",
      }),
      ev(3, "ApprovalResolved", { decision: "approve", approvalId: "a1" }),
      ev(4, "MessageDelta", { delta: "已删除。" }),
    ];
    const rows = rebuildRunTimelineFromEvents(events, "run-1", "completed");
    expect(rows[0]?.role).toBe("user");
    expect(rows[0]?.content).toBe("删除最后一个分镜");
    expect(rows.some((r) => r.meta?.kind === "approval_decision")).toBe(true);
    expect(rows.at(-1)?.role).toBe("assistant");
  });

  it("reject closes proposed tool so UI does not keep spinning", () => {
    const events = [
      ev(1, "ToolProposed", {
        toolId: "storyboard.upsertShots",
        toolCallId: "call-up",
      }),
      ev(2, "ApprovalRequired", {
        approvalId: "apr-1",
        toolCallId: "call-up",
        title: "Approve",
        description: "x",
      }),
      ev(3, "ApprovalResolved", {
        approvalId: "apr-1",
        decision: "reject",
      }),
      ev(4, "ToolFailed", {
        toolId: "storyboard.upsertShots",
        toolCallId: "call-up",
        code: "APPROVAL_REJECTED",
        message: "User rejected the proposed write.",
        retryable: false,
      }),
      ev(5, "RunCancelled", {
        status: "cancelled",
        error: {
          code: "APPROVAL_REJECTED",
          message: "User rejected the proposed write.",
          retryable: false,
        },
      }),
    ];
    const rows = rebuildRunTimelineFromEvents(events, "run-1", "cancelled");
    const tool = rows.find((r) => r.role === "tool");
    expect(tool?.meta?.phase).toBe("failed");
    expect(rows.some((r) => r.meta?.kind === "approval_decision")).toBe(true);
    expect(rows.some((r) => r.content === "Rejected write")).toBe(true);
  });

  it("reject without ToolFailed still fails open proposed tool (legacy journal)", () => {
    const events = [
      ev(1, "ToolProposed", {
        toolId: "storyboard.upsertShots",
        toolCallId: "call-up",
      }),
      ev(2, "ApprovalResolved", {
        approvalId: "apr-1",
        decision: "reject",
      }),
      ev(3, "RunCancelled", { status: "cancelled" }),
    ];
    const rows = rebuildRunTimelineFromEvents(events, "run-1", "cancelled");
    expect(rows.find((r) => r.role === "tool")?.meta?.phase).toBe("failed");
  });
});

describe("derivePendingApprovalFromEvents", () => {
  it("rebuilds HITL card after ToolProposed + ApprovalRequired", () => {
    const pending = derivePendingApprovalFromEvents([
      ev(1, "ToolProposed", {
        toolId: "storyboard.deleteShots",
        toolCallId: "call-del",
        arguments: { baseRevision: 5, shotIds: ["shot-03"] },
      }),
      ev(2, "ApprovalRequired", {
        approvalId: "apr-1",
        toolCallId: "call-del",
        title: "Approve storyboard.deleteShots",
        description: "Sensitive operations require approval.",
      }),
    ]);
    expect(pending?.approvalId).toBe("apr-1");
    expect(pending?.toolId).toBe("storyboard.deleteShots");
    expect(pending?.toolCallId).toBe("call-del");
  });

  it("clears pending after ApprovalResolved", () => {
    const pending = derivePendingApprovalFromEvents([
      ev(1, "ToolProposed", {
        toolId: "storyboard.deleteShots",
        toolCallId: "call-del",
        arguments: {},
      }),
      ev(2, "ApprovalRequired", {
        approvalId: "apr-1",
        toolCallId: "call-del",
        title: "Approve",
        description: "x",
      }),
      ev(3, "ApprovalResolved", { approvalId: "apr-1", decision: "approve" }),
    ]);
    expect(pending).toBeNull();
  });
});

describe("messagesFromConversationHistory (multi-run)", () => {
  it("interleaves turns: U1 → A1 → U2 → A2 (never clumps users at top)", () => {
    const run1Events: AgentOsEvent[] = [
      {
        ...ev(1, "UserMessage", { text: "你能干什么" }),
        runId: "run-1",
      },
      {
        ...ev(2, "MessageDelta", { delta: "我是 Agent OS。" }),
        runId: "run-1",
      },
      {
        ...ev(3, "MessageCompleted", { text: "我是 Agent OS。" }),
        runId: "run-1",
      },
    ];
    const run2Events: AgentOsEvent[] = [
      {
        ...ev(1, "UserMessage", { text: "你可以做什么" }),
        runId: "run-2",
      },
      {
        ...ev(2, "MessageDelta", { delta: "我可以写分镜。" }),
        runId: "run-2",
      },
      {
        ...ev(3, "MessageCompleted", { text: "我可以写分镜。" }),
        runId: "run-2",
      },
    ];
    const { messages } = messagesFromConversationHistory([
      {
        runId: "run-1",
        status: "completed",
        events: run1Events,
      },
      {
        runId: "run-2",
        status: "completed",
        events: run2Events,
      },
    ]);
    const roles = messages.map((m) => `${m.role}:${m.content.slice(0, 12)}`);
    expect(roles[0]).toMatch(/^user:你能干什么/);
    expect(roles[1]).toMatch(/^assistant:/);
    expect(roles[2]).toMatch(/^user:你可以做什么/);
    expect(roles[3]).toMatch(/^assistant:/);
    // No clumped users at the front
    expect(messages[0]?.role).toBe("user");
    expect(messages[1]?.role).not.toBe("user");
  });

  it("keeps tools between assistant segments within a run", () => {
    const { messages } = messagesFromConversationHistory([
      {
        runId: "run-1",
        status: "completed",
        events: [
          ev(1, "UserMessage", { text: "删镜头" }),
          ev(2, "MessageDelta", { delta: "先 list。" }),
          ev(3, "ToolStarted", {
            toolId: "storyboard.listShots",
            toolCallId: "c1",
          }),
          ev(4, "ToolCompleted", {
            toolId: "storyboard.listShots",
            toolCallId: "c1",
          }),
          ev(5, "MessageDelta", { delta: "已删除。" }),
          ev(6, "MessageCompleted", { text: "先 list。已删除。" }),
        ],
      },
    ]);
    const roles = messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "tool", "assistant"]);
  });
});
