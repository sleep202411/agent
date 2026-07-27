import { STUDIO_AGENT_SCHEMA_VERSION } from "@repo/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";

import { StudioAgentApiClient } from "./api-client";

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

  it("scopes replay requests and validates the exact shared envelope", async () => {
    vi.mocked(api.get).mockResolvedValue({
      code: 200,
      data: {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        events: [],
        latestSequence: 7,
        hasMore: false,
      },
    });
    const client = new StudioAgentApiClient({
      workspaceId: "workspace-1",
      locale: "zh-CN",
    });

    await expect(client.getEventPage("thread-1", 7, 500)).resolves.toEqual({
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      events: [],
      latestSequence: 7,
      hasMore: false,
    });
    expect(api.get).toHaveBeenCalledWith(
      "/aurora/studio-agent/threads/thread-1/events",
      expect.objectContaining({
        raw: true,
        params: { afterSequence: 7, limit: 500 },
        headers: {
          "x-fizz-workspace-id": "workspace-1",
          "accept-language": "zh-CN",
        },
      })
    );
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
    vi.mocked(api.get).mockResolvedValue({
      code: 200,
      data: {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        events: [],
        latestSequence: "7",
        hasMore: false,
      },
    });
    const client = new StudioAgentApiClient({
      workspaceId: "workspace-1",
      locale: "en-US",
    });

    await expect(client.getEventPage("thread-1", 0, 100)).rejects.toThrow();
  });

  it("builds resumable stream URLs from the acknowledged sequence", () => {
    const client = new StudioAgentApiClient({
      workspaceId: "workspace with spaces",
      locale: "en-US",
    });

    expect(client.eventStreamUrl("thread/id", "42")).toBe(
      "/aurora/studio-agent/threads/thread%2Fid/events/stream?afterSequence=42"
    );
    expect(client.eventStreamHeaders()).toEqual({
      "x-fizz-workspace-id": "workspace with spaces",
      "accept-language": "en-US",
    });
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

  it("resolves a persistent grant and approval through one strict command", async () => {
    const approvalId = "00000000-0000-4000-8000-000000000061";
    const threadId = "00000000-0000-4000-8000-000000000001";
    const actionInputHash = "a".repeat(64);
    const permissionPolicy = {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      policyId: "00000000-0000-4000-8000-000000000020",
      revision: 2,
      mode: "smart" as const,
      rules: [
        {
          ruleId: approvalId,
          priority: 1_000,
          selector: {
            scenarioId: "story.studio.assistant",
            capabilityId: "story.canvas.write",
            capabilityVersion: "1.2.0",
            resourceType: null,
            effect: "write" as const,
            risk: "medium" as const,
          },
          decision: "allow" as const,
        },
      ],
      createdAt: "2026-07-24T12:00:00.000Z",
    };
    vi.mocked(api.post).mockResolvedValue({
      code: 200,
      data: {
        schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
        approval: {
          schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
          approvalId,
          threadId,
          runId: "00000000-0000-4000-8000-000000000062",
          actionId: "00000000-0000-4000-8000-000000000060",
          status: "approved",
          reason: "The story canvas will be changed.",
          actionInputHash,
          requestedAt: "2026-07-24T12:03:01.000Z",
          expiresAt: null,
          decision: {
            decision: "approved",
            actorId: "actor-1",
            note: null,
            decidedAt: "2026-07-24T12:03:02.000Z",
          },
        },
        permissionPolicy,
      },
    });
    const client = new StudioAgentApiClient({
      workspaceId: "workspace-1",
      locale: "en-US",
    });
    const request = {
      schemaVersion: STUDIO_AGENT_SCHEMA_VERSION,
      decision: "approved" as const,
      actionInputHash,
      note: null,
      persistentGrant: {
        expectedPolicyRevision: 1,
        capability: {
          id: "story.canvas.write",
          version: "1.2.0",
        },
      },
    };

    await expect(client.resolveApproval(threadId, approvalId, request)).resolves.toEqual(
      expect.objectContaining({ permissionPolicy })
    );
    expect(api.post).toHaveBeenCalledWith(
      `/aurora/studio-agent/threads/${threadId}/approvals/${approvalId}/resolve`,
      {
        raw: true,
        data: request,
        headers: {
          "x-fizz-workspace-id": "workspace-1",
          "accept-language": "en-US",
        },
        signal: undefined,
      }
    );
  });
});

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
