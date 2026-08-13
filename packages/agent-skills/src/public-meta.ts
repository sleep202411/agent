import type { AgentProjectKind } from "@repo/agent-capabilities";

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
  projectKinds: readonly string[];
  workbenchModes: readonly string[];
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
    projectKinds: skill.projectKinds,
    workbenchModes: skill.workbenchModes,
    priority: skill.priority,
  };
}

/**
 * Skills the user may pick for project default or per-turn selection.
 * Always-on workbench base skills are implicit and not listed.
 */
export function listInvocableSkills(context?: {
  projectKind: AgentProjectKind;
  workbenchMode: string;
}): AgentSkillPublicMeta[] {
  return listSkills()
    .filter((s) => s.userInvocable)
    .filter(
      (skill) =>
        !context ||
        ((skill.projectKinds.length === 0 || skill.projectKinds.includes(context.projectKind)) &&
          (skill.workbenchModes.length === 0 ||
            skill.workbenchModes.includes(context.workbenchMode)))
    )
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
    .map(toSkillPublicMeta);
}
