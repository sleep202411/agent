import { listSkills } from "./registry.js";
import type { AgentSkillDefinition } from "./types.js";

/** Safe metadata for Studio / Nest — never ships full instructions by default. */
export interface AgentSkillPublicMeta {
  id: string;
  name: string;
  description: string;
  source: AgentSkillDefinition["source"];
  alwaysOn: boolean;
  userInvocable: boolean;
  removable: boolean;
  surfaces: readonly string[];
  priority: number;
}

export function toSkillPublicMeta(skill: AgentSkillDefinition): AgentSkillPublicMeta {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    source: skill.source,
    alwaysOn: skill.alwaysOn,
    userInvocable: skill.userInvocable,
    removable: skill.removable,
    surfaces: skill.surfaces,
    priority: skill.priority,
  };
}

/**
 * Skills the user may pick for project default or per-turn selection.
 * alwaysOn surface base skills are implicit and not listed.
 */
export function listInvocableSkills(surface?: string): AgentSkillPublicMeta[] {
  return listSkills()
    .filter((s) => s.userInvocable)
    .filter((s) => !surface || s.surfaces.length === 0 || s.surfaces.includes(surface))
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .map(toSkillPublicMeta);
}
