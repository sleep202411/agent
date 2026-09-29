import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
const uuid = z.string().uuid();
const crew = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const studioMediaSource = z
  .object({ projectId: uuid.nullable(), storyProjectId: uuid.nullable() })
  .strict()
  .refine((v) => !(v.projectId && v.storyProjectId), "Choose one Studio project.");
export type StudioMediaSource = z.infer<typeof studioMediaSource>;
export const studioMediaOptions = z.object({
  workspaceId: uuid.nullable(),
  projects: z.array(z.object({ id: uuid, name: z.string(), kind: z.enum(["canvas", "story"]) })),
  items: z.array(
    z.object({
      id: uuid,
      kind: z.enum(["image", "video", "audio"]),
      contentType: z.string(),
      name: z.string(),
      createdAt: z.string().datetime({ offset: true }),
    })
  ),
});
export type StudioMediaOptions = z.infer<typeof studioMediaOptions>;
const linkedStudio = z.object({
  mediaAssetId: uuid,
  projectId: uuid.nullable(),
  storyProjectId: uuid.nullable(),
});
export const studioAssetNode = z.object({
  id: uuid,
  parentId: uuid.nullable(),
  name: z.string(),
  kind: z.enum(["file", "folder"]),
  status: z.literal("active"),
  effectivePermission: z.enum(["view", "upload", "edit", "manage"]),
  linkedStudio: linkedStudio.nullable(),
  media: z.object({ id: uuid }).nullable(),
});
export type StudioAssetNode = z.infer<typeof studioAssetNode>;
function current(generation: number, signal?: AbortSignal) {
  if (generation !== getAuthGeneration() || signal?.aborted)
    throw new Error("Studio media session expired or request cancelled.");
}
async function authorize(crewId: string, userId: string, generation: number, signal: AbortSignal) {
  crew.parse(crewId);
  current(generation, signal);
  const member = z
    .object({ userId: z.string(), permissions: z.array(z.string()) })
    .parse(await api.get(`/crews/${crewId}/members/me`, { service: "aurora", signal }));
  current(generation, signal);
  if (member.userId !== userId) throw new Error("Crew membership account mismatch.");
  if (!member.permissions.includes("assets.view"))
    throw new Error("Crew asset access is required.");
}
export async function fetchStudioMediaOptions(
  crewId: string,
  userId: string,
  generation: number,
  source: StudioMediaSource,
  signal: AbortSignal
) {
  const filter = studioMediaSource.parse(source);
  await authorize(crewId, userId, generation, signal);
  const result = studioMediaOptions.parse(
    await api.get(`/crews/${crewId}/assets/studio-media-options`, {
      service: "aurora",
      signal,
      params: {
        ...(filter.projectId ? { projectId: filter.projectId } : {}),
        ...(filter.storyProjectId ? { storyProjectId: filter.storyProjectId } : {}),
      },
    })
  );
  current(generation, signal);
  if (
    new Set(result.items.map((r) => r.id)).size !== result.items.length ||
    new Set(result.projects.map((r) => `${r.kind}:${r.id}`)).size !== result.projects.length
  )
    throw new Error("Duplicate Studio media options.");
  if (!result.workspaceId && (result.items.length || result.projects.length))
    throw new Error("Studio workspace scope mismatch.");
  return result;
}
export async function fetchStudioAssetNode(
  crewId: string,
  userId: string,
  generation: number,
  nodeId: string,
  signal: AbortSignal
) {
  uuid.parse(nodeId);
  await authorize(crewId, userId, generation, signal);
  const { node: result } = z
    .object({ node: studioAssetNode })
    .parse(await api.get(`/crews/${crewId}/assets/nodes/${nodeId}`, { service: "aurora", signal }));
  current(generation, signal);
  if (result.id !== nodeId) throw new Error("Crew asset node mismatch.");
  return result;
}
async function validateSelection(
  crewId: string,
  userId: string,
  generation: number,
  workspaceId: string,
  source: StudioMediaSource,
  ids: string[]
) {
  uuid.parse(workspaceId);
  const options = await fetchStudioMediaOptions(
    crewId,
    userId,
    generation,
    source,
    new AbortController().signal
  );
  if (options.workspaceId !== workspaceId)
    throw new Error("Studio workspace changed. Refresh before continuing.");
  if (ids.some((id) => !options.items.some((row) => row.id === id)))
    throw new Error("Selected Studio media is no longer available.");
}
export async function importStudioMedia(
  crewId: string,
  userId: string,
  generation: number,
  workspaceId: string,
  source: StudioMediaSource,
  parentId: string | null,
  mediaAssetIds: string[]
) {
  const filter = studioMediaSource.parse(source);
  uuid.nullable().parse(parentId);
  const ids = z
    .array(uuid)
    .min(1)
    .max(40)
    .refine((v) => new Set(v).size === v.length, "Select each asset once.")
    .parse(mediaAssetIds);
  await validateSelection(crewId, userId, generation, workspaceId, filter, ids);
  if (parentId) {
    const parent = await fetchStudioAssetNode(
      crewId,
      userId,
      generation,
      parentId,
      new AbortController().signal
    );
    if (parent.kind !== "folder" || parent.effectivePermission === "view")
      throw new Error("Upload permission to the destination folder is required.");
  } else {
    const context = z
      .object({ capabilities: z.object({ upload: z.boolean() }) })
      .parse(await api.get(`/crews/${crewId}/assets/context`, { service: "aurora" }));
    current(generation);
    if (!context.capabilities.upload) throw new Error("Crew asset upload permission is required.");
  }
  current(generation);
  const result = z.object({ items: z.array(studioAssetNode) }).parse(
    await api.post(`/crews/${crewId}/assets/link-studio-media`, {
      service: "aurora",
      data: { ...filter, parentId, mediaAssetIds: ids },
    })
  );
  current(generation);
  // Already-present media is skipped; a successful receipt may contain fewer rows, including zero.
  if (
    new Set(result.items.map((r) => r.id)).size !== result.items.length ||
    new Set(result.items.map((r) => r.media?.id)).size !== result.items.length ||
    result.items.some(
      (r) =>
        r.kind !== "file" ||
        r.parentId !== parentId ||
        !r.media ||
        !ids.includes(r.media.id) ||
        r.linkedStudio?.mediaAssetId !== r.media.id ||
        r.linkedStudio.projectId !== filter.projectId ||
        r.linkedStudio.storyProjectId !== filter.storyProjectId
    )
  )
    throw new Error("Studio import could not be verified. Refresh the asset list before retrying.");
  return result.items;
}
export async function setStudioMediaLink(
  crewId: string,
  userId: string,
  generation: number,
  snapshot: StudioAssetNode,
  workspaceId: string | null,
  source: StudioMediaSource,
  mediaAssetId: string | null
) {
  const original = studioAssetNode.parse(snapshot),
    filter = studioMediaSource.parse(source);
  uuid.nullable().parse(mediaAssetId);
  const fresh = await fetchStudioAssetNode(
    crewId,
    userId,
    generation,
    original.id,
    new AbortController().signal
  );
  if (fresh.kind !== "file" || fresh.effectivePermission !== "manage")
    throw new Error("Manage permission on this file is required.");
  if (
    fresh.media?.id !== original.media?.id ||
    fresh.parentId !== original.parentId ||
    JSON.stringify(fresh.linkedStudio) !== JSON.stringify(original.linkedStudio)
  )
    throw new Error("This asset changed. Refresh before continuing.");
  if (mediaAssetId) {
    if (!workspaceId) throw new Error("Link a Studio workspace first.");
    await validateSelection(crewId, userId, generation, workspaceId, filter, [mediaAssetId]);
  }
  current(generation);
  const sent = mediaAssetId ? filter : { projectId: null, storyProjectId: null };
  // This endpoint has no version input. The server rechecks node permissions and media scope under lock.
  const result = studioAssetNode.parse(
    await api.patch(`/crews/${crewId}/assets/${original.id}/studio-link`, {
      service: "aurora",
      data: { ...sent, mediaAssetId },
    })
  );
  current(generation);
  if (
    result.id !== original.id ||
    result.kind !== "file" ||
    result.media?.id !== original.media?.id ||
    (mediaAssetId
      ? result.linkedStudio?.mediaAssetId !== mediaAssetId ||
        result.linkedStudio?.projectId !== sent.projectId ||
        result.linkedStudio?.storyProjectId !== sent.storyProjectId
      : result.linkedStudio !== null)
  )
    throw new Error("Studio link change could not be verified. Refresh before retrying.");
  return result;
}
