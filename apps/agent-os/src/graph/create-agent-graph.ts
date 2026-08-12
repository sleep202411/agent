import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { MemorySaver } from "@langchain/langgraph";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import type { AgentProjectKind } from "@repo/agent-capabilities";
import {
  resolveSkillMounts,
  type ProjectSkillResolutionSnapshot,
  type SkillMountContext,
} from "@repo/agent-skills";

import { buildLangChainTools, type ToolRuntimeContext } from "./build-langchain-tools.js";

export function createAgentOsGraph(input: {
  model: BaseChatModel;
  runtime: ToolRuntimeContext;
  projectKind: AgentProjectKind;
  workbenchMode: string;
  /** Per-turn skill ids from composer. Same runtime path as future catalog skills. */
  turnSkillIds?: readonly string[];
  /** Immutable project-installed Skills resolved and signed by Nest. */
  skillMountSnapshot?: ProjectSkillResolutionSnapshot;
  checkpointer?: BaseCheckpointSaver;
}) {
  const mount = resolveAgentOsSkillMount(input);
  const tools = buildLangChainTools(input.runtime, mount.toolIds);
  return createReactAgent({
    llm: input.model,
    tools,
    checkpointSaver: input.checkpointer ?? new MemorySaver(),
    prompt: mount.instructions,
  });
}

export function resolveAgentOsSkillMount(input: {
  projectKind: AgentProjectKind;
  workbenchMode: string;
  turnSkillIds?: readonly string[];
  skillMountSnapshot?: ProjectSkillResolutionSnapshot;
}) {
  const mountContext: SkillMountContext = {
    projectKind: input.projectKind,
    workbenchMode: input.workbenchMode,
    turnSkillIds: input.turnSkillIds,
  };
  const systemMount = resolveSkillMounts(mountContext);
  const projectSkills = input.skillMountSnapshot?.skills ?? [];
  const projectInstructions = projectSkills.map(
    (skill) =>
      `## Project Skill: ${skill.name} (${skill.slug}@${skill.version})\n${skill.instructions}`
  );
  return {
    instructions: [systemMount.instructions, ...projectInstructions].filter(Boolean).join("\n\n"),
    toolIds: [
      ...new Set([...systemMount.toolIds, ...projectSkills.flatMap((skill) => skill.toolIds)]),
    ],
    systemSkillIds: systemMount.skills.map((skill) => skill.id),
    projectSkillVersionIds: projectSkills.map((skill) => skill.versionId),
    skippedSkillIds: [...systemMount.skippedSkillIds],
  };
}

export type AgentOsGraph = ReturnType<typeof createAgentOsGraph>;
