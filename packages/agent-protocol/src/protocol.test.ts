import { describe, expect, it } from "vitest";

import {
  AgentEventEnvelopeSchema,
  AgentRunRequestSchema,
  FIZZ_AGENT_PROTOCOL_VERSION,
  assertMonotonicSequence,
} from "./index.js";

const uuid = "11111111-1111-4111-8111-111111111111";
const ts = "2026-08-07T00:00:00.000Z";

describe("fizz.agent.v1", () => {
  it("pins the protocol version", () => {
    expect(FIZZ_AGENT_PROTOCOL_VERSION).toBe("fizz.agent.v1");
  });

  it("accepts a Phase 1 canvas run request", () => {
    const parsed = AgentRunRequestSchema.parse({
      schemaVersion: "agent-os-run-request/v1",
      projectId: uuid,
      conversationId: uuid,
      workspace: {
        type: "project_canvas",
        selectedEntityIds: ["node-opening"],
      },
      message: {
        id: "msg-1",
        text: "Analyze the selected node and propose a clearer logline.",
      },
      model: { profileId: "creative-balanced" },
    });
    expect(parsed.workspace.type).toBe("project_canvas");
  });

  it("accepts an event envelope with monotonic sequence helper", () => {
    const event = AgentEventEnvelopeSchema.parse({
      id: uuid,
      protocolVersion: "fizz.agent.v1",
      sessionId: "agent-os:v1:conversation:" + uuid,
      runId: uuid,
      conversationId: uuid,
      sequence: 1,
      timestamp: ts,
      type: "RunStarted",
      data: {
        status: "running",
        workspaceType: "project_canvas",
        modelProfileId: "creative-balanced",
      },
    });
    expect(event.sequence).toBe(1);
    expect(() => assertMonotonicSequence(1, 1)).toThrow(/monotonic/);
    expect(() => assertMonotonicSequence(1, 2)).not.toThrow();
  });

  it("rejects unknown workspace types", () => {
    expect(() =>
      AgentRunRequestSchema.parse({
        schemaVersion: "agent-os-run-request/v1",
        projectId: uuid,
        conversationId: uuid,
        workspace: { type: "legacy_mastra_surface" },
        message: { id: "m", text: "x" },
        model: { profileId: "creative-balanced" },
      })
    ).toThrow();
  });
});
