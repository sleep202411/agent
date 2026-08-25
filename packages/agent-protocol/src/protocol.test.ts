import { describe, expect, it } from "vitest";

import {
  AgentApprovalResponseTextSchema,
  ApprovalRequiredDataSchema,
  ApprovalResolvedDataSchema,
  AgentDisplayLocaleSchema,
  approvalAcknowledgementText,
  AgentEventEnvelopeSchema,
  AgentRunRequestSchema,
  AgentRunStatusSchema,
  AgentUserInputResponseSchema,
  FIZZ_AGENT_PROTOCOL_VERSION,
  UserMessageDataSchema,
  assertMonotonicSequence,
  parseAgentEventDataForWrite,
} from "./index.js";

const uuid = "11111111-1111-4111-8111-111111111111";
const ts = "2026-08-07T00:00:00.000Z";

describe("fizz.agent.v1", () => {
  it("pins the protocol version", () => {
    expect(FIZZ_AGENT_PROTOCOL_VERSION).toBe("fizz.agent.v1");
  });

  it("bounds approval display copy and owns locale-safe Assistant acknowledgements", () => {
    expect(AgentApprovalResponseTextSchema.parse("  Approved  ")).toBe("Approved");
    expect(AgentApprovalResponseTextSchema.safeParse("x".repeat(301)).success).toBe(false);
    expect(AgentDisplayLocaleSchema.safeParse("fr-FR").success).toBe(false);
    expect(approvalAcknowledgementText("zh-CN", "approve")).toBe(
      "已收到你的批准，我会继续执行此操作。"
    );
    expect(approvalAcknowledgementText("zh-HK", "reject")).toBe(
      "已收到你的決定，我會繼續處理，但不會執行此操作。"
    );
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

  it("carries structured input pause events and status", () => {
    expect(AgentRunStatusSchema.parse("waiting_for_input")).toBe("waiting_for_input");
    const event = AgentEventEnvelopeSchema.parse({
      id: uuid,
      protocolVersion: "fizz.agent.v1",
      sessionId: "agent-os:v1:conversation:" + uuid,
      runId: uuid,
      conversationId: uuid,
      sequence: 2,
      timestamp: ts,
      type: "UserInputRequired",
      data: {
        requestId: uuid,
        toolCallId: "call-input",
        formId: "story_creative_profile",
        knownValues: { target_runtime: "short_5_15" },
        questions: [
          {
            id: "story_language",
            header: "Story language",
            question: "Choose the authored language",
            options: [
              { value: "zh-CN", label: "简体中文" },
              { value: "en-US", label: "English" },
            ],
          },
        ],
      },
    });
    expect(event.type).toBe("UserInputRequired");
    expect(event.data).toMatchObject({ knownValues: { target_runtime: "short_5_15" } });
  });

  it("models external waiting and idempotent input responses", () => {
    expect(AgentRunStatusSchema.parse("waiting_for_external")).toBe("waiting_for_external");
    expect(
      AgentUserInputResponseSchema.parse({
        schemaVersion: "agent-os-user-input-response/v1",
        responseId: uuid,
        requestId: uuid,
        answers: { aspect_ratio: "landscape_16_9" },
      })
    ).toMatchObject({ responseId: uuid });
    expect(
      parseAgentEventDataForWrite("RunPaused", {
        turnId: uuid,
        status: "waiting_for_external",
        externalJobId: uuid,
        toolCallId: "story-author-1",
        toolId: "story.author",
      })
    ).toMatchObject({ status: "waiting_for_external", externalJobId: uuid });
    expect(() =>
      parseAgentEventDataForWrite("RunPaused", {
        turnId: uuid,
        status: "waiting_for_external",
        externalJobId: uuid,
      })
    ).toThrow();
    expect(() =>
      parseAgentEventDataForWrite("RunPaused", {
        turnId: uuid,
        status: "waiting_for_input",
        externalJobId: uuid,
        toolCallId: "story-author-1",
        toolId: "story.author",
      })
    ).toThrow();
    expect(
      parseAgentEventDataForWrite("RunResumed", {
        turnId: uuid,
        reason: "external_job_completed",
        externalJobId: uuid,
      })
    ).toMatchObject({ reason: "external_job_completed", externalJobId: uuid });
  });

  it("keeps structured interaction answers on durable user messages", () => {
    const request = UserMessageDataSchema.parse({
      turnId: uuid,
      messageId: "user:run:input",
      text: "Aspect ratio: 16:9 landscape",
      interaction: {
        kind: "user_input",
        requestId: uuid,
        responseId: uuid,
        answers: { aspect_ratio: "landscape_16_9" },
      },
    });
    const approval = UserMessageDataSchema.parse({
      turnId: uuid,
      messageId: "user:run:approval",
      text: "Approved write",
      interaction: {
        kind: "approval",
        approvalId: uuid,
        responseId: uuid,
        decision: "approve",
        locale: "en-US",
      },
    });
    expect(request.interaction).toMatchObject({ kind: "user_input" });
    expect(approval.interaction).toMatchObject({ kind: "approval", decision: "approve" });
    expect(() =>
      UserMessageDataSchema.parse({
        turnId: uuid,
        messageId: "user:run:legacy-approval",
        text: "Approved write",
        interaction: {
          kind: "approval",
          approvalId: uuid,
          decision: "approve",
          locale: "en-US",
        },
      })
    ).toThrow(/responseId/);
    expect(() =>
      parseAgentEventDataForWrite("ApprovalResolved", {
        turnId: uuid,
        approvalId: uuid,
        decision: "approve",
      })
    ).toThrow(/responseId/);
  });

  it("persists domain artifacts by immutable reference and validates lifecycle updates", () => {
    expect(
      parseAgentEventDataForWrite("ArtifactCreated", {
        turnId: uuid,
        artifactId: uuid,
        artifact: {
          kind: "story_stage_proposal",
          storyAgentRunId: uuid,
          storyProjectId: uuid,
          storyChapterId: uuid,
          workspaceId: uuid,
          stage: "assets",
          schemaVersion: "story-asset-proposal-v1",
        },
        status: "proposed",
      })
    ).toMatchObject({
      artifact: { kind: "story_stage_proposal", stage: "assets" },
      status: "proposed",
    });
    expect(
      parseAgentEventDataForWrite("ArtifactUpdated", {
        turnId: uuid,
        artifactId: uuid,
        status: "applied",
      })
    ).toMatchObject({ artifactId: uuid, status: "applied" });
    expect(() =>
      parseAgentEventDataForWrite("ArtifactUpdated", {
        turnId: uuid,
        artifactId: uuid,
        status: "proposed",
      })
    ).toThrow();
    expect(() =>
      parseAgentEventDataForWrite("ArtifactCreated", {
        turnId: uuid,
        artifactId: uuid,
        artifact: {
          kind: "story_stage_proposal",
          storyAgentRunId: uuid,
          storyProjectId: uuid,
          storyChapterId: uuid,
          workspaceId: uuid,
          stage: "assets",
        },
        status: "proposed",
      })
    ).toThrow(/schemaVersion/);
  });

  it("persists ordered attachment display metadata without inventing transcript text", () => {
    const attachmentOnly = parseAgentEventDataForWrite("UserMessage", {
      turnId: uuid,
      messageId: "user:attachment-only",
      text: "",
      attachments: [
        { id: uuid, filename: "draft.fountain" },
        { id: "11111111-1111-4111-8111-111111111111", filename: "notes.md" },
      ],
    });
    expect(attachmentOnly).toMatchObject({
      text: "",
      attachments: [
        { id: uuid, filename: "draft.fountain" },
        { id: "11111111-1111-4111-8111-111111111111", filename: "notes.md" },
      ],
    });
    expect(() =>
      parseAgentEventDataForWrite("UserMessage", {
        turnId: uuid,
        messageId: "user:empty",
        text: "   ",
      })
    ).toThrow(/text or at least one attachment/);
    expect(() =>
      parseAgentEventDataForWrite("UserMessage", {
        turnId: uuid,
        messageId: "user:oversized",
        text: "x".repeat(20_001),
      })
    ).toThrow();
  });

  it("keeps old envelopes readable but rejects incomplete new writer payloads", () => {
    expect(() =>
      parseAgentEventDataForWrite("MessageStarted", {
        messageId: "assistant-1",
        segmentKind: "response",
      })
    ).toThrow(/turnId/);
    expect(
      parseAgentEventDataForWrite("MessageCompleted", {
        turnId: uuid,
        messageId: "assistant-1",
        text: "Done.",
        finishReason: "stop",
      })
    ).toMatchObject({ turnId: uuid, finishReason: "stop" });
    expect(
      parseAgentEventDataForWrite("MessageCompleted", {
        turnId: uuid,
        messageId: "assistant-partial",
        text: "An unverified partial answer",
        finishReason: "superseded",
      })
    ).toMatchObject({ turnId: uuid, finishReason: "superseded" });
    expect(() =>
      parseAgentEventDataForWrite("MessageStarted", {
        turnId: uuid,
        messageId: "assistant-activity",
        segmentKind: "activity",
      })
    ).toThrow();

    const legacyApprovalRequired = {
      turnId: uuid,
      approvalId: uuid,
      toolCallId: "tool-call-1",
      title: "Review the write",
      description: "This changes the project.",
      reversible: false,
      actions: ["approve", "edit_and_approve", "reject"] as const,
    };
    const legacyApprovalResolved = {
      turnId: uuid,
      approvalId: uuid,
      responseId: uuid,
      decision: "edit_and_approve" as const,
    };
    expect(ApprovalRequiredDataSchema.parse(legacyApprovalRequired).actions).toContain(
      "edit_and_approve"
    );
    expect(ApprovalResolvedDataSchema.parse(legacyApprovalResolved).decision).toBe(
      "edit_and_approve"
    );
    expect(() => parseAgentEventDataForWrite("ApprovalRequired", legacyApprovalRequired)).toThrow(
      /not implemented/
    );
    expect(() => parseAgentEventDataForWrite("ApprovalResolved", legacyApprovalResolved)).toThrow(
      /not implemented/
    );
    expect(() =>
      parseAgentEventDataForWrite("UserMessage", {
        turnId: uuid,
        messageId: "legacy-edited-approval",
        text: "Approved with edits",
        interaction: {
          kind: "approval",
          approvalId: uuid,
          responseId: uuid,
          decision: "edit_and_approve",
          locale: "en-US",
        },
      })
    ).toThrow(/not implemented/);

    // The generic envelope remains the legacy journal reader.
    expect(
      AgentEventEnvelopeSchema.parse({
        id: uuid,
        protocolVersion: "fizz.agent.v1",
        sessionId: "agent-os:v1:conversation:" + uuid,
        runId: uuid,
        conversationId: uuid,
        sequence: 7,
        timestamp: ts,
        type: "MessageStarted",
        data: { messageId: "legacy-assistant" },
      })
    ).toBeTruthy();
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
