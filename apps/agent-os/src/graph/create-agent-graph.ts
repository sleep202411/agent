import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { MemorySaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import type { AgentProjectKind } from "@repo/agent-capabilities";
import { resolveSkillMounts, type SkillMountContext } from "@repo/agent-skills";

import { buildLangChainTools, type ToolRuntimeContext } from "./build-langchain-tools.js";

export function createAgentOsGraph(input: {
  model: BaseChatModel;
  runtime: ToolRuntimeContext;
  projectKind: AgentProjectKind;
  workbenchMode: string;
  /** Project default skill ids (admin). Same runtime path as future catalog skills. */
  projectDefaultSkillIds?: readonly string[];
  /** Per-turn skill ids from composer. Same runtime path as future catalog skills. */
  turnSkillIds?: readonly string[];
  checkpointer?: BaseCheckpointSaver;
}) {
  const mountContext: SkillMountContext = {
    projectKind: input.projectKind,
    workbenchMode: input.workbenchMode,
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
