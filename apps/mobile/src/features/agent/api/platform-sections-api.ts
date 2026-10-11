import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";
const uuid = z.string().uuid();
export const sectionTitle = z.string().trim().min(1).max(160);
const sectionSchema = z.object({
  id: uuid,
  projectId: uuid,
  title: z.string(),
  rank: z.number().int().nonnegative(),
  version: z.number().int().nonnegative(),
  canvasDocumentId: uuid,
});
const collectionSchema = z.object({
  projectVersion: z.number().int().nonnegative(),
  sections: z.array(sectionSchema).min(1),
});
export type PlatformSection = z.infer<typeof sectionSchema>;
export type PlatformSections = z.infer<typeof collectionSchema> & {
  projectId: string;
  workspaceId: string;
  canEdit: boolean;
};
const changeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("create"), title: sectionTitle }),
  z.object({ kind: z.literal("rename"), id: uuid, title: sectionTitle }),
  z.object({ kind: z.literal("archive"), id: uuid }),
  z.object({ kind: z.literal("reorder"), ids: z.array(uuid).min(1).max(500) }),
]);
export type SectionChange = z.infer<typeof changeSchema>;
function current(generation: number, signal?: AbortSignal) {
  if (generation !== getAuthGeneration() || signal?.aborted)
    throw new Error("Chapter session expired or request cancelled.");
}
function collection(raw: unknown, projectId: string) {
  const result = collectionSchema.parse(raw);
  const rows = result.sections;
  if (
    new Set(rows.map((r) => r.id)).size !== rows.length ||
    new Set(rows.map((r) => r.canvasDocumentId)).size !== rows.length ||
    rows.some((r, i) => r.projectId !== projectId || (i > 0 && rows[i - 1].rank >= r.rank))
  )
    throw new Error("Invalid project chapter collection.");
  return result;
}
export async function fetchPlatformSections(
  projectId: string,
  workspaceId: string,
  generation: number,
  signal?: AbortSignal
): Promise<PlatformSections> {
  uuid.parse(projectId);
  uuid.parse(workspaceId);
  current(generation, signal);
  const { project } = z
    .object({
      project: z.object({
        id: uuid,
        workspaceId: uuid,
        version: z.number().int().nonnegative(),
        status: z.enum(["active", "archived"]),
        role: z.enum(["owner", "admin", "editor", "viewer"]).optional(),
      }),
    })
    .parse(await api.get(`/projects/${projectId}`, { service: "aurora", signal }));
  current(generation, signal);
  if (
    project.id !== projectId ||
    project.workspaceId !== workspaceId ||
    project.status !== "active"
  )
    throw new Error("Project chapter scope mismatch.");
  const result = collection(
    await api.get(`/projects/${projectId}/sections`, { service: "aurora", signal }),
    projectId
  );
  current(generation, signal);
  if (result.projectVersion !== project.version)
    throw new Error("Project changed while loading chapters. Refresh the list.");
  return {
    ...result,
    projectId,
    workspaceId,
    canEdit: ["owner", "admin", "editor"].includes(project.role ?? ""),
  };
}
export class SectionWriteError extends Error {}
export async function changePlatformSection(
  snapshot: PlatformSections,
  change: SectionChange,
  generation: number,
  signal?: AbortSignal
): Promise<PlatformSections> {
  const input = changeSchema.parse(change);
  const reviewed = collection(snapshot, snapshot.projectId);
  const fresh = await fetchPlatformSections(
    snapshot.projectId,
    snapshot.workspaceId,
    generation,
    signal
  );
  if (!fresh.canEdit) throw new Error("Project editor permission is required.");
  if (JSON.stringify(reviewed) !== JSON.stringify(collection(fresh, fresh.projectId)))
    throw new Error("Chapters changed. Refresh before continuing.");
  const selected = "id" in input ? fresh.sections.find((s) => s.id === input.id) : undefined;
  if ("id" in input && !selected) throw new Error("Chapter no longer exists.");
  if (input.kind === "archive" && fresh.sections.length === 1)
    throw new Error("A project must keep at least one active chapter.");
  if (
    input.kind === "reorder" &&
    (new Set(input.ids).size !== fresh.sections.length ||
      input.ids.length !== fresh.sections.length ||
      input.ids.some((id) => !fresh.sections.some((s) => s.id === id)))
  )
    throw new Error("Chapter order must contain every current chapter exactly once.");
  current(generation, signal);
  const base = `/projects/${fresh.projectId}/sections`;
  try {
    let raw: unknown;
    if (input.kind === "create")
      raw = await api.post(base, {
        service: "aurora",
        data: { title: input.title, expectedProjectVersion: fresh.projectVersion },
      });
    else if (input.kind === "rename")
      raw = await api.patch(`${base}/${input.id}`, {
        service: "aurora",
        data: { title: input.title, expectedVersion: selected!.version },
      });
    else if (input.kind === "archive")
      raw = await api.post(`${base}/${input.id}/archive`, {
        service: "aurora",
        data: {
          expectedProjectVersion: fresh.projectVersion,
          expectedSectionVersion: selected!.version,
        },
      });
    else
      raw = await api.put(`${base}/order`, {
        service: "aurora",
        data: { sectionIds: input.ids, expectedProjectVersion: fresh.projectVersion },
      });
    current(generation);
    const result = collection(raw, fresh.projectId);
    if (result.projectVersion <= fresh.projectVersion)
      throw new Error("Chapter write receipt version mismatch.");
    const ids = result.sections.map((s) => s.id);
    if (input.kind === "create") {
      const added = result.sections.filter((s) => !fresh.sections.some((old) => old.id === s.id));
      if (
        added.length !== 1 ||
        added[0].title !== input.title ||
        result.sections.length !== fresh.sections.length + 1 ||
        fresh.sections.some((old) => !ids.includes(old.id))
      )
        throw new Error("Chapter creation receipt mismatch.");
    } else if (input.kind === "rename") {
      const renamed = result.sections.find((s) => s.id === input.id);
      if (!renamed || renamed.title !== input.title || renamed.version <= selected!.version)
        throw new Error("Chapter rename receipt mismatch.");
    } else if (input.kind === "archive") {
      if (
        ids.includes(input.id) ||
        result.sections.length !== fresh.sections.length - 1 ||
        fresh.sections.some((old) => old.id !== input.id && !ids.includes(old.id))
      )
        throw new Error("Chapter archive receipt mismatch.");
    } else if (ids.some((id, i) => id !== input.ids[i]) || ids.length !== input.ids.length)
      throw new Error("Chapter order receipt mismatch.");
    return { ...fresh, ...result };
  } catch (e) {
    throw new SectionWriteError(e instanceof Error ? e.message : String(e));
  }
}
