import { describe, expect, it } from "vitest";

import {
  CAUSAL_ATTACHMENT_IDS_KEY,
  CAUSAL_MESSAGE_IDS_KEY,
  agentSessionContextSchema,
  createAgentRequestContext,
  gatewayClaimsSchema,
  readAgentSessionContext,
  writeAgentCausalContext,
  type AgentSessionContext,
} from "./agent-context.js";

const storyContext = (): AgentSessionContext => ({
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
  permissions: ["story.read", "story.write"],
  traceId: "trace-1",
});

describe("agent session context", () => {
  it("round-trips only trusted context through Mastra RequestContext", () => {
    expect(readAgentSessionContext(createAgentRequestContext(storyContext()))).toEqual(
      storyContext()
    );
  });

  it("carries only bounded causal identities into model processors", () => {
    const requestContext = createAgentRequestContext(storyContext());
    writeAgentCausalContext(requestContext, {
      messageIds: ["message-1", "message-1", "message-2"],
      attachmentIds: [
        "0197f4a2-0800-7000-8000-000000000009",
        "0197f4a2-0800-7000-8000-000000000009",
      ],
    });

    expect(requestContext.get(CAUSAL_MESSAGE_IDS_KEY)).toEqual(["message-1", "message-2"]);
    expect(requestContext.get(CAUSAL_ATTACHMENT_IDS_KEY)).toEqual([
      "0197f4a2-0800-7000-8000-000000000009",
    ]);
  });

  it("rejects a session outside the signed conversation identity", () => {
    expect(() =>
      agentSessionContextSchema.parse({
        ...storyContext(),
        sessionName: "agent:v1:conversation:0197f4a2-0800-7000-8000-000000000005",
      })
    ).toThrow(/signed conversation identity/);
  });

  it("requires the business scope for each surface", () => {
    expect(() =>
      agentSessionContextSchema.parse({
        ...storyContext(),
        scope: {
          kind: "story-project",
          workspaceId: "workspace-1",
        },
      })
    ).toThrow();
  });

  it("rejects a scope kind from another product surface", () => {
    expect(() =>
      agentSessionContextSchema.parse({
        ...storyContext(),
        scope: {
          kind: "crew",
          crewId: "crew-1",
        },
      })
    ).toThrow();
  });

  it("rejects token claims that do not match the signed agent context", () => {
    expect(() =>
      gatewayClaimsSchema.parse({
        sub: "another-actor",
        agent_context: storyContext(),
        iat: 1,
        exp: 2,
      })
    ).toThrow(/must match the token subject/);
  });

  it("requires a bounded token validity interval", () => {
    expect(() =>
      gatewayClaimsSchema.parse({
        sub: "actor-1",
        agent_context: storyContext(),
      })
    ).toThrow();

    expect(() =>
      gatewayClaimsSchema.parse({
        sub: "actor-1",
        agent_context: storyContext(),
        iat: 2,
        exp: 1,
      })
    ).toThrow(/expiration must be later/);
  });
});
