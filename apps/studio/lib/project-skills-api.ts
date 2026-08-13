import { api } from "@/lib/api";

export type ProjectSkillOwnerKind = "platform" | "story";
export type ProjectSkillKind = "general" | "image" | "video";
export type ProjectSkillOwnershipScope = "community" | "workspace" | "project";
export type ProjectSkillScope =
  | "agent_prompt"
  | "prompt_authoring"
  | "image_generation"
  | "video_generation"
  | "preflight"
  | "qa";

export interface ProjectSkillVersionSummary {
  id: string;
  version: string;
  checksum: string;
  capabilities: ProjectSkillScope[];
  projectKinds: ProjectSkillOwnerKind[];
  workbenchModes: string[];
}

export interface ProjectSkillInstallation {
  id: string;
  skillId: string;
  slug?: string;
  name?: string;
  previewUrl?: string | null;
  previewVideoUrl?: string | null;
  translationKey?: string;
  pinnedVersionId: string;
  version: ProjectSkillVersionSummary;
  status: "active" | "disabled";
  revision: number;
  config: Record<string, unknown>;
  defaults: Array<{
    scope: ProjectSkillScope;
    workbenchMode: string | null;
    sourceSurface: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSkillCatalogItem {
  id: string;
  slug: string;
  name: string;
  description: string;
  localizedMetadata: unknown;
  publisherName: string;
  category: string;
  kind: ProjectSkillKind;
  visibility: "public" | "unlisted" | "private";
  ownershipScope: ProjectSkillOwnershipScope;
  previewUrl: string | null;
  previewVideoUrl: string | null;
  latestVersion: ProjectSkillVersionSummary | null;
  installation: ProjectSkillInstallation | null;
}

export interface ProjectSkillCatalogResponse {
  ownerKind: ProjectSkillOwnerKind;
  projectId: string;
  projectRevision: number;
  canManage: boolean;
  canManageWorkspace: boolean;
  items: ProjectSkillCatalogItem[];
}

export function importProjectSkill(input: {
  ownerKind: ProjectSkillOwnerKind;
  projectId: string;
  file: File;
  scope: "project" | "workspace";
  kind: ProjectSkillKind;
  expectedProjectRevision: number;
}) {
  const formData = new FormData();
  formData.set("file", input.file, input.file.name);
  formData.set("scope", input.scope);
  formData.set("kind", input.kind);
  formData.set("expectedProjectRevision", String(input.expectedProjectRevision));
  formData.set("idempotencyKey", crypto.randomUUID());
  return api.post<{
    projectRevision: number;
    skill: ProjectSkillCatalogItem;
    installation: ProjectSkillInstallation;
  }>(`${projectSkillsOwnerPath(input.ownerKind, input.projectId)}/catalog/import`, {
    data: formData,
    timeout: 45_000,
  });
}

export interface ProjectSkillInstallationsResponse {
  ownerKind: ProjectSkillOwnerKind;
  projectId: string;
  projectRevision: number;
  canManage: boolean;
  installations: ProjectSkillInstallation[];
}

export interface ProjectSkillSelection {
  includeInstallationIds?: string[];
  excludeInstallationIds?: string[];
}

export function projectSkillsOwnerPath(
  ownerKind: ProjectSkillOwnerKind,
  projectId: string
): string {
  return `/aurora/project-skills/${ownerKind}/${encodeURIComponent(projectId)}`;
}

export function listProjectSkillCatalog(input: {
  ownerKind: ProjectSkillOwnerKind;
  projectId: string;
  kind?: ProjectSkillKind;
  capability?: ProjectSkillScope;
  query?: string;
}): Promise<ProjectSkillCatalogResponse> {
  return api.get<ProjectSkillCatalogResponse>("/aurora/skills", {
    params: {
      ownerKind: input.ownerKind,
      projectId: input.projectId,
      kind: input.kind,
      capability: input.capability,
      q: input.query,
    },
  });
}

export function listProjectSkillInstallations(
  ownerKind: ProjectSkillOwnerKind,
  projectId: string
): Promise<ProjectSkillInstallationsResponse> {
  return api.get<ProjectSkillInstallationsResponse>(
    `${projectSkillsOwnerPath(ownerKind, projectId)}/installations`
  );
}

export function installProjectSkill(input: {
  ownerKind: ProjectSkillOwnerKind;
  projectId: string;
  skillId: string;
  expectedProjectRevision: number;
  defaultScopes?: ProjectSkillScope[];
}) {
  return api.post<{ projectRevision: number; installation: ProjectSkillInstallation }>(
    `${projectSkillsOwnerPath(input.ownerKind, input.projectId)}/installations`,
    {
      data: {
        skillId: input.skillId,
        expectedProjectRevision: input.expectedProjectRevision,
        defaultScopes: input.defaultScopes,
        idempotencyKey: crypto.randomUUID(),
      },
    }
  );
}

export function uninstallProjectSkill(input: {
  ownerKind: ProjectSkillOwnerKind;
  projectId: string;
  installation: ProjectSkillInstallation;
  expectedProjectRevision: number;
}) {
  return api.delete<{ projectRevision: number; installationId: string; uninstalled: true }>(
    `${projectSkillsOwnerPath(input.ownerKind, input.projectId)}/installations/${encodeURIComponent(input.installation.id)}`,
    {
      data: {
        expectedRevision: input.installation.revision,
        expectedProjectRevision: input.expectedProjectRevision,
        idempotencyKey: crypto.randomUUID(),
      },
    }
  );
}

export function setProjectSkillDefaults(input: {
  ownerKind: ProjectSkillOwnerKind;
  projectId: string;
  scope: ProjectSkillScope;
  installationIds: string[];
  expectedProjectRevision: number;
}) {
  return api.put<{ projectRevision: number; installationIds: string[] }>(
    `${projectSkillsOwnerPath(input.ownerKind, input.projectId)}/defaults/${input.scope}`,
    {
      data: {
        installationIds: input.installationIds,
        expectedProjectRevision: input.expectedProjectRevision,
        idempotencyKey: crypto.randomUUID(),
      },
    }
  );
}
