import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn().mockResolvedValue({ runId: "run-1", status: "running" }),
  },
  ApiRequestError: class ApiRequestError extends Error {},
}));

import { api } from "@/lib/api";
import { AgentOsApiClient } from "./api-client";

describe("AgentOsApiClient structured input", () => {
  it("sends stable start identities and fails fast beyond the transcript limit", async () => {
    const client = new AgentOsApiClient();
    const input = {
      projectId: "11111111-1111-4111-8111-111111111111",
      conversationId: "22222222-2222-4222-8222-222222222222",
      clientSubmissionId: "33333333-3333-4333-8333-333333333333",
      turnId: "44444444-4444-4444-8444-444444444444",
      messageId: "55555555-5555-4555-8555-555555555555",
      message: "Build the next scene.",
      modelProfileId: "qwen-plus",
      workbenchMode: "story" as const,
    };

    await client.startRun(input);
    expect(api.post).toHaveBeenCalledWith(
      "/aurora/agent-os/runs",
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: input.conversationId,
          clientSubmissionId: input.clientSubmissionId,
          turnId: input.turnId,
          messageId: input.messageId,
        }),
      })
    );
    await expect(client.startRun({ ...input, message: "x".repeat(20_001) })).rejects.toThrow(
      /20,000/
    );
    await expect(client.startRun({ ...input, message: "" })).rejects.toThrow(
      /message or attachmentIds/
    );
    await expect(
      client.startRun({
        ...input,
        message: "",
        attachmentIds: ["66666666-6666-4666-8666-666666666666"],
      })
    ).resolves.toMatchObject({ status: "running" });
  });

  it("sends the caller-owned responseId used for idempotent retries", async () => {
    const client = new AgentOsApiClient();
    await client.resolveUserInput({
      runId: "run-1",
      requestId: "11111111-1111-4111-8111-111111111111",
      responseId: "22222222-2222-4222-8222-222222222222",
      answers: { ratio: "landscape_16_9" },
      projectId: "33333333-3333-4333-8333-333333333333",
      conversationId: "44444444-4444-4444-8444-444444444444",
      modelProfileId: "qwen-plus",
      permissionMode: "smart",
    });

    expect(api.post).toHaveBeenCalledWith(
      "/aurora/agent-os/runs/run-1/user-input",
      expect.objectContaining({
        data: expect.objectContaining({
          requestId: "11111111-1111-4111-8111-111111111111",
          responseId: "22222222-2222-4222-8222-222222222222",
          answers: { ratio: "landscape_16_9" },
        }),
      })
    );
  });

  it("sends stable approval and response identities", async () => {
    const client = new AgentOsApiClient();
    await client.resolveApproval({
      runId: "run-1",
      approvalId: "11111111-1111-4111-8111-111111111111",
      responseId: "22222222-2222-4222-8222-222222222222",
      decision: "approve",
      responseText: "Approved",
      locale: "en-US",
      projectId: "33333333-3333-4333-8333-333333333333",
      conversationId: "44444444-4444-4444-8444-444444444444",
      modelProfileId: "qwen-plus",
      permissionMode: "smart",
    });

    expect(api.post).toHaveBeenCalledWith(
      "/aurora/agent-os/runs/run-1/approvals",
      expect.objectContaining({
        data: expect.objectContaining({
          approvalId: "11111111-1111-4111-8111-111111111111",
          responseId: "22222222-2222-4222-8222-222222222222",
          decision: "approve",
          responseText: "Approved",
          locale: "en-US",
        }),
      })
    );
  });
});
