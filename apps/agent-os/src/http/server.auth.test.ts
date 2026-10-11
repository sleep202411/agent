import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";

import {
  createAgentOsHttpServer,
  listenAgentOsHttp,
  validatedExternalResultContinuation,
} from "./server.js";
import { resetAgentOsCheckpointerForTests } from "../runtime/checkpointer.js";

/**
 * The inbound half of the gateway↔worker trust boundary.
 *
 * This process holds the internal token that writes to the platform as any
 * actor, and it reads actorId/projectId from the request body — so an
 * unauthenticated caller who can reach the port can impersonate anyone. The
 * token used to be checked only on the way OUT.
 */
const TOKEN = "test-internal-token-abcdef";
const originalFetch = globalThis.fetch;

describe("durable continuation request contract", () => {
  it("preserves a valid server-owned Story continuation plan", () => {
    expect(
      validatedExternalResultContinuation({
        externalJobId: "11111111-1111-4111-8111-111111111111",
        toolCallId: "story-apply-call",
        toolId: "story.applyProposal",
        resultMessageId: "external-result-message",
        phase: "apply",
        outcome: "completed",
        storyContinuation: {
          locale: "zh-CN",
          plan: {
            continueThrough: "storyboard",
            title: "逆流镇的信使",
            summary: "逐阶段完成剩余制作规格。",
            brief: "情节树、资产和分镜分别准备并等待审核。",
            experience: "mobile_h5",
            autoGenerateAssetImages: true,
          },
          completedStage: "assets",
        },
      })
    ).toEqual({
      externalJobId: "11111111-1111-4111-8111-111111111111",
      toolCallId: "story-apply-call",
      toolId: "story.applyProposal",
      resultMessageId: "external-result-message",
      phase: "apply",
      outcome: "completed",
      storyContinuation: {
        locale: "zh-CN",
        plan: {
          continueThrough: "storyboard",
          title: "逆流镇的信使",
          summary: "逐阶段完成剩余制作规格。",
          brief: "情节树、资产和分镜分别准备并等待审核。",
          experience: "mobile_h5",
          autoGenerateAssetImages: true,
        },
        completedStage: "assets",
      },
    });
  });

  it("allows an omitted continuation but rejects a malformed one", () => {
    const base = {
      externalJobId: "11111111-1111-4111-8111-111111111111",
      toolCallId: "story-apply-call",
      toolId: "story.applyProposal",
      resultMessageId: "external-result-message",
      phase: "apply",
      outcome: "completed",
    };
    expect(validatedExternalResultContinuation(base)).toEqual(base);
    expect(
      validatedExternalResultContinuation({
        ...base,
        storyContinuation: {
          locale: "zh-CN",
          plan: { continueThrough: "unknown" },
        },
      })
    ).toBeNull();
  });
});

