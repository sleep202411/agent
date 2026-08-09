import { requireModeDefinition, type AgentProjectKind } from "@repo/agent-capabilities";

import { getSkill, listSkills } from "./registry.js";
import type { AgentSkillDefinition, SkillMountContext, SkillMountResult } from "./types.js";

/**
 * Resolve the skills mounted for one agent turn.
 *
 * Order (later overrides earlier in the composed prompt):
 * 1. alwaysOn system skills (global + context-matching)
 * 2. projectDefaultSkillIds (when registered & allowed in this context)
 * 3. turnSkillIds (when registered & allowed in this context)
 *
 * This is the final mount contract — install UI is separate; ids already work
 * once skills are registered.
 */
export function resolveSkillMounts(context: SkillMountContext): SkillMountResult {
  if (typeof context.workbenchMode !== "string" || !context.workbenchMode.trim()) {
    throw new Error(
      "resolveSkillMounts requires workbenchMode: it selects the tools this turn may call."
    );
  }
  const workbenchMode = context.workbenchMode.trim();
  requireModeDefinition(context.projectKind, workbenchMode);
  const selected: AgentSkillDefinition[] = [];
  const seen = new Set<string>();
  const skipped: string[] = [];

  const push = (skill: AgentSkillDefinition | undefined, idForSkip?: string) => {
    if (!skill) {
      if (idForSkip) skipped.push(idForSkip);
      return;
    }
    if (seen.has(skill.id)) return;
    if (!skillAllowedInContext(skill, context.projectKind, workbenchMode)) {
      if (idForSkip) skipped.push(idForSkip);
      return;
    }
    seen.add(skill.id);
    selected.push(skill);
  };

  // 1) System always-on (core + project/workbench base)
  const alwaysOn = listSkills()
    .filter((s) => s.alwaysOn && s.source === "system")
    .sort((a, b) => a.priority - b.priority);
  for (const skill of alwaysOn) {
    push(skill);
  }

  // 2) Project defaults
  for (const id of context.projectDefaultSkillIds ?? []) {
    push(getSkill(id), id);
  }

  // 3) Turn selection
  for (const id of context.turnSkillIds ?? []) {
    push(getSkill(id), id);
  }

  selected.sort((a, b) => a.priority - b.priority);

  const toolIdSet = new Set<string>();
  for (const skill of selected) {
    for (const toolId of skill.toolIds) toolIdSet.add(toolId);
  }

  const instructions = selected
    .map((s) => s.instructions.trim())
    .filter(Boolean)
    .join("\n\n");

  return {
    skills: selected,
    toolIds: [...toolIdSet],
    instructions,
    skippedSkillIds: skipped,
  };
}

function skillAllowedInContext(
  skill: AgentSkillDefinition,
  projectKind: AgentProjectKind,
  workbenchMode: string
): boolean {
  const projectAllowed =
    skill.projectKinds.length === 0 || skill.projectKinds.includes(projectKind);
  const modeAllowed =
    skill.workbenchModes.length === 0 || skill.workbenchModes.includes(workbenchMode);
  return projectAllowed && modeAllowed;
}
