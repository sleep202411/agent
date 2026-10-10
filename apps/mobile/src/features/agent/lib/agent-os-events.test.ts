import { expect, it } from "vitest";

import type { AgentOsEvent } from "../api/agent-os-api";
import { currentTurnIsStreaming, deriveAgentActivity, eventsToMessages } from "./agent-os-events";

function event(sequence: number, type: string, data: Record<string, unknown>): AgentOsEvent {
  return {
    id: `event-${sequence}`,
    protocolVersion: "fizz.agent.v1",
    sessionId: "session-1",
    runId: "run-1",
    conversationId: "conversation-1",
    sequence,
    timestamp: `2026-10-10T07:0${sequence}:00.000Z`,
    type,
    data,
  };
}

it("hides a superseded recovery fragment and keeps the replacement", () => {
  const messages = eventsToMessages(
    [
      event(1, "UserMessage", { messageId: "user-1", text: "生成一个金鸡湖的视频" }),
      event(2, "MessageStarted", { messageId: "msg-stale", segmentKind: "response" }),
      event(3, "MessageDelta", {
        messageId: "msg-stale",
        delta: "之前的创建请求已启动，但状态显示为 stale。",
      }),
      event(4, "MessageCompleted", {
        messageId: "msg-stale",
        text: "之前的创建请求已启动，但状态显示为 stale。",
        finishReason: "superseded",
      }),
      event(5, "MessageStarted", { messageId: "msg-handoff", segmentKind: "acknowledgement" }),
      event(6, "MessageCompleted", {
        messageId: "msg-handoff",
        text: "正在为您创建金鸡湖视频项目，将依次生成剧本、情节树、资产规范和分镜脚本。",
        finishReason: "tool_call",
      }),
    ],
    { runId: "run-1" }
  );

  expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  expect(messages[1]?.text).toBe(
    "正在为您创建金鸡湖视频项目，将依次生成剧本、情节树、资产规范和分镜脚本。"
  );
});

it("joins later segments in the same turn and lets the completed text replace deltas", () => {
  const messages = eventsToMessages(
    [
      event(1, "UserMessage", { messageId: "user-1", text: "Continue." }),
      event(2, "MessageDelta", { messageId: "msg-lead", delta: "partial" }),
      event(3, "MessageCompleted", {
        messageId: "msg-lead",
        text: "I’ll check the current storyboard.",
        finishReason: "tool_call",
      }),
      event(4, "MessageCompleted", {
        messageId: "msg-result",
        text: "There are three shots.",
        finishReason: "stop",
      }),
    ],
    { runId: "run-1" }
  );

  expect(messages[1]?.text).toBe("I’ll check the current storyboard.\n\nThere are three shots.");
});

it("keeps each turnId in its own assistant bubble", () => {
  const messages = eventsToMessages(
    [
      event(1, "UserMessage", { turnId: "turn-1", messageId: "user-1", text: "Draft it." }),
      event(2, "MessageCompleted", {
        turnId: "turn-1",
        messageId: "receipt",
        text: "I’m preparing the draft.",
        finishReason: "stop",
      }),
      event(3, "MessageCompleted", {
        turnId: "turn-2",
        messageId: "result",
        text: "The draft is ready for review.",
        finishReason: "external_result",
      }),
    ],
    { runId: "run-1" }
  );

  expect(messages.map((message) => message.role)).toEqual(["user", "assistant", "assistant"]);
  expect(messages[1]?.text).toBe("I’m preparing the draft.");
  expect(messages[2]?.text).toBe("The draft is ready for review.");
});

it("ignores an earlier turn when choosing the live activity", () => {
  const events = [
    event(1, "UserMessage", { turnId: "turn-1", messageId: "user-1", text: "Continue." }),
    event(2, "ToolStarted", { turnId: "turn-1", toolId: "story.read", toolCallId: "call-1" }),
    event(3, "UserMessage", { turnId: "turn-2", messageId: "user-2", text: "Go on." }),
  ];

  expect(deriveAgentActivity(events, "running")).toEqual({ kind: "thinking" });
  expect(currentTurnIsStreaming(events, "running")).toBe(false);
});

it("shows the permission step as thinking and settles a paused fragment", () => {
  const events = [
    event(1, "UserMessage", { turnId: "turn-1", messageId: "user-1", text: "Hello" }),
    event(2, "PlanCreated", { turnId: "turn-1", steps: ["Legacy runtime scaffold"] }),
    event(3, "StepStarted", { turnId: "turn-1", step: "permission", permissionMode: "smart" }),
  ];
  expect(deriveAgentActivity(events, "running")).toEqual({ kind: "thinking" });

  const paused = [
    event(1, "UserMessage", { turnId: "turn-1", messageId: "user-1", text: "Draft it." }),
    event(2, "MessageDelta", { turnId: "turn-1", messageId: "msg-1", delta: "One moment." }),
  ];
  expect(currentTurnIsStreaming(paused, "running")).toBe(true);
  expect(currentTurnIsStreaming(paused, "waiting_for_input")).toBe(false);
  expect(
    currentTurnIsStreaming(
      [...paused, event(3, "UserInputRequired", { turnId: "turn-1", requestId: "request-1" })],
      "running"
    )
  ).toBe(false);
});
