/**
 * Installed project Skills for the FizzAgent composer (H5 `project-skills-api`).
 * Paths omit `/aurora`; `api` resolves the aurora base URL.
 */

import { api } from "@/lib/api-client";

const AURORA = { service: "aurora" as const };

export type ProjectSkillOwnerKind = "platform" | "story";
export type ProjectSkillScope =
  | "agent_prompt"
  | "prompt_authoring"
  | "image_generation"
  | "video_generation"
  | "preflight"
  | "qa";

export type ProjectSkillInstallation = {
  id: string;
  skillId: string;
  slug?: string;
  name?: string;
  translationKey?: string;
  status: "active" | "disabled";
  version: {
    id: string;
    version: string;
    capabilities: ProjectSkillScope[];
    workbenchModes: string[];
  };
  defaults: {
    scope: ProjectSkillScope;
    workbenchMode: string | null;
    sourceSurface: string | null;
  }[];
};

export type ProjectSkillInstallationsResponse = {
  ownerKind: ProjectSkillOwnerKind;
  projectId: string;
  projectRevision: number;
  canManage: boolean;
  installations: ProjectSkillInstallation[];
};

export function listProjectSkillInstallations(
  ownerKind: ProjectSkillOwnerKind,
  projectId: string,
  signal?: AbortSignal
) {
  return api.get<ProjectSkillInstallationsResponse>(
    `/project-skills/${ownerKind}/${encodeURIComponent(projectId)}/installations`,
    { ...AURORA, signal, timeout: 20_000 }
  );
}
