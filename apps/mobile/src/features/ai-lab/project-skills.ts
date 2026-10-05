import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import type { GenerationProject } from "./projects-api";

export const skillSelection = z
  .object({
    includeInstallationIds: z.array(z.string().uuid()).max(32).optional(),
    excludeInstallationIds: z.array(z.string().uuid()).max(32).optional(),
  })
  .refine((v) => {
    const included = v.includeInstallationIds ?? [],
      excluded = v.excludeInstallationIds ?? [];
    return new Set([...included, ...excluded]).size === included.length + excluded.length;
  }, "Skill selections must be unique and cannot be both included and excluded.");
export type SkillSelection = z.infer<typeof skillSelection>;
export const skillInstallation = z.object({
  id: z.string().uuid(),
  skillId: z.string().uuid().optional(),
  name: z.string().optional(),
  slug: z.string().optional(),
  pinnedVersionId: z.string().uuid(),
  status: z.enum(["active", "disabled"]),
  revision: z.number().int().nonnegative(),
  version: z.object({
    version: z.string(),
    checksum: z.string(),
    capabilities: z.array(z.string()),
    projectKinds: z.array(z.string()),
    workbenchModes: z.array(z.string()),
  }),
  defaults: z.array(
    z.object({
      scope: z.string(),
      workbenchMode: z.string().nullable(),
      sourceSurface: z.string().nullable(),
    })
  ),
});
const installations = z.object({
  ownerKind: z.enum(["platform", "story"]),
  projectId: z.string().uuid(),
  projectRevision: z.number().int().nonnegative(),
  installations: z.array(skillInstallation),
});
export type ProjectSkills = z.infer<typeof installations>;
export type GenerationSkillSurface = "ai-lab" | "fizzstudio-canvas";
export function skillRows(
  data: ProjectSkills,
  mode: "image" | "video" | "audio",
  selection?: SkillSelection,
  sourceSurface: GenerationSkillSurface = "ai-lab"
) {
  // The official jobs endpoint does not resolve Skills for audio generation.
  if (mode === "audio") return [];
  const scope = `${mode}_generation`;
  return data.installations
    .filter(
      (i) =>
        i.status === "active" &&
        i.version.capabilities.includes(scope) &&
        (!i.version.projectKinds.length || i.version.projectKinds.includes(data.ownerKind)) &&
        !i.version.workbenchModes.length
    )
    .map((i) => {
      const defaultEnabled = i.defaults.some(
        (d) =>
          d.scope === scope &&
          !d.workbenchMode &&
          (!d.sourceSurface || d.sourceSurface === sourceSurface)
      );
      return {
        ...i,
        defaultEnabled,
        selected:
          selection?.includeInstallationIds?.includes(i.id) === true ||
          (defaultEnabled && !selection?.excludeInstallationIds?.includes(i.id)),
      };
    });
}
export function toggleSkill(selection: SkillSelection | undefined, id: string, enabled: boolean) {
  // Explicit on/off survives a later change to project defaults; reset is separate.
  return skillSelection.parse({
    includeInstallationIds: [
      ...(selection?.includeInstallationIds ?? []).filter((v) => v !== id),
      ...(enabled ? [id] : []),
    ],
    excludeInstallationIds: [
      ...(selection?.excludeInstallationIds ?? []).filter((v) => v !== id),
      ...(!enabled ? [id] : []),
    ],
  });
}
export function unavailableSkillIds(
  data: ProjectSkills,
  mode: "image" | "video" | "audio",
  selection?: SkillSelection,
  sourceSurface: GenerationSkillSurface = "ai-lab"
) {
  if (mode === "audio")
    return [
      ...(selection?.includeInstallationIds ?? []),
      ...(selection?.excludeInstallationIds ?? []),
    ];
  const compatible = new Set(skillRows(data, mode, undefined, sourceSurface).map((i) => i.id));
  const active = new Set(data.installations.filter((i) => i.status === "active").map((i) => i.id));
  return [
    ...(selection?.includeInstallationIds ?? []).filter((id) => !compatible.has(id)),
    ...(selection?.excludeInstallationIds ?? []).filter((id) => !active.has(id)),
  ];
}
export async function loadProjectSkills(
  project: GenerationProject,
  generation: number,
  signal: AbortSignal
) {
  const assertSession = () => {
    if (signal.aborted || generation !== getAuthGeneration())
      throw new Error("Generation session expired.");
  };
  assertSession();
  const data = installations.parse(
    await api.get(`/project-skills/${project.kind}/${project.id}/installations`, {
      service: "aurora",
      signal,
      retry: false,
    })
  );
  assertSession();
  if (
    data.ownerKind !== project.kind ||
    data.projectId !== project.id ||
    new Set(data.installations.map((i) => i.id)).size !== data.installations.length
  )
    throw new Error("Project Skills do not match the selected project.");
  return data;
}
/** Compare the immutable version/default state reviewed before paid confirmation. */
export function skillSnapshot(data: ProjectSkills) {
  return JSON.stringify({
    ...data,
    installations: [...data.installations].sort((a, b) => a.id.localeCompare(b.id)),
  });
}
