import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { fetchOrganizationNode } from "../crew-assets/organization-api";
const uuid = z.string().uuid();
export const resourceUrl = z
  .string()
  .trim()
  .url()
  .max(2048)
  .refine((v) => {
    try {
      const u = new URL(v);
      return ["http:", "https:"].includes(u.protocol) && !u.username && !u.password;
    } catch {
      return false;
    }
  }, "Use an HTTP or HTTPS link without embedded credentials.");
const title = z.string().trim().min(1).max(180);
export const resourceInput = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("link"), url: resourceUrl, title: title.optional() }).strict(),
  z.object({ kind: z.literal("asset"), assetNodeId: uuid, title: title.optional() }).strict(),
]);
export type ResourceInput = z.infer<typeof resourceInput>;
export const projectResource = z
  .object({
    id: uuid,
    crewId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    kind: z.enum(["link", "asset"]),
    title: z.string(),
    url: z.string().nullable(),
    assetNodeId: uuid.nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .refine(
    (v) =>
      v.kind === "link"
        ? v.url !== null && v.assetNodeId === null
        : v.url === null && v.assetNodeId !== null,
    "Invalid resource reference."
  );
export type ProjectResource = z.infer<typeof projectResource>;
function current(generation: number, signal?: AbortSignal) {
  if (generation !== getAuthGeneration() || signal?.aborted)
    throw new Error("Project resource session expired or request cancelled.");
}
export async function fetchProjectResources(
  crewId: string,
  userId: string,
  generation: number,
  signal: AbortSignal
) {
  z.string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/)
    .parse(crewId);
  current(generation, signal);
  const access = z
    .object({ userId: z.string(), permissions: z.array(z.string()) })
    .parse(await api.get(`/crews/${crewId}/members/me`, { service: "aurora", signal }));
  current(generation, signal);
  if (access.userId !== userId) throw new Error("Crew membership account mismatch.");
  if (!access.permissions.includes("production.view"))
    throw new Error("Production access is required.");
  const data = z
    .object({
      page: z.object({ crewId: z.string() }),
      resources: z.array(projectResource),
      capabilities: z.object({ manage: z.boolean() }),
    })
    .parse(await api.get(`/crews/${crewId}/production-overview`, { service: "aurora", signal }));
  current(generation, signal);
  if (
    data.page.crewId !== crewId ||
    data.resources.some((r) => r.crewId !== crewId) ||
    new Set(data.resources.map((r) => r.id)).size !== data.resources.length
  )
    throw new Error("Project resource scope mismatch.");
  return {
    resources: data.resources,
    canManage: data.capabilities.manage && access.permissions.includes("production.manage"),
  };
}
export async function addProjectResource(
  crewId: string,
  userId: string,
  generation: number,
  value: ResourceInput
) {
  const input = resourceInput.parse(value);
  const context = await fetchProjectResources(
    crewId,
    userId,
    generation,
    new AbortController().signal
  );
  if (!context.canManage) throw new Error("Production management permission is required.");
  if (input.kind === "asset") {
    const node = await fetchOrganizationNode(
      crewId,
      userId,
      generation,
      input.assetNodeId,
      new AbortController().signal
    );
    if (node.kind !== "file" || !node.media) throw new Error("Choose an available Crew file.");
  }
  current(generation);
  const result = projectResource.parse(
    await api.post(`/crews/${crewId}/production-resources`, { service: "aurora", data: input })
  );
  current(generation);
  if (
    result.crewId !== crewId ||
    result.kind !== input.kind ||
    context.resources.some((r) => r.id === result.id) ||
    (input.title !== undefined && result.title !== input.title) ||
    (input.kind === "link" ? result.url !== input.url : result.assetNodeId !== input.assetNodeId)
  )
    throw new Error("Resource creation could not be verified. Refresh before another attempt.");
  return result;
}
export async function removeProjectResource(
  crewId: string,
  userId: string,
  generation: number,
  snapshot: ProjectResource
) {
  const target = projectResource.parse(snapshot);
  if (target.crewId !== crewId) throw new Error("Project resource scope mismatch.");
  const context = await fetchProjectResources(
    crewId,
    userId,
    generation,
    new AbortController().signal
  );
  if (!context.canManage) throw new Error("Production management permission is required.");
  const fresh = context.resources.find((r) => r.id === target.id);
  if (!fresh || JSON.stringify(fresh) !== JSON.stringify(target))
    throw new Error("Resource changed or was removed. Refresh before another attempt.");
  current(generation);
  await api.delete(`/crew-production-resources/${target.id}`, { service: "aurora" });
  current(generation);
}
export async function resolveProjectResource(
  crewId: string,
  userId: string,
  generation: number,
  snapshot: ProjectResource,
  signal: AbortSignal
) {
  const target = projectResource.parse(snapshot);
  if (target.crewId !== crewId) throw new Error("Project resource scope mismatch.");
  const context = await fetchProjectResources(crewId, userId, generation, signal);
  const fresh = context.resources.find((r) => r.id === target.id);
  if (!fresh || JSON.stringify(fresh) !== JSON.stringify(target))
    throw new Error("Resource changed or was removed. Refresh before opening.");
  if (fresh.kind === "link") return { kind: "link" as const, url: resourceUrl.parse(fresh.url) };
  // Resolve current node/media permissions only when the user opens this resource.
  await fetchOrganizationNode(crewId, userId, generation, fresh.assetNodeId!, signal);
  current(generation, signal);
  const { node } = z
    .object({
      node: z.object({
        id: uuid,
        kind: z.literal("file"),
        status: z.literal("active"),
        name: z.string(),
        media: z.object({ id: uuid, kind: z.string(), contentType: z.string() }),
      }),
    })
    .parse(
      await api.get(`/crews/${crewId}/assets/nodes/${fresh.assetNodeId}`, {
        service: "aurora",
        signal,
      })
    );
  current(generation, signal);
  if (node.id !== fresh.assetNodeId) throw new Error("Resource file scope mismatch.");
  return {
    kind: "asset" as const,
    mediaAssetId: node.media.id,
    name: node.name,
    mediaKind: node.media.kind,
    contentType: node.media.contentType,
  };
}
