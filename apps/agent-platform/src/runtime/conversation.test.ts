import { describe, expect, it } from "vitest";

import { classifyCanonicalRun, hasAssistantOutput } from "./conversation.js";

describe("classifyCanonicalRun", () => {
  it("requires inference for a new user input", () => {
    expect(
      classifyCanonicalRun([
        { id: "user-1", role: "user", parts: [{ type: "text", text: "Continue" }] },
      ])
    ).toEqual({ kind: "needs-inference" });
  });

  it("recognizes a completed response replay", () => {
    expect(
      classifyCanonicalRun([
        { id: "assistant-1", role: "assistant", parts: [{ type: "text", text: "Done" }] },
      ])
    ).toEqual({ kind: "assistant-response-complete" });
  });

  it("refuses to call a content-free trailing assistant turn a completed response", () => {
    // The transport opens the assistant message when the model step starts, so
    // a step that dies mid-stream replays as an assistant turn with no parts.
    // Every caller of this classifier must be able to see that difference.
    expect(
      classifyCanonicalRun([
        { id: "user-1", role: "user", parts: [{ type: "text", text: "Break this down." }] },
        { id: "assistant-shell", role: "assistant", parts: [] },
      ])
    ).toEqual({ kind: "assistant-response-empty" });
  });

  it("treats a stream-boundary-only assistant turn as empty", () => {
    expect(
      classifyCanonicalRun([
        { id: "user-1", role: "user", parts: [{ type: "text", text: "Break this down." }] },
        { id: "assistant-shell", role: "assistant", parts: [{ type: "step-start" }] },
      ])
    ).toEqual({ kind: "assistant-response-empty" });
  });

  it("requires inference after a durable tool result", () => {
    expect(
      classifyCanonicalRun([
        {
          id: "assistant-tool",
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolName: "story.apply_patch",
              toolCallId: "call-1",
              state: "output-available",
              input: {},
              output: { status: "applied" },
            },
          ],
        },
      ])
    ).toEqual({ kind: "needs-inference" });
  });

  it("recognizes a run waiting for tool approval", () => {
    expect(
      classifyCanonicalRun([
        {
          id: "assistant-approval",
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolName: "crew.invite",
              toolCallId: "call-2",
              state: "approval-requested",
              input: {},
              approval: { id: "approval-1" },
            },
          ],
        },
      ])
    ).toEqual({ kind: "awaiting-approval" });
  });

  it("recognizes Mastra's persisted approval control part", () => {
    expect(
      classifyCanonicalRun([
        {
          id: "assistant-approval-control",
          role: "assistant",
          parts: [
            {
              type: "data-tool-call-approval",
              data: {
                toolCallId: "call-2",
                resumed: false,
              },
            },
          ],
        },
      ])
    ).toEqual({ kind: "awaiting-approval" });
  });

  it("distinguishes runtime input suspension from pre-execution approval", () => {
    expect(
      classifyCanonicalRun([
        {
          id: "assistant-runtime-suspension",
          role: "assistant",
          parts: [
            {
              type: "data-tool-call-suspended",
              data: {
                toolCallId: "call-3",
                resumed: false,
                suspendPayload: { question: "Which chapter?" },
              },
            },
          ],
        },
      ])
    ).toEqual({ kind: "awaiting-runtime-input" });
  });

  it("ignores a Mastra control part that has already resumed", () => {
    expect(
      classifyCanonicalRun([
        {
          id: "assistant-resumed-control",
          role: "assistant",
          parts: [
            {
              type: "data-tool-call-suspended",
              data: {
                toolCallId: "call-3",
                resumed: true,
              },
            },
            { type: "text", text: "Done." },
          ],
        },
      ])
    ).toEqual({ kind: "assistant-response-complete" });
  });

  it("does not let a trailing steering message bypass an open approval request", () => {
    expect(
      classifyCanonicalRun([
        {
          id: "assistant-approval",
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolName: "story_canvas_apply_patch",
              toolCallId: "call-approval",
              state: "approval-requested",
              input: { operations: [] },
              approval: { id: "approval-steered" },
            },
          ],
        },
        {
          id: "user-steer",
          role: "user",
          parts: [{ type: "text", text: "Make the title shorter too." }],
        },
      ])
    ).toEqual({ kind: "awaiting-approval" });
  });

  it("does not let a trailing steering message bypass runtime suspension", () => {
    expect(
      classifyCanonicalRun([
        {
          id: "assistant-suspended",
          role: "assistant",
          parts: [
            {
              type: "data-tool-call-suspended",
              data: {
                toolCallId: "call-suspended",
                toolName: "story_canvas_apply_patch",
                resumed: false,
                suspendPayload: { reason: "missing-input" },
              },
            },
          ],
        },
        {
          id: "user-steer",
          role: "user",
          parts: [{ type: "text", text: "Use the first chapter." }],
        },
      ])
    ).toEqual({ kind: "awaiting-runtime-input" });
  });
});

describe("hasAssistantOutput", () => {
  it("counts only substantive assistant parts as output", () => {
    expect(
      hasAssistantOutput([
        { id: "current-user", role: "user", parts: [{ type: "text", text: "Break this down." }] },
      ])
    ).toBe(false);
    expect(
      hasAssistantOutput([
        { id: "boundary-only", role: "assistant", parts: [{ type: "step-start" }] },
      ])
    ).toBe(false);
    expect(
      hasAssistantOutput([
        { id: "blank-text", role: "assistant", parts: [{ type: "text", text: "   \n" }] },
      ])
    ).toBe(false);
    expect(
      hasAssistantOutput([
        {
          id: "tool-call",
          role: "assistant",
          parts: [
            {
              type: "dynamic-tool",
              toolName: "story_get_snapshot",
              toolCallId: "call-read",
              state: "input-available",
              input: {},
            },
          ],
        },
      ])
    ).toBe(true);
    expect(
      hasAssistantOutput([
        { id: "answer", role: "assistant", parts: [{ type: "text", text: "Done." }] },
      ])
    ).toBe(true);
  });
});
