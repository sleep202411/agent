import { canonicalAgentSessionName } from "@repo/shared/agent-platform";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { AgentPlatformApiClient } from "./api-client";

vi.mock("@/lib/api", () => ({
  api: {
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

const WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
const PROJECT_ID = "00000000-0000-4000-8000-000000000002";
const CONVERSATION_ID = "00000000-0000-4000-8000-000000000003";
const INVOCATION_ID = "00000000-0000-4000-8000-000000000004";
const WORKFLOW_ID = "00000000-0000-4000-8000-000000000005";
const ATTACHMENT_ID = "00000000-0000-4000-8000-000000000006";
const MEDIA_ASSET_ID = "00000000-0000-4000-8000-000000000007";
const SESSION_NAME = canonicalAgentSessionName(CONVERSATION_ID);

describe("AgentPlatformApiClient", () => {
  beforeEach(() => {
    vi.mocked(api.post).mockReset();
    vi.mocked(api.patch).mockReset();
  });

  it("resolves the product conversation and preserves the server-issued realtime grant", async () => {
    vi.mocked(api.post).mockResolvedValue(envelope(grant()));
    const client = createClient();

    await expect(client.resolveStoryConversation(PROJECT_ID)).resolves.toEqual(grant());
    expect(api.post).toHaveBeenCalledWith(
      "/aurora/agent-platform/conversations/resolve",
      expect.objectContaining({
        raw: true,
        data: {
          schemaVersion: "agent-conversation-resolve/v1",
          surface: "story-studio",
          workspaceId: WORKSPACE_ID,
          projectId: PROJECT_ID,
          locale: "zh-CN",
        },
        headers: requestHeaders(),
      })
    );
  });

  it("sends only a validated input pointer to the invocation boundary", async () => {
    vi.mocked(api.post).mockResolvedValue(
      envelope({
        schemaVersion: "agent-invocation-accepted/v1",
        invocationId: INVOCATION_ID,
      })
    );
    const client = createClient();

    await expect(
      client.invoke({
        conversationId: CONVERSATION_ID,
        inputEventId: "client-message-01",
        clientMessageId: "0197f4a2-0800-7000-8000-000000000012",
        sessionName: SESSION_NAME,
      })
    ).resolves.toEqual({
      schemaVersion: "agent-invocation-accepted/v1",
      invocationId: INVOCATION_ID,
    });
    expect(api.post).toHaveBeenCalledWith(
      "/aurora/agent-platform/invocations",
      expect.objectContaining({
        data: {
          schemaVersion: "agent-invocation-gateway/v1",
          conversationId: CONVERSATION_ID,
          inputEventId: "client-message-01",
          clientMessageId: "0197f4a2-0800-7000-8000-000000000012",
          sessionName: SESSION_NAME,
          locale: "zh-CN",
        },
      })
    );
  });

  it("rejects a forged session name before any network request", async () => {
    const client = createClient();

    expect(() =>
      client.invoke({
        conversationId: CONVERSATION_ID,
        inputEventId: "client-message-01",
        clientMessageId: "0197f4a2-0800-7000-8000-000000000012",
        sessionName: canonicalAgentSessionName(WORKFLOW_ID),
      })
    ).toThrow("sessionName does not match");
    expect(api.post).not.toHaveBeenCalled();
  });

  it("preserves the aggregate identity when admitting an approval continuation", async () => {
    vi.mocked(api.post).mockResolvedValue(
      envelope({
        schemaVersion: "agent-invocation-accepted/v1",
        invocationId: INVOCATION_ID,
      })
    );
    const client = createClient();

    await client.invoke({
      conversationId: CONVERSATION_ID,
      inputEventId: "continuation-event-01",
      clientMessageId: "continuation-message-01",
      sessionName: SESSION_NAME,
      continuationOfInvocationId: INVOCATION_ID,
    });

    expect(api.post).toHaveBeenCalledWith(
      "/aurora/agent-platform/invocations",
      expect.objectContaining({
        data: expect.objectContaining({
          inputEventId: "continuation-event-01",
          clientMessageId: "continuation-message-01",
          continuationOfInvocationId: INVOCATION_ID,
        }),
      })
    );
  });

  it("cancels by durable invocation identity instead of a transport message id", async () => {
    vi.mocked(api.post).mockResolvedValue(
      envelope({
        schemaVersion: "agent-cancellation-result/v1",
        invocationId: INVOCATION_ID,
        status: "cancellation-requested",
      })
    );
    const client = createClient();

    await expect(client.cancel(CONVERSATION_ID, INVOCATION_ID)).resolves.toMatchObject({
      invocationId: INVOCATION_ID,
      status: "cancellation-requested",
    });
    expect(api.post).toHaveBeenCalledWith(
      "/aurora/agent-platform/cancellations",
      expect.objectContaining({
        data: {
          schemaVersion: "agent-cancellation-gateway/v1",
          conversationId: CONVERSATION_ID,
          invocationId: INVOCATION_ID,
          locale: "zh-CN",
        },
      })
    );
  });

  it("loads the durable invocation lifecycle projection", async () => {
    const page = {
      schemaVersion: "agent-invocation-status-page/v1",
      revision: "17",
      hasMore: false,
      invocations: [
        {
          invocationId: INVOCATION_ID,
          runId: WORKFLOW_ID,
          clientMessageId: "client-message-01",
          inputEventId: "input-event-01",
          status: "failed",
          error: {
            code: "AGENT_RUN_OPEN_FAILED",
            messageKey: "agent.error.start_failed",
            message: "The triggering input could not be located.",
            retryable: false,
            diagnosticId: "00000000-0000-4000-8000-000000000008",
          },
          latestAttempt: {
            attemptId: "00000000-0000-4000-8000-000000000009",
            ordinal: 0,
            inputEventId: "input-event-01",
            clientMessageId: "client-message-01",
            status: "dispatched",
            error: null,
          },
          createdAt: "2026-07-30T10:00:00.000Z",
          startedAt: null,
          completedAt: "2026-07-30T10:00:05.000Z",
        },
      ],
    };
    vi.mocked(api.post).mockResolvedValue(envelope(page));
    const client = createClient();

    await expect(client.invocationStatus(CONVERSATION_ID)).resolves.toEqual(page);
    expect(api.post).toHaveBeenCalledWith(
      "/aurora/agent-platform/invocations/status",
      expect.objectContaining({
        data: {
          schemaVersion: "agent-invocation-status-request/v1",
          conversationId: CONVERSATION_ID,
          locale: "zh-CN",
          limit: 50,
        },
      })
    );
  });

  it("registers product-owned media and never exposes a storage URL", async () => {
    const attachment = {
      schemaVersion: "agent-attachment/v1",
      id: ATTACHMENT_ID,
      conversationId: CONVERSATION_ID,
      mediaAssetId: MEDIA_ASSET_ID,
      fileName: "reference.webp",
      mediaType: "image/webp",
      sizeBytes: "4096",
      status: "ready",
      uri: `fizzdragon-media://${ATTACHMENT_ID}`,
      ingest: null,
      analysis: null,
      error: null,
    };
    vi.mocked(api.post).mockResolvedValue(envelope(attachment));
    const client = createClient();

    await expect(
      client.registerAttachment(CONVERSATION_ID, MEDIA_ASSET_ID, "reference.webp")
    ).resolves.toEqual(attachment);
    expect(api.post).toHaveBeenCalledWith(
      "/aurora/agent-platform/attachments/register",
      expect.objectContaining({
        data: {
          schemaVersion: "agent-attachment-register/v1",
          conversationId: CONVERSATION_ID,
          mediaAssetId: MEDIA_ASSET_ID,
          fileName: "reference.webp",
          locale: "zh-CN",
        },
      })
    );
  });

  it("fails closed when a successful HTTP response drifts from the product envelope", async () => {
    vi.mocked(api.post).mockResolvedValue({
      code: 200,
      data: grant(),
      undocumentedField: true,
    });
    const client = createClient();

    await expect(client.resolveStoryConversation(PROJECT_ID)).rejects.toThrow(
      "response envelope is malformed"
    );
  });
});

function createClient() {
  return new AgentPlatformApiClient({
    workspaceId: WORKSPACE_ID,
    locale: "zh-CN",
  });
}

function requestHeaders() {
  return {
    "x-fizz-workspace-id": WORKSPACE_ID,
    "accept-language": "zh-CN",
  };
}

function envelope(data: unknown) {
  return { code: 200, data };
}

function grant() {
  return {
    schemaVersion: "agent-conversation-grant/v1",
    conversation: {
      id: CONVERSATION_ID,
      surface: "story-studio",
      title: null,
      permissionMode: "smart",
      createdAt: "2026-07-30T10:00:00.000Z",
      updatedAt: "2026-07-30T10:00:00.000Z",
      archivedAt: null,
    },
    sessionName: SESSION_NAME,
    ablyToken: "jwt.header.signature",
    expiresAt: "2026-07-30T11:00:00.000Z",
  };
}
