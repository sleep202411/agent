import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";

import { createAgentOsHttpServer } from "./server.js";

/**
 * The inbound half of the gateway↔worker trust boundary.
 *
 * This process holds the internal token that writes to the platform as any
 * actor, and it reads actorId/projectId from the request body — so an
 * unauthenticated caller who can reach the port can impersonate anyone. The
 * token used to be checked only on the way OUT.
 */
const TOKEN = "test-internal-token-abcdef";

describe("worker HTTP auth", () => {
  let server: ReturnType<typeof createAgentOsHttpServer>;
  let baseUrl: string;
  const previousToken = process.env.AGENT_OS_INTERNAL_TOKEN;

  beforeEach(async () => {
    process.env.AGENT_OS_INTERNAL_TOKEN = TOKEN;
    server = createAgentOsHttpServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousToken === undefined) delete process.env.AGENT_OS_INTERNAL_TOKEN;
    else process.env.AGENT_OS_INTERNAL_TOKEN = previousToken;
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
});
