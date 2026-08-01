import { Mastra } from "@mastra/core/mastra";

import type { LongDocumentAnalyst } from "../agents/long-document-analyst.js";
import { createAgentCoreComponents } from "../agent-core.js";
import type { AgentCoreConfig } from "../config/env.js";
import { closeAgentAblyClientPool } from "./ably-session.js";

export type RuntimeDependencies = Readonly<{
  config: ReturnType<typeof createAgentCoreComponents>["config"];
  agent: ReturnType<typeof createAgentCoreComponents>["agent"];
  longDocumentAnalyst: LongDocumentAnalyst;
  agentMemory: ReturnType<typeof createAgentCoreComponents>["agentMemory"];
  mastra: Mastra;
  domainGateway: ReturnType<typeof createAgentCoreComponents>["domainGateway"];
  assertReady: ReturnType<typeof createAgentCoreComponents>["assertReady"];
}>;

let dependencies: RuntimeDependencies | undefined;

export function getRuntimeDependencies(): RuntimeDependencies {
  dependencies ??= createRuntimeDependencies();
  return dependencies;
}

export function initializeRuntimeDependencies(config: AgentCoreConfig): RuntimeDependencies {
  if (dependencies) {
    throw new Error("Agent runtime dependencies are already initialized");
  }
  dependencies = createRuntimeDependencies(config);
  return dependencies;
}

export function createRuntimeDependencies(config?: AgentCoreConfig): RuntimeDependencies {
  const components = createAgentCoreComponents(config);
  const mastra = new Mastra(components.coreMastraOptions);
  return Object.freeze({
    config: components.config,
    agent: components.agent,
    longDocumentAnalyst: components.longDocumentAnalyst,
    agentMemory: components.agentMemory,
    mastra,
    domainGateway: components.domainGateway,
    assertReady: components.assertReady,
  });
}

export async function closeRuntimeDependencies(): Promise<void> {
  const current = dependencies;
  dependencies = undefined;
  try {
    await current?.agentMemory.close();
  } finally {
    closeAgentAblyClientPool();
  }
}
