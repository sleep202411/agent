import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { studioAssetNode } from "./studio-media-api";
const uuid = z.string().uuid();
export const assetName = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine(
    (v) => v !== "." && v !== ".." && !v.includes("/"),
    "Choose a name without slashes or dot-only segments."
  );
export const organizationNode = studioAssetNode.extend({
  updatedAt: z.string().datetime({ offset: true }),
  favorite: z.boolean(),
});
export type OrganizationNode = z.infer<typeof organizationNode>;
export const organizationFolder = z.object({
  id: uuid,
  parentId: uuid.nullable(),
  name: z.string(),
  effectivePermission: z.enum(["view", "upload", "edit", "manage"]),
});
export type OrganizationFolder = z.infer<typeof organizationFolder>;
function current(generation: number, signal?: AbortSignal) {
  if (generation !== getAuthGeneration() || signal?.aborted)
    throw new Error("Asset organization session expired or request cancelled.");
}
async function authorize(crewId: string, userId: string, generation: number, signal: AbortSignal) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  current(generation, signal);
  const member = z
    .object({ userId: z.string(), permissions: z.array(z.string()) })
    .parse(await api.get(`/crews/${crewId}/members/me`, { service: "aurora", signal }));
  current(generation, signal);
  if (member.userId !== userId) throw new Error("Crew membership account mismatch.");
  if (!member.permissions.includes("assets.view"))
    throw new Error("Crew asset access is required.");
}
export async function fetchOrganizationNode(
  crewId: string,
  userId: string,
  generation: number,
  nodeId: string,
  signal: AbortSignal
) {
  uuid.parse(nodeId);
  await authorize(crewId, userId, generation, signal);
  const { node } = z
    .object({ node: organizationNode })
    .parse(await api.get(`/crews/${crewId}/assets/nodes/${nodeId}`, { service: "aurora", signal }));
  current(generation, signal);
  if (node.id !== nodeId) throw new Error("Crew asset scope mismatch.");
  return node;
}
export async function fetchOrganizationFolders(
  crewId: string,
  userId: string,
  generation: number,
  signal: AbortSignal
) {
  await authorize(crewId, userId, generation, signal);
  const rows = z
    .array(organizationFolder)
    .parse(await api.get(`/crews/${crewId}/assets/folders`, { service: "aurora", signal }));
  current(generation, signal);
  if (new Set(rows.map((r) => r.id)).size !== rows.length)
    throw new Error("Duplicate asset folders.");
  return rows;
}
/** Hide descendants and incomplete/cyclic paths; the server also validates under its tree lock. */
export function eligibleMoveFolders(rows: OrganizationFolder[], nodeId?: string) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return rows.filter((row) => {
    if (row.effectivePermission === "view") return false;
    const seen = new Set<string>();
    let id: string | null = row.id;
    while (id) {
      if (id === nodeId || seen.has(id)) return false;
      seen.add(id);
      const ancestor = byId.get(id);
      if (!ancestor) return false;
      id = ancestor.parentId;
    }
    return true;
  });
}
export async function validateAssetDestination(
  crewId: string,
  userId: string,
  generation: number,
  parentId: string | null
) {
  uuid.nullable().parse(parentId);
  if (parentId) {
    const parent = await fetchOrganizationNode(
      crewId,
      userId,
      generation,
      parentId,
      new AbortController().signal
    );
    if (parent.kind !== "folder" || parent.effectivePermission === "view")
      throw new Error("Upload permission on the destination folder is required.");
  } else {
    await authorize(crewId, userId, generation, new AbortController().signal);
    const context = z
      .object({ capabilities: z.object({ upload: z.boolean() }) })
      .parse(await api.get(`/crews/${crewId}/assets/context`, { service: "aurora" }));
    current(generation);
    if (!context.capabilities.upload) throw new Error("Root asset upload permission is required.");
  }
}
export async function createOrganizationFolder(
  crewId: string,
  userId: string,
  generation: number,
  name: string,
  parentId: string | null
) {
  const normalized = assetName.parse(name);
  await validateAssetDestination(crewId, userId, generation, parentId);
  current(generation);
  const result = organizationNode.parse(
    await api.post(`/crews/${crewId}/assets/folders`, {
      service: "aurora",
      data: { name: normalized, parentId },
    })
  );
  current(generation);
  if (
    result.kind !== "folder" ||
    result.parentId !== parentId ||
    result.name !== normalized ||
    result.media !== null ||
    result.linkedStudio !== null
  )
    throw new Error("Folder creation could not be verified. Refresh before retrying.");
  return result;
}
export async function updateOrganizationNode(
  crewId: string,
  userId: string,
  generation: number,
  snapshot: OrganizationNode,
  value: { name: string; parentId: string | null }
) {
  const original = organizationNode.parse(snapshot),
    name = assetName.parse(value.name),
    parentId = uuid.nullable().parse(value.parentId);
  current(generation);
  if (name === original.name && parentId === original.parentId) return original;
  const fresh = await fetchOrganizationNode(
    crewId,
    userId,
    generation,
    original.id,
    new AbortController().signal
  );
  if (fresh.updatedAt !== original.updatedAt)
    throw new Error("This asset changed. Refresh before editing.");
  if (!["edit", "manage"].includes(fresh.effectivePermission))
    throw new Error("Asset edit permission is required.");
  const changes: { name?: string; parentId?: string | null } = {};
  if (name !== original.name) changes.name = name;
  if (parentId !== original.parentId) {
    if (parentId === original.id) throw new Error("A folder cannot contain itself.");
    if (parentId && original.kind === "folder") {
      const rows = await fetchOrganizationFolders(
        crewId,
        userId,
        generation,
        new AbortController().signal
      );
      if (!eligibleMoveFolders(rows, original.id).some((r) => r.id === parentId))
        throw new Error("Choose an accessible destination outside this folder.");
    }
    await validateAssetDestination(crewId, userId, generation, parentId);
    changes.parentId = parentId;
  }
  current(generation);
  const result = organizationNode.parse(
    await api.patch(`/crews/${crewId}/assets/${original.id}`, {
      service: "aurora",
      data: { ...changes, expectedUpdatedAt: original.updatedAt },
    })
  );
  current(generation);
  if (
    result.id !== original.id ||
    result.kind !== original.kind ||
    result.name !== name ||
    result.parentId !== parentId ||
    result.updatedAt === original.updatedAt ||
    result.media?.id !== original.media?.id
  )
    throw new Error("Asset update could not be verified. Refresh before retrying.");
  return result;
}
export async function setOrganizationFavorite(
  crewId: string,
  userId: string,
  generation: number,
  nodeId: string,
  favorite: boolean
) {
  uuid.parse(nodeId);
  z.boolean().parse(favorite);
  await authorize(crewId, userId, generation, new AbortController().signal);
  const result = z.object({ favorite: z.boolean() }).parse(
    await api.put(`/crews/${crewId}/assets/${nodeId}/favorite`, {
      service: "aurora",
      data: { favorite },
    })
  );
  current(generation);
  if (result.favorite !== favorite) throw new Error("Favorite update could not be verified.");
  return result.favorite;
}

