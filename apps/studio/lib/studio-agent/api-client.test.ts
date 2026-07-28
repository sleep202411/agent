import {
  STUDIO_AGENT_SCHEMA_VERSION,
  type StudioAgentSubmissionInvocationRequest,
} from "@repo/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { StudioAgentApiClient } from "./api-client";

const THREAD_ID = "00000000-0000-4000-8000-000000000002";
const RUN_ID = "00000000-0000-4000-8000-000000000030";
const MESSAGE_ID = "00000000-0000-4000-8000-000000000031";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

describe("StudioAgentApiClient", () => {
  beforeEach(() => {
    vi.mocked(api.get).mockReset();
    vi.mocked(api.post).mockReset();
    vi.mocked(api.patch).mockReset();
    vi.mocked(api.delete).mockReset();
  });

  it("wakes a turn for an input the transport already published", async () => {
    vi.mocked(api.post).mockResolvedValue({
      code: 200,
      data: {
        kind: "submission",
        threadId: THREAD_ID,
        messageId: MESSAGE_ID,
        runId: RUN_ID,
        inputId: null,
        channelName: `studio-agent:thread:${THREAD_ID}`,
      },
    });
    const client = new StudioAgentApiClient({
      workspaceId: "workspace-1",
      locale: "zh-CN",
    });

    await expect(client.sendInvocation(invocation())).resolves.toEqual({
      kind: "submission",
      threadId: THREAD_ID,
      messageId: MESSAGE_ID,
      runId: RUN_ID,
      inputId: null,
      channelName: `studio-agent:thread:${THREAD_ID}`,
    });
    expect(api.post).toHaveBeenCalledWith(
      "/aurora/studio-agent/invocations",
      expect.objectContaining({
        raw: true,
        data: invocation(),
        headers: {
          "x-fizz-workspace-id": "workspace-1",
          "accept-language": "zh-CN",
        },
      })
    );
  });

  it("refuses to wake a run without saying how the prompt is meant to reach it", async () => {
    const client = new StudioAgentApiClient({
      workspaceId: "workspace-1",
      locale: "en-US",
    });

    // The pairing rule is the server's, and the client must not be the place it
    // is first noticed: a steer with no delivery mode would otherwise reach the
    // control plane as a request to start a second root turn.
    await expect(
      client.sendInvocation({ ...invocation(), targetRunId: RUN_ID, delivery: null })
    ).rejects.toThrow();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("sends the turn cursor only when paging backwards", async () => {
    const snapshot = {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      thread: snapshotThread(),
      messages: [],
      runs: [],
      actions: [],
      approvals: [],
      inputs: [],
      activities: [],
      turnWindow: { earliestRootRunId: null, hasEarlier: false },
      latestEventSequence: 0,
    };
    vi.mocked(api.get).mockResolvedValue({ code: 200, data: snapshot });
    const client = new StudioAgentApiClient({
      workspaceId: "workspace-1",
      locale: "zh-CN",
    });

    await client.getSnapshot("thread-1");
    // buildUrl drops undefined values, so the live tail must carry no cursor
    // at all rather than an empty one.
    expect(vi.mocked(api.get).mock.calls[0][1]).toMatchObject({
      params: { beforeRootRunId: undefined },
    });

    const cursor = "019f8d20-0000-7000-8000-000000000001";
    await client.getSnapshot("thread-1", { beforeRootRunId: cursor });
    expect(vi.mocked(api.get).mock.calls[1][1]).toMatchObject({
      params: { beforeRootRunId: cursor },
    });
  });

  it("fails closed when a successful HTTP response drifts from the protocol", async () => {
    vi.mocked(api.post).mockResolvedValue({
      code: 200,
      data: { threadId: THREAD_ID, messageId: MESSAGE_ID, runId: RUN_ID },
    });
    const client = new StudioAgentApiClient({
      workspaceId: "workspace-1",
      locale: "en-US",
    });

    await expect(client.sendInvocation(invocation())).rejects.toThrow();
  });

  it("mints a thread-scoped realtime grant and keeps the channel the server's choice", async () => {
    const tokenRequest = {
      keyName: "app.key",
      mac: "signature",
      nonce: "0123456789abcdef",
      capability: '{"studio-agent:thread:thread/id":["subscribe"]}',
      timestamp: 1_800_000_000_000,
      ttl: 300_000,
    };
    vi.mocked(api.get).mockResolvedValue({
      code: 200,
      data: { channel: "studio-agent:thread:thread/id", ttlMs: 300_000, tokenRequest },
    });
    const client = new StudioAgentApiClient({
      workspaceId: "workspace with spaces",
      locale: "en-US",
    });

    await expect(client.createRealtimeGrant("thread/id")).resolves.toEqual({
      channel: "studio-agent:thread:thread/id",
      ttlMs: 300_000,
      tokenRequest,
    });
    expect(api.get).toHaveBeenCalledWith(
      "/aurora/studio-agent/threads/thread%2Fid/realtime-token",
      expect.objectContaining({
        raw: true,
        headers: {
          "x-fizz-workspace-id": "workspace with spaces",
          "accept-language": "en-US",
        },
      })
    );
  });

  it("refuses a grant that cannot authorize a channel", async () => {
    vi.mocked(api.get).mockResolvedValue({
      code: 200,
      data: {
        channel: "studio-agent:thread:thread-1",
        ttlMs: 300_000,
        tokenRequest: { keyName: "app.key" },
      },
    });
    const client = new StudioAgentApiClient({ workspaceId: "workspace-1", locale: "en-US" });

    await expect(client.createRealtimeGrant("thread-1")).rejects.toThrow("is missing mac");
  });

  it("registers a confirmed media asset and returns only canonical attachment metadata", async () => {
    const threadId = "00000000-0000-4000-8000-000000000001";
    const request = {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      mediaAssetId: "00000000-0000-4000-8000-000000000070",
      fileName: "reference.webp",
    };
    const attachment = {
      type: "attachment" as const,
      attachmentId: "00000000-0000-4000-8000-000000000071",
      fileName: "reference.webp",
      mediaType: "image/webp",
      sizeBytes: 4_096,
      status: "ready" as const,
    };
    vi.mocked(api.post).mockResolvedValue({
      code: 200,
      data: {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        attachment,
        created: true,
      },
    });
    const client = new StudioAgentApiClient({
      workspaceId: "workspace-1",
      locale: "en-US",
    });

    await expect(client.registerAttachment(threadId, request)).resolves.toEqual({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      attachment,
      created: true,
    });
    expect(api.post).toHaveBeenCalledWith(`/aurora/studio-agent/threads/${threadId}/attachments`, {
      raw: true,
      data: request,
      headers: {
        "x-fizz-workspace-id": "workspace-1",
        "accept-language": "en-US",
      },
      signal: undefined,
    });
  });

  it("idempotently schedules an abandoned canonical attachment for cleanup", async () => {
    const threadId = "00000000-0000-4000-8000-000000000001";
    const attachmentId = "00000000-0000-4000-8000-000000000071";
    vi.mocked(api.delete).mockResolvedValue({
      code: 200,
      data: {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        attachmentId,
        cleanupStatus: "scheduled",
      },
    });
    const client = new StudioAgentApiClient({
      workspaceId: "workspace-1",
      locale: "en-US",
    });
    const controller = new AbortController();

    await expect(
      client.deleteAttachment(threadId, attachmentId, controller.signal)
    ).resolves.toEqual({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      attachmentId,
      cleanupStatus: "scheduled",
    });
    expect(api.delete).toHaveBeenCalledWith(
      `/aurora/studio-agent/threads/${threadId}/attachments/${attachmentId}`,
      {
        raw: true,
        headers: {
          "x-fizz-workspace-id": "workspace-1",
          "accept-language": "en-US",
        },
        signal: controller.signal,
      }
    );
  });
});

function invocation(): StudioAgentSubmissionInvocationRequest {
  return {
    kind: "submission",
    inputEventId: "ably-event-1",
    sessionName: `studio-agent:thread:${THREAD_ID}`,
    threadId: THREAD_ID,
    clientMessageId: MESSAGE_ID,
    parts: [{ type: "text", format: "plain_text", text: "Rewrite chapter one." }],
    targetRunId: null,
    delivery: null,
    scope: {
      workspaceId: "workspace-1",
      container: {
        resourceType: "story.project",
        resourceId: "project-1",
        revision: null,
      },
      focus: null,
    },
    locale: "en-US",
  };
}

function snapshotThread() {
  const createdAt = "2026-07-24T12:00:00.000Z";
  return {
    schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
    threadId: "00000000-0000-4000-8000-000000000002",
    surfaceId: "story.studio",
    scenario: { id: "story.studio.assistant", version: "1.0.0" },
    scope: {
      workspaceId: "workspace-1",
      container: {
        resourceType: "story.project",
        resourceId: "project-1",
        revision: null,
      },
      focus: null,
    },
    title: null,
    ownerActorId: "actor-1",
    status: "active" as const,
    permissionPolicy: {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      policyId: "00000000-0000-4000-8000-000000000020",
      revision: 1,
      mode: "smart" as const,
      rules: [],
      createdAt,
    },
    activeRunId: null,
    createdAt,
    updatedAt: createdAt,
  };
}
