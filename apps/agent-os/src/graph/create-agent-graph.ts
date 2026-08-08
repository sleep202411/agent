import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { MemorySaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { resolveSkillMounts, type SkillMountContext } from "@repo/agent-skills";
import type { AgentOsSurface } from "@repo/shared";

import { buildLangChainTools, type ToolRuntimeContext } from "./build-langchain-tools.js";

export function createAgentOsGraph(input: {
  model: BaseChatModel;
  runtime: ToolRuntimeContext;
  surface: AgentOsSurface;
  /** Project default skill ids (admin). Same runtime path as future catalog skills. */
  projectDefaultSkillIds?: readonly string[];
  /** Per-turn skill ids from composer. Same runtime path as future catalog skills. */
  turnSkillIds?: readonly string[];
  checkpointer?: BaseCheckpointSaver;
}) {
  const mountContext: SkillMountContext = {
    surface: input.surface,
    projectDefaultSkillIds: input.projectDefaultSkillIds,
    turnSkillIds: input.turnSkillIds,
  };
  const mount = resolveSkillMounts(mountContext);
  const tools = buildLangChainTools(input.runtime, mount.toolIds);
  return createReactAgent({
    llm: input.model,
    tools,
    checkpointSaver: input.checkpointer ?? new MemorySaver(),
    prompt: mount.instructions,
  });
}

export type AgentOsGraph = ReturnType<typeof createAgentOsGraph>;
