import { describe, expect, it } from "vitest";
import {
  STUDIO_AGENT_SCHEMA_VERSION,
  StudioAgentEventDraftSchema,
  type StudioAgentCapabilityManifest,
  type StudioAgentModelMessageJson,
} from "@repo/shared/studio-agent";
import {
  createCapabilityTools,
  createToolBindings,
  toModelMessages,
  toStudioAgentError,
} from "./model-runner.js";

describe("model runner boundaries", () => {
  it("creates deterministic provider-safe aliases without losing capability identity", () => {
    const capability = manifest("story.canvas.apply_change_set");
    const [binding] = createToolBindings([
      { manifest: capability, permission: { decision: "allow", reason: "Test." } },
    ]);

    expect(binding?.providerName).toMatch(/^cap_story_canvas_apply_change_set_[a-f0-9]{12}$/);
    expect(binding?.capability).toBe(capability);
    expect(binding?.providerName.length).toBeLessThanOrEqual(64);
  });

  /**
   * THE PREREQUISITE FOR LIBRARY-NATIVE APPROVAL, AS A TEST.
   *
   * `needsApproval` is what makes `streamText` emit `tool-approval-request` and
   * NOT run the tool. It has to be set when the tool is OFFERED, so the verdict
   * has to travel on the plan — deciding it in `prepareAction`, after the model
   * has already emitted the call, is too late by construction. Drop the flag and
   * the model executes an action nobody approved; there is no second gate behind
   * it, because the whole approval mechanism is this one property.
   */
  it("gates an ask-verdict capability with needsApproval and leaves an allow-verdict one open", () => {
    const gated = manifest("story.canvas.delete_scene");
    const open = manifest("story.canvas.read");
    const tools = createCapabilityTools(
      createToolBindings([
        { manifest: gated, permission: { decision: "ask", reason: "Deletions confirm." } },
        { manifest: open, permission: { decision: "allow", reason: "Low-risk read." } },
      ])
    );
    const [gatedName, openName] = Object.keys(tools);

    expect(tools[gatedName!]?.needsApproval).toBe(true);
    expect(tools[openName!]?.needsApproval).toBe(false);
    // No `execute` on either: this runtime owns its own tool loop, so the SDK
    // must stop after emitting the call whatever the verdict was.
    expect(tools[gatedName!]?.execute).toBeUndefined();
  });

  it("projects JSON-safe multimodal messages into AI SDK messages", () => {
    const messages: StudioAgentModelMessageJson[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Inspect this." },
          {
            type: "image",
            source: {
              kind: "url",
              url: "https://assets.example.test/frame.png",
              mediaType: "image/png",
            },
          },
          {
            type: "file",
            source: {
              kind: "base64",
              data: "aGVsbG8=",
              mediaType: "text/plain",
            },
            fileName: "notes.txt",
          },
        ],
      },
      {
        role: "tool",
        content: [
          {
            type: "tool-result",
            toolCallId: "call-1",
            toolName: "story.canvas.read",
            output: { type: "execution-denied", reason: null },
          },
        ],
      },
    ];

    const projected = toModelMessages(messages);
    const user = projected[0];
    const tool = projected[1];
    expect(user?.role).toBe("user");
    expect(typeof user?.content === "string" ? null : user?.content[1]).toMatchObject({
      type: "image",
      image: new URL("https://assets.example.test/frame.png"),
      mediaType: "image/png",
    });
    expect(tool).toEqual({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: expect.stringMatching(/^cap_story_canvas_read_[a-f0-9]{12}$/),
          output: { type: "execution-denied" },
        },
      ],
    });
  });

  it("does not leak unknown failures or mark cancellation retryable", () => {
    expect(toStudioAgentError("provider unavailable")).toMatchObject({
      code: "runtime.model_failed",
      message: "provider unavailable",
      retryable: true,
    });
    expect(toStudioAgentError(new Error("cancelled"), true)).toMatchObject({
      code: "runtime.cancelled",
      retryable: false,
    });
  });

  it("requires usage and provider identity on every terminal assistant segment", () => {
    const draft = {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      threadId: "00000000-0000-4000-8000-000000000001",
      runId: "00000000-0000-4000-8000-000000000002",
      rootRunId: "00000000-0000-4000-8000-000000000002",
      parentRunId: null,
      type: "assistant.segment.completed",
      payload: {
        messageId: "00000000-0000-4000-8000-000000000003",
        segmentId: "00000000-0000-4000-8000-000000000004",
        content: "Done.",
        finishReason: "stop",
        providerResponseId: "provider-response-1",
        usage: {
          inputTokens: 128,
          outputTokens: 16,
          cachedInputTokens: 64,
          reasoningTokens: null,
        },
        completedAt: "2026-07-24T12:00:00.000Z",
      },
      occurredAt: "2026-07-24T12:00:00.000Z",
      idempotencyKey: "model:step-1:segment:segment-1:terminal",
    } as const;

    expect(StudioAgentEventDraftSchema.safeParse(draft).success).toBe(true);
    expect(
      StudioAgentEventDraftSchema.safeParse({
        ...draft,
        payload: {
          ...draft.payload,
          usage: undefined,
        },
      }).success
    ).toBe(false);
  });
});

function manifest(capabilityId: string): StudioAgentCapabilityManifest {
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    capabilityId,
    version: "1.0.0",
    name: "Apply canvas changes",
    description: "Applies an authorized change set to the focused canvas.",
    effect: "write",
    risk: "medium",
    executionMode: "action",
    reversible: true,
    streaming: false,
    idempotency: "required",
    requiredScopes: ["story.canvas.write"],
    inputSchema: {
      type: "object",
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      additionalProperties: false,
    },
  };
}
