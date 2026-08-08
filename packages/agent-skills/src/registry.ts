import { BUILTIN_SKILLS } from "./builtin.js";
import { AgentSkillDefinitionSchema, type AgentSkillDefinition } from "./types.js";

/**
 * Process-wide skill registry.
 * Built-ins are always registered. Future install path: registerSkill(catalogSkill).
 */
const byId = new Map<string, AgentSkillDefinition>();

function seedBuiltins(): void {
  for (const raw of BUILTIN_SKILLS) {
    const skill = AgentSkillDefinitionSchema.parse(raw);
    byId.set(skill.id, skill);
  }
}

seedBuiltins();

export function listSkills(): readonly AgentSkillDefinition[] {
  return [...byId.values()];
}

export function getSkill(skillId: string): AgentSkillDefinition | undefined {
  return byId.get(skillId);
}

export function requireSkill(skillId: string): AgentSkillDefinition {
  const skill = byId.get(skillId);
  if (!skill) {
    throw new Error(`Unknown agent skill: ${skillId}`);
  }
  return skill;
}

/**
 * Register or replace a skill (catalog install / tests).
 * System non-removable skills cannot be overwritten by catalog ids that collide
 * unless force is true (tests only).
 */
export function registerSkill(
  raw: AgentSkillDefinition,
  opts?: { force?: boolean }
): AgentSkillDefinition {
  const skill = AgentSkillDefinitionSchema.parse(raw);
  const existing = byId.get(skill.id);
  if (existing && !existing.removable && !opts?.force) {
    throw new Error(`Cannot replace non-removable system skill: ${skill.id}`);
  }
  byId.set(skill.id, skill);
  return skill;
}

export function unregisterSkill(skillId: string): boolean {
  const existing = byId.get(skillId);
  if (!existing) return false;
  if (!existing.removable) {
    throw new Error(`Cannot unregister non-removable system skill: ${skillId}`);
  }
  return byId.delete(skillId);
}

/** Test helper — restore built-ins only. */
export function resetSkillRegistryForTests(): void {
  byId.clear();
  seedBuiltins();
}
