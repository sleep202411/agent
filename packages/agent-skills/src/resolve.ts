import { getSkill, listSkills } from "./registry.js";
import type { AgentSkillDefinition, SkillMountContext, SkillMountResult } from "./types.js";

/**
 * Resolve the skills mounted for one agent turn.
 *
 * Order (later overrides earlier in the composed prompt):
 * 1. alwaysOn system skills (global + surface-matching)
 * 2. projectDefaultSkillIds (when registered & allowed on surface)
 * 3. turnSkillIds (when registered & allowed on surface)
 *
 * This is the final mount contract — install UI is separate; ids already work
 * once skills are registered.
 */
export function resolveSkillMounts(context: SkillMountContext): SkillMountResult {
  // The surface decides which tools mount at all, so a missing one is a caller
  // bug worth naming — not a TypeError from deep inside the resolver.
  if (typeof context.surface !== "string" || !context.surface.trim()) {
    throw new Error(
      "resolveSkillMounts requires a surface: it selects the tools this turn may call."
    );
  }
  const surface = context.surface.trim();
  const selected: AgentSkillDefinition[] = [];
  const seen = new Set<string>();
  const skipped: string[] = [];

  const push = (skill: AgentSkillDefinition | undefined, idForSkip?: string) => {
    if (!skill) {
      if (idForSkip) skipped.push(idForSkip);
      return;
    }
    if (seen.has(skill.id)) return;
    if (!skillAllowedOnSurface(skill, surface)) {
      if (idForSkip) skipped.push(idForSkip);
      return;
    }
    seen.add(skill.id);
    selected.push(skill);
  };

  // 1) System always-on (core + surface base)
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

function skillAllowedOnSurface(skill: AgentSkillDefinition, surface: string): boolean {
  if (skill.surfaces.length === 0) return true;
  return skill.surfaces.includes(surface);
}