/** The server deduplicates attachment by media ID; retry the same upload, never re-upload it. */
export async function attachOrganizationFile(
  crewId: string,
  userId: string,
  generation: number,
  input: { mediaAssetId: string; name: string; parentId: string | null }
) {
  const data = z
    .object({ mediaAssetId: uuid, name: assetName, parentId: uuid.nullable() })
    .strict()
    .parse(input);
  await validateAssetDestination(crewId, userId, generation, data.parentId);
  current(generation);
  const result = organizationNode.parse(
    await api.post(`/crews/${crewId}/assets/files`, { service: "aurora", data })
  );
  current(generation);
  // Name collisions are resolved by the server. A changed destination requires fresh review.
  if (
    result.kind !== "file" ||
    result.media?.id !== data.mediaAssetId ||
    result.parentId !== data.parentId
  )
    throw new Error(
      "File attachment could not be verified. Refresh the asset list before continuing."
    );
  return result;
}

export async function fetchOrganizationLocation(
  crewId: string,
  userId: string,
  generation: number,
  nodeId: string,
  signal: AbortSignal
) {
  uuid.parse(nodeId);
  await authorize(crewId, userId, generation, signal);
  const result = z
    .object({
      node: organizationNode,
      path: z.array(z.object({ id: uuid, name: z.string().min(1) })).max(128),
    })
    .parse(await api.get(`/crews/${crewId}/assets/nodes/${nodeId}`, { service: "aurora", signal }));
  current(generation, signal);
  if (
    result.node.id !== nodeId ||
    new Set(result.path.map((p) => p.id)).size !== result.path.length ||
    result.path.some((p) => p.id === nodeId) ||
    (result.path.at(-1)?.id ?? null) !== result.node.parentId
  )
    throw new Error("Asset folder path could not be verified. Refresh before continuing.");
  return result;
}
