import { describe, expect, it } from "vitest";
import { RequestContext } from "@mastra/core/request-context";
import { InMemoryStore } from "@mastra/core/storage";
import { Memory } from "@mastra/memory";

import { createAgentRequestContext, type AgentSessionContext } from "../context/agent-context.js";
import type { AgentRuntimeDomainGateway } from "../domain/domain-gateway.js";
import { createGoogleVertexModels } from "../models/google-vertex.js";
import { createFizzDragonAgent } from "./fizzdragon-agent.js";

const model = createGoogleVertexModels({
  provider: "google-vertex",
  project: "glass-proxy-501907-d2",
  location: "global",
  interactiveModelId: "gemini-2.5-flash",
  reasoningModelId: "gemini-2.5-pro",
  observerModelId: "gemini-2.5-flash",
}).interactive;
const memory = new Memory({
  storage: new InMemoryStore({ id: "fizzdragon-agent-test-memory" }),
});
const domainGateway = {
  execute: async () => ({ status: "succeeded" as const, data: {} }),
  resolveAttachments: async () => [],
  reportInvocationLifecycle: async () => undefined,
  assertReady: async () => undefined,
} satisfies AgentRuntimeDomainGateway;

function context(
  surface: AgentSessionContext["surface"],
  permissions: string[]
): AgentSessionContext {
  const common = {
    actorId: "actor-1" as const,
    actorDisplayName: "Actor One",
    conversationId: "0197f4a2-0800-7000-8000-000000000004",
    sessionName: "agent:v1:conversation:0197f4a2-0800-7000-8000-000000000004",
    permissionMode: "smart" as const,
    locale: "en-US",
    roles: ["creator"],
    permissions,
    traceId: "trace-1",
  };
  return surface === "story-studio"
    ? {
        ...common,
        surface,
        scope: {
          kind: "story-project",
          workspaceId: "workspace-1",
          projectId: "project-1",
        },
      }
    : {
        ...common,
        surface,
        scope: {
          kind: "crew",
          crewId: "crew-1",
        },
      };
}

function publicMastraContext(value: AgentSessionContext): RequestContext {
  return new RequestContext(Object.entries(createAgentRequestContext(value).toJSON()));
}

describe("FizzDragon agent composition", () => {
  it("mounts the Story Studio capability pack into the real Mastra agent", async () => {
    const agent = createFizzDragonAgent(model, memory, domainGateway);
    const requestContext = publicMastraContext(
      context("story-studio", ["story.read", "story.write", "crew.manage"])
    );

    const tools = await agent.listTools({ requestContext });
    const instructions = await agent.getInstructions({ requestContext });
    const processors = await agent.listConfiguredInputProcessors(requestContext);

    expect(Object.keys(tools)).toEqual([
      "story_get_source_analysis",
      "story_query_source_material",
      "story_get_snapshot",
      "story_apply_change_set",
    ]);
    expect(String(instructions)).toContain("FizzDragon Story Studio");
    expect(String(instructions)).toContain("Story Studio core operating contract");
    await expect(agent.getSkill("story-studio-core", { requestContext })).resolves.toMatchObject({
      name: "story-studio-core",
    });
    expect(processors.map((processor) => processor.id)).toEqual([
      "agent-attachment-resolver",
      "token-limiter",
    ]);
    expect(Object.keys(tools)).not.toContain("crew_apply_command");
  });

  it("constructs a different capability surface from signed context", async () => {
    const agent = createFizzDragonAgent(model, memory, domainGateway);
    const requestContext = publicMastraContext(
      context("crew-management", ["crew.read", "crew.manage", "story.write"])
    );

    const tools = await agent.listTools({ requestContext });
    const instructions = await agent.getInstructions({ requestContext });

    expect(Object.keys(tools)).toEqual([
      "crew_get_state",
      "crew_apply_management_command",
      "crew_submit_own_assignment",
    ]);
    expect(String(instructions)).toContain("FizzDragon Crew Management");
    await expect(agent.getSkill("story-studio-core", { requestContext })).resolves.toBeNull();
    expect(Object.keys(tools)).not.toContain("story_apply_change_set");
  });
});
