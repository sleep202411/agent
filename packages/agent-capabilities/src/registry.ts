import { getTool } from "@repo/agent-tools";

import { PLATFORM_PROJECT_KIND } from "./platform/index.js";
import { STORY_PROJECT_KIND } from "./story/index.js";
import {
  UnknownAgentProjectKindError,
  UnsupportedAgentModeError,
  type AgentModeDefinition,
  type AgentProjectKind,
  type AgentProjectKindDefinition,
} from "./types.js";

const PROJECT_KIND_DEFINITIONS = [PLATFORM_PROJECT_KIND, STORY_PROJECT_KIND] as const;

const projectKinds = new Map<string, AgentProjectKindDefinition>();
const modes = new Map<string, AgentModeDefinition>();

for (const definition of PROJECT_KIND_DEFINITIONS) {
  if (projectKinds.has(definition.projectKind)) {
    throw new Error(`Duplicate Agent OS project kind: ${definition.projectKind}`);
  }
  projectKinds.set(definition.projectKind, definition);

  for (const mode of definition.modes) {
    if (mode.projectKind !== definition.projectKind) {
      throw new Error(
        `Agent OS mode ${mode.mode} declares ${mode.projectKind} inside ${definition.projectKind}`
      );
    }
    const key = modeKey(mode.projectKind, mode.mode);
    if (modes.has(key)) {
      throw new Error(`Duplicate Agent OS project-kind/mode pair: ${key}`);
    }
    for (const toolId of mode.toolIds) getTool(toolId);
    modes.set(key, mode);
  }
}

export function listProjectKindDefinitions(): readonly AgentProjectKindDefinition[] {
  return [...projectKinds.values()];
}

export function requireProjectKindDefinition(projectKind: string): AgentProjectKindDefinition {
  const definition = projectKinds.get(projectKind);
  if (!definition) throw new UnknownAgentProjectKindError(projectKind);
  return definition;
}

export function listModeDefinitions(projectKind: AgentProjectKind): readonly AgentModeDefinition[] {
  return requireProjectKindDefinition(projectKind).modes;
}

export function getModeDefinition(
  projectKind: AgentProjectKind,
  mode: string
): AgentModeDefinition | undefined {
  return modes.get(modeKey(projectKind, mode));
}

export function requireModeDefinition(
  projectKind: AgentProjectKind,
  mode: string
): AgentModeDefinition {
  const definition = getModeDefinition(projectKind, mode);
  if (!definition) throw new UnsupportedAgentModeError(projectKind, mode);
  return definition;
}

export function isModeAvailable(projectKind: AgentProjectKind, mode: string): boolean {
  return modes.has(modeKey(projectKind, mode));
}

function modeKey(projectKind: string, mode: string): string {
  return `${projectKind}:${mode}`;
}
