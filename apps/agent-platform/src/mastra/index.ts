import { Mastra } from "@mastra/core/mastra";

import { createAgentPlatformComponents } from "../platform.js";

const components = createAgentPlatformComponents();

// Keep this direct construction in the Mastra entrypoint: the CLI statically
// analyzes this export when producing the self-hosted server artifact.
export const mastra = new Mastra(components.mastraOptions);
export const agentPlatform = Object.freeze({
  ...components,
  mastra,
});
