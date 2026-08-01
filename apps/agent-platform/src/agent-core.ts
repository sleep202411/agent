import type { Mastra } from "@mastra/core/mastra";

import { createFizzDragonAgent } from "./agents/fizzdragon-agent.js";
import { createLongDocumentAnalystAgent } from "./agents/long-document-analyst.js";
import { loadAgentCoreConfig, type AgentCoreConfig } from "./config/env.js";
import { createAgentInfrastructure } from "./core-platform.js";
import {
  assertGoogleVertexAuthenticationReady,
  createGoogleVertexModels,
} from "./models/google-vertex.js";
import { createInferenceModelRouter } from "./models/inference-policy.js";

export function createAgentCoreComponents(config: AgentCoreConfig = loadAgentCoreConfig()) {
  const models = createGoogleVertexModels(config.inference);
  const infrastructure = createAgentInfrastructure(config, {
    observerModel: models.observer,
  });
  const fizzDragonAgent = createFizzDragonAgent(
    createInferenceModelRouter(models),
    infrastructure.agentMemory.memory,
    infrastructure.domainGateway
  );
  // Mapping a bounded section is extraction, and the interactive tier produces
  // the same findings for it measurably faster; only the reduce/finalize
  // synthesis, which merges checkpoints it can no longer re-read, needs the
  // reasoning tier.
  const longDocumentAnalyst = createLongDocumentAnalystAgent({
    extraction: models.interactive,
    synthesis: models.reasoning,
  });
  const coreMastraOptions: ConstructorParameters<typeof Mastra>[0] = {
    ...infrastructure.infrastructureMastraOptions,
    agents: { fizzDragonAgent },
  };

  return Object.freeze({
    config,
    coreMastraOptions,
    agent: fizzDragonAgent,
    longDocumentAnalyst,
    agentMemory: infrastructure.agentMemory,
    observability: infrastructure.observability,
    domainGateway: infrastructure.domainGateway,
    assertReady: async () => {
      await assertGoogleVertexAuthenticationReady(config.inference);
      await Promise.all([
        infrastructure.agentMemory.assertReady(),
        infrastructure.domainGateway.assertReady(),
      ]);
    },
  });
}

export type AgentCoreComponents = ReturnType<typeof createAgentCoreComponents>;