describe("worker HTTP auth", () => {
  let server: ReturnType<typeof createAgentOsHttpServer>;
  let baseUrl: string;
  const previousToken = process.env.AGENT_OS_INTERNAL_TOKEN;
  const previousDomainUrl = process.env.AGENT_OS_DOMAIN_URL;
  const previousNodeEnv = process.env.NODE_ENV;
  const previousCheckpointDatabaseUrl = process.env.AGENT_OS_CHECKPOINT_DATABASE_URL;

  beforeEach(async () => {
    process.env.AGENT_OS_INTERNAL_TOKEN = TOKEN;
    server = createAgentOsHttpServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    globalThis.fetch = originalFetch;
    if (previousToken === undefined) delete process.env.AGENT_OS_INTERNAL_TOKEN;
    else process.env.AGENT_OS_INTERNAL_TOKEN = previousToken;
    if (previousDomainUrl === undefined) delete process.env.AGENT_OS_DOMAIN_URL;
    else process.env.AGENT_OS_DOMAIN_URL = previousDomainUrl;
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousCheckpointDatabaseUrl === undefined) {
      delete process.env.AGENT_OS_CHECKPOINT_DATABASE_URL;
    } else {
      process.env.AGENT_OS_CHECKPOINT_DATABASE_URL = previousCheckpointDatabaseUrl;
    }
    resetAgentOsCheckpointerForTests();
  });

  it("refuses a run with no token", async () => {
    const res = await fetch(`${baseUrl}/v1/agent-os/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "p1",
        actorId: "someone-elses-user-id",
        conversationId: "c1",
        message: "写入角色",
        modelProfileId: "qwen-plus",
      }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
  });

  it("protects discovery and validates scoped identity before model admission", async () => {
    const previous = process.env.AGENT_OS_DISCOVERY_MODEL_PROFILE;
    delete process.env.AGENT_OS_DISCOVERY_MODEL_PROFILE;
    try {
      const path = `${baseUrl}/v1/agent-os/content-gps/discover`;
      expect((await fetch(path, { method: "POST", body: "{}" })).status).toBe(401);
      const headers = { "content-type": "application/json", "x-agent-os-internal-token": TOKEN };
      expect((await fetch(path, { method: "POST", headers, body: "{}" })).status).toBe(400);
      const body = {
        requestId: "11111111-1111-4111-8111-111111111111",
        locale: "en-US",
        credential: {
          requestId: "11111111-1111-4111-8111-111111111111",
          readToken: "b".repeat(64),
        },
        coordinateSystem: "WGS84",
        genres: [],
        conversation: {
          current: {
            kind: "creators",
            query: {
              basedIn: null,
              serves: null,
              remoteOnly: false,
              availableForWork: false,
              category: null,
              text: "",
            },
          },
          messages: [{ role: "user", content: "Find a studio" }],
        },
      };
      const reply = await fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
      expect(reply.status).toBe(503);
      expect((await reply.json()).error.code).toBe("DISCOVERY_NOT_CONFIGURED");
      expect(
        (
          await fetch(path, {
            method: "POST",
            headers,
            body: JSON.stringify({ ...body, actorId: "forged" }),
          })
        ).status
      ).toBe(400);
      expect(
        (
          await fetch(path, {
            method: "POST",
            headers,
            body: JSON.stringify({
              ...body,
              credential: { ...body.credential, requestId: "22222222-2222-4222-8222-222222222222" },
            }),
          })
        ).status
      ).toBe(400);
    } finally {
      if (previous === undefined) delete process.env.AGENT_OS_DISCOVERY_MODEL_PROFILE;
      else process.env.AGENT_OS_DISCOVERY_MODEL_PROFILE = previous;
    }
  });

  it("protects Content GPS extraction and fails closed without model configuration", async () => {
    const previous = process.env.AGENT_OS_CONTENT_GPS_MODEL_PROFILE;
    delete process.env.AGENT_OS_CONTENT_GPS_MODEL_PROFILE;
    try {
      const path = `${baseUrl}/v1/agent-os/content-gps/extract`;
      expect((await fetch(path, { method: "POST", body: "{}" })).status).toBe(401);
      const headers = { "content-type": "application/json", "x-agent-os-internal-token": TOKEN };
      expect((await fetch(path, { method: "POST", headers, body: "{}" })).status).toBe(400);
      const reply = await fetch(path, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ipId: "01900000-0000-7000-8000-000000000001",
          locale: "en-US",
          analysisVersion: "v1",
          analyzedAt: "2026-10-01T00:00:00Z",
          sources: [],
        }),
      });
      expect(reply.status).toBe(503);
      expect((await reply.json()).error.code).toBe("GPS_MODEL_NOT_CONFIGURED");
    } finally {
      if (previous === undefined) delete process.env.AGENT_OS_CONTENT_GPS_MODEL_PROFILE;
      else process.env.AGENT_OS_CONTENT_GPS_MODEL_PROFILE = previous;
    }
  });

  it("requires the internal token for viewing assistance", async () => {
    const res = await fetch(`${baseUrl}/v1/agent-os/viewer-assistance`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ preference: "calm", locale: "en-US", candidates: [] }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects invalid viewer context and missing viewer model configuration", async () => {
    const previous = process.env.AGENT_OS_VIEWER_MODEL_PROFILE;
    delete process.env.AGENT_OS_VIEWER_MODEL_PROFILE;
    try {
      const send = (body: unknown) =>
        fetch(`${baseUrl}/v1/agent-os/viewer-assistance`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-agent-os-internal-token": TOKEN },
          body: JSON.stringify(body),
        });
      const invalid = await send({ preference: "calm", projectId: "private" });
      expect(invalid.status).toBe(400);
      const unavailable = await send({ preference: "calm", locale: "en-US", candidates: [] });
      expect(unavailable.status).toBe(503);
      await expect(unavailable.json()).resolves.toMatchObject({
        error: { code: "VIEWER_MODEL_NOT_CONFIGURED" },
      });
    } finally {
      if (previous === undefined) delete process.env.AGENT_OS_VIEWER_MODEL_PROFILE;
      else process.env.AGENT_OS_VIEWER_MODEL_PROFILE = previous;
    }
  });

  it("reports missing film knowledge configuration instead of selecting an unknown model", async () => {
    const previous = process.env.AGENT_OS_VIEWER_MODEL_PROFILE;
    delete process.env.AGENT_OS_VIEWER_MODEL_PROFILE;
    try {
      const response = await fetch(`${baseUrl}/v1/agent-os/film-knowledge`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-agent-os-internal-token": TOKEN },
        body: JSON.stringify({
          ipId: "a0000000-0000-4000-8000-000000000001",
          ipTitle: "Film",
          question: "Who is the hero?",
          locale: "en-US",
          sources: [
            {
              documentId: "b0000000-0000-4000-8000-000000000002",
              title: "Characters",
              snippet: "Ric is the hero.",
            },
          ],
        }),
      });
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "FILM_KNOWLEDGE_MODEL_NOT_CONFIGURED" },
      });
    } finally {
      if (previous === undefined) delete process.env.AGENT_OS_VIEWER_MODEL_PROFILE;
      else process.env.AGENT_OS_VIEWER_MODEL_PROFILE = previous;
    }
  });

  it("refuses a wrong token", async () => {
    const res = await fetch(`${baseUrl}/v1/agent-os/runs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-os-internal-token": "not-the-token-abcdef",
      },
      body: JSON.stringify({ projectId: "p1" }),
    });
    expect(res.status).toBe(401);
  });

  it("refuses reading another run's events without the token", async () => {
    const res = await fetch(`${baseUrl}/v1/agent-os/runs/some-run-id/events`);
    expect(res.status).toBe(401);
  });

  it("refuses approving and cancelling without the token", async () => {
    for (const path of ["approvals", "cancel"]) {
      const res = await fetch(`${baseUrl}/v1/agent-os/runs/some-run-id/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "approve" }),
      });
      expect(res.status).toBe(401);
    }
  });

  it("leaves /health open for the kubelet, and reports the domain mode", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // A deploy that silently fell back to the throwaway store must be visible.
    expect(["http", "memory", "unconfigured"]).toContain(body.domain);
  });

  it("reports non-ready instead of silently using memory when production lacks a checkpoint DSN", async () => {
    resetAgentOsCheckpointerForTests();
    process.env.NODE_ENV = "production";
    delete process.env.AGENT_OS_CHECKPOINT_DATABASE_URL;

    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      ok: false,
      checkpoint: "unavailable",
      error: expect.stringContaining("AGENT_OS_CHECKPOINT_DATABASE_URL"),
    });
    await expect(listenAgentOsHttp(0)).rejects.toThrow("AGENT_OS_CHECKPOINT_DATABASE_URL");
  });

  it("accepts the right token", async () => {
    const res = await fetch(`${baseUrl}/v1/agent-os/runs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-os-internal-token": TOKEN,
      },
      // Deliberately incomplete: what matters is that it got PAST auth, which a
      // 400 proves and a 401 would not.
      body: JSON.stringify({ projectId: "p1" }),
    });
    expect(res.status).not.toBe(401);
  });

  it("requires the Gateway-reserved runId before checking model readiness", async () => {
    const res = await fetch(`${baseUrl}/v1/agent-os/runs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-os-internal-token": TOKEN,
      },
      body: JSON.stringify({
        projectId: "22222222-2222-4222-8222-222222222222",
        conversationId: "33333333-3333-4333-8333-333333333333",
        actorId: "user-1",
        message: "Create a story.",
        modelProfileId: "qwen-plus",
        projectKind: "story",
        workbenchMode: "story",
      }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain("runId");
  });

  it("replays a durable run before model and Skill initialization", async () => {
    const runId = "44444444-4444-4444-8444-444444444444";
    const conversationId = "33333333-3333-4333-8333-333333333333";
    process.env.AGENT_OS_DOMAIN_URL = "http://gateway.test";
    globalThis.fetch = vi.fn(async (input, init) => {
      if (String(input).startsWith("http://gateway.test/")) {
        return new Response(
          JSON.stringify({
            ok: true,
            status: "completed",
            events: [
              {
                id: "55555555-5555-4555-8555-555555555555",
                protocolVersion: "fizz.agent.v1",
                sessionId: `agent-os:v1:conversation:${conversationId}`,
                runId,
                conversationId,
                sequence: 1,
                timestamp: "2026-08-21T00:00:00.000Z",
                type: "RunCompleted",
                data: {
                  turnId: "66666666-6666-4666-8666-666666666666",
                  status: "completed",
                },
              },
            ],
            pendingApproval: null,
            pendingUserInput: null,
            pendingExternal: null,
            assistantText: "Already completed.",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    const res = await originalFetch(`${baseUrl}/v1/agent-os/runs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-os-internal-token": TOKEN,
      },
      // No Skill snapshot is needed for a replay; initializing a new turn
      // would reject this command, proving the durable branch ran first.
      body: JSON.stringify({
        runId,
        clientSubmissionId: "77777777-7777-4777-8777-777777777777",
        turnId: "66666666-6666-4666-8666-666666666666",
        messageId: "88888888-8888-4888-8888-888888888888",
        startExecutionToken: "99999999-9999-4999-8999-999999999999",
        startExecutionAttemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        startExecutionEpoch: 1,
        projectId: "22222222-2222-4222-8222-222222222222",
        conversationId,
        actorId: "user-1",
        message: "Create a story.",
        modelProfileId: "qwen-plus",
        projectKind: "story",
        workbenchMode: "story",
      }),
    });

    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({
      runId,
      status: "completed",
      assistantText: "Already completed.",
    });
  });
});
