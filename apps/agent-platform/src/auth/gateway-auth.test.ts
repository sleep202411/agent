import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import type { GatewayClaims } from "../context/agent-context.js";
import { GatewayAuthProvider, localJwtParameters } from "./gateway-auth.js";

const secret = "local-test-secret-that-is-at-least-32-characters";
const context: GatewayClaims["agent_context"] = {
  actorId: "actor-1",
  actorDisplayName: "Actor One",
  conversationId: "0197f4a2-0800-7000-8000-000000000004",
  surface: "story-studio",
  sessionName: "agent:v1:conversation:0197f4a2-0800-7000-8000-000000000004",
  permissionMode: "smart",
  scope: {
    kind: "story-project",
    workspaceId: "workspace-1",
    projectId: "project-1",
  },
  locale: "en-US",
  roles: ["creator"],
  permissions: ["story.read"],
  traceId: "trace-1",
};

describe("GatewayAuthProvider", () => {
  it("verifies a scoped local development token", async () => {
    const provider = new GatewayAuthProvider({ mode: "local", secret });
    const token = await new SignJWT({ agent_context: context })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(context.actorId)
      .setIssuer(localJwtParameters.issuer)
      .setAudience(localJwtParameters.audience)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(secret));

    await expect(provider.authenticateToken(token)).resolves.toEqual(
      expect.objectContaining({ sub: "actor-1" })
    );
  });

  it("rejects a token whose claims try to widen the signed actor scope", async () => {
    const provider = new GatewayAuthProvider({ mode: "local", secret });
    const token = await new SignJWT({ agent_context: context })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("another-actor")
      .setIssuer(localJwtParameters.issuer)
      .setAudience(localJwtParameters.audience)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(secret));

    await expect(provider.authenticateToken(token)).rejects.toThrow(/must match the token subject/);
  });

  it("rejects a gateway token with an excessive lifetime", async () => {
    const provider = new GatewayAuthProvider({ mode: "local", secret });
    const token = await new SignJWT({ agent_context: context })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(context.actorId)
      .setIssuer(localJwtParameters.issuer)
      .setAudience(localJwtParameters.audience)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(secret));

    await expect(provider.authenticateToken(token)).rejects.toThrow(/lifetime exceeds 900 seconds/);
  });

  it("authorizes only the private product execution and history routes", () => {
    const provider = new GatewayAuthProvider({ mode: "local", secret });
    const claims = {
      sub: context.actorId,
      agent_context: context,
      iat: 1,
      exp: 2,
    } as GatewayClaims;

    expect(
      provider.authorizeUser(
        claims,
        new Request("http://agent.local/api/v1/invocations", { method: "POST" })
      )
    ).toBe(true);
    expect(
      provider.authorizeUser(
        claims,
        new Request("http://agent.local/api/v1/cancellations", { method: "POST" })
      )
    ).toBe(true);
    expect(
      provider.authorizeUser(
        claims,
        new Request("http://agent.local/api/v1/history", { method: "POST" })
      )
    ).toBe(true);
    expect(
      provider.authorizeUser(
        claims,
        new Request("http://agent.local/api/v1/history", { method: "GET" })
      )
    ).toBe(false);
    expect(
      provider.authorizeUser(
        claims,
        new Request("http://agent.local/__mastra/agents", { method: "GET" })
      )
    ).toBe(false);
  });
});
