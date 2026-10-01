import { z } from "zod";
import { api } from "@/lib/api-client";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import { generationSession } from "./jobs-api";
import { loadProjectSkills, skillInstallation } from "./project-skills";
import type { GenerationProject } from "./projects-api";
const id = z.string().uuid();
export const skillScopes = [
  "agent_prompt",
  "prompt_authoring",
  "image_generation",
  "video_generation",
  "preflight",
  "qa",
] as const;
export type SkillScope = (typeof skillScopes)[number];
const catalogSchema = z.object({
  ownerKind: z.enum(["platform", "story"]),
  projectId: id,
  projectRevision: z.number().int().nonnegative(),
  canManage: z.boolean(),
  items: z.array(
    z.object({
      id,
      name: z.string(),
      description: z.string(),
      publisherName: z.string(),
      kind: z.enum(["general", "image", "video"]),
      latestVersion: z
        .object({
          id,
          version: z.string(),
          capabilities: z.array(z.string()),
          projectKinds: z.array(z.string()),
          workbenchModes: z.array(z.string()),
        })
        .nullable(),
      installation: skillInstallation.nullable(),
    })
  ),
});
export type SkillCatalog = z.infer<typeof catalogSchema>;
export async function loadSkillCatalog(
  project: GenerationProject,
  generation: number,
  signal: AbortSignal
) {
  generationSession(generation, signal);
  const [raw, installed] = await Promise.all([
    api.get("/skills", {
      service: "aurora",
      signal,
      retry: false,
      params: { ownerKind: project.kind, projectId: project.id },
    }),
    loadProjectSkills(project, generation, signal),
  ]);
  const data = catalogSchema.parse(raw);
  generationSession(generation, signal);
  if (
    data.ownerKind !== project.kind ||
    data.projectId !== project.id ||
    new Set(data.items.map((i) => i.id)).size !== data.items.length
  )
    throw new Error("Skill catalog project mismatch.");
  if (data.projectRevision !== installed.projectRevision)
    throw new Error("Project Skills changed while loading. Refresh and try again.");
  // Catalog hides unpublished/private entries; installed state is authoritative.
  const bySkill = new Map(
    installed.installations.map((installation) => {
      if (!installation.skillId) throw new Error("Installed Skill identity is missing.");
      return [installation.skillId, installation] as const;
    })
  );
  if (bySkill.size !== installed.installations.length)
    throw new Error("Duplicate installed Skills.");
  for (const item of data.items) item.installation = bySkill.get(item.id) ?? null;
  for (const [skillId, installation] of bySkill) {
    if (!data.items.some((item) => item.id === skillId))
      data.items.push({
        id: skillId,
        name: installation.name ?? installation.slug ?? skillId,
        description: "",
        publisherName: "",
        kind: "general",
        latestVersion: null,
        installation,
      });
  }
  return data;
}
const base = z.object({
  clientKey: id,
  ownerKind: z.enum(["platform", "story"]),
  projectId: id,
  workspaceId: id,
  expectedProjectRevision: z.number().int().nonnegative(),
});
export const skillMutation = z.discriminatedUnion("kind", [
  base.extend({ kind: z.literal("install"), skillId: id, versionId: id }),
  base.extend({
    kind: z.literal("remove"),
    installationId: id,
    expectedRevision: z.number().int().nonnegative(),
  }),
  base.extend({
    kind: z.literal("defaults"),
    scope: z.enum(skillScopes),
    installationIds: z.array(id).max(32),
  }),
]);
export type SkillMutation = z.infer<typeof skillMutation>;
export function skillMutationBox(user: string, generation: number, project: GenerationProject) {
  return pendingRequest(
    skillMutation,
    generation,
    durableRecord(
      "ai-lab-skill-mutation",
      user,
      `${project.workspaceId}:${project.kind}:${project.id}`
    )
  );
}
export async function writeSkillMutation(
  command: SkillMutation,
  user: string,
  generation: number,
  project: GenerationProject,
  signal: AbortSignal
) {
  generationSession(generation, signal);
  const intent = skillMutation.parse(command);
  if (
    intent.projectId !== project.id ||
    intent.ownerKind !== project.kind ||
    intent.workspaceId !== project.workspaceId
  )
    throw new Error("Skill change project mismatch.");
  const fresh = await loadSkillCatalog(project, generation, signal);
  if (!fresh.canManage) throw new Error("You cannot manage Skills in this project.");
  const box = skillMutationBox(user, generation, project);
  // Preserve the original revision/key on recovery; server receipts precede revision checks.
  const existing = box.read();
  if (!existing && fresh.projectRevision !== intent.expectedProjectRevision)
    throw new Error("Project Skills changed. Refresh and review the change again.");
  box.save(intent);
  const path = `/project-skills/${intent.ownerKind}/${intent.projectId}`;
  const shared = {
    idempotencyKey: intent.clientKey,
    expectedProjectRevision: intent.expectedProjectRevision,
  };
  let value: unknown;
  if (intent.kind === "install") {
    value = await api.post(`${path}/installations`, {
      service: "aurora",
      signal,
      retry: false,
      data: { ...shared, skillId: intent.skillId, versionId: intent.versionId },
    });
    const receipt = z
      .object({
        projectRevision: z.number().int(),
        installation: skillInstallation.extend({ skillId: id }),
      })
      .parse(value);
    if (
      receipt.installation.skillId !== intent.skillId ||
      receipt.installation.pinnedVersionId !== intent.versionId
    )
      throw new Error("Skill installation receipt mismatch.");
  } else if (intent.kind === "remove") {
    value = await api.delete(`${path}/installations/${intent.installationId}`, {
      service: "aurora",
      signal,
      retry: false,
      data: { ...shared, expectedRevision: intent.expectedRevision },
    });
    const receipt = z
      .object({
        projectRevision: z.number().int(),
        installationId: id,
        uninstalled: z.literal(true),
      })
      .parse(value);
    if (receipt.installationId !== intent.installationId)
      throw new Error("Skill removal receipt mismatch.");
  } else {
    value = await api.put(`${path}/defaults/${intent.scope}`, {
      service: "aurora",
      signal,
      retry: false,
      data: { ...shared, installationIds: intent.installationIds },
    });
    const receipt = z
      .object({ projectRevision: z.number().int(), installationIds: z.array(id) })
      .parse(value);
    if (
      JSON.stringify([...receipt.installationIds].sort()) !==
      JSON.stringify([...intent.installationIds].sort())
    )
      throw new Error("Skill defaults receipt mismatch.");
  }
  generationSession(generation, signal);
  box.clear(intent.clientKey);
}
