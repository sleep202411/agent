import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { api } from "@/lib/api-client";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";

const id = z.string().uuid();
const contentPath = z
  .string()
  .regex(
    /^\/aurora\/media\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/content$/i
  );
const actor = z.object({
  id,
  name: z.string().min(1),
  photoUrl: contentPath,
  unlocked: z.boolean(),
});
export type AiActor = z.infer<typeof actor>;
const scopeSchema = z
  .object({
    kind: z.literal("platform"),
    workspaceId: id,
    projectId: id,
    generation: z.number().int().nonnegative(),
  })
  .strict();
export type ActorProjectScope = z.infer<typeof scopeSchema>;
export const actorUseIntent = z.object({ actorId: id, clientKey: id }).strict();
export type ActorUseIntent = z.infer<typeof actorUseIntent>;
const useReceipt = z.object({
  nodeId: id,
  actorId: id,
  name: z.string().min(1),
  mediaAssetId: id,
  url: contentPath,
});
export type ActorUseReceipt = z.infer<typeof useReceipt>;

/** The canvas owner clears this only after its node-save acknowledgement. A use
 * receipt alone is not proof that the actor card was inserted into the canvas. */
export function pendingActorUse(
  rawScope: ActorProjectScope,
  userId: string,
  documentId: string,
  storage?: DurableRecord
) {
  const scope = scopeSchema.parse(rawScope);
  id.parse(documentId);
  const pending = pendingRequest(
    actorUseIntent,
    scope.generation,
    storage ??
      durableRecord(
        "canvas-actor-use",
        userId,
        `${scope.workspaceId}:${scope.projectId}:${documentId}`
      )
  );
  return {
    read: pending.read,
    submit: async (raw: ActorUseIntent, signal: AbortSignal) => {
      current(scope.generation, signal);
      const intent = actorUseIntent.parse(raw);
      pending.save(intent);
      return requestActorUse(scope, intent, signal);
    },
    acknowledgeInsertion: (raw: ActorUseReceipt) => {
      const receipt = useReceipt.parse(raw);
      const intent = pending.read();
      if (
        !intent ||
        receipt.actorId !== intent.actorId ||
        receipt.nodeId !== intent.clientKey ||
        receipt.url !== `/aurora/media/assets/${receipt.mediaAssetId}/content`
      )
        throw Error("Actor insertion acknowledgement does not match the pending use.");
      pending.clear(intent.clientKey);
    },
  };
}

function current(generation: number, signal: AbortSignal) {
  signal.throwIfAborted();
  if (generation !== getAuthGeneration()) throw Error("Actor session expired.");
}

export async function listAiActors(
  workspaceId: string,
  page: number,
  generation: number,
  signal: AbortSignal
) {
  current(generation, signal);
  id.parse(workspaceId);
  z.number().int().min(1).max(100000).parse(page);
  const raw = await api.get("/ai-actors", {
    service: "aurora",
    params: { workspaceId, page },
    signal,
    retry: false,
  });
  current(generation, signal);
  const result = z.object({ items: z.array(actor).max(24), hasMore: z.boolean() }).parse(raw);
  if (new Set(result.items.map((row) => row.id)).size !== result.items.length)
    throw Error("Duplicate actors in this page.");
  return result;
}

/** Workspace unlock is an idempotent server upsert, distinct from inserting a card. */
export async function unlockAiActor(
  workspaceId: string,
  actorId: string,
  generation: number,
  signal: AbortSignal
) {
  current(generation, signal);
  id.parse(workspaceId);
  id.parse(actorId);
  const raw = await api.post(`/ai-actors/${actorId}/unlock`, {
    service: "aurora",
    data: { workspaceId },
    signal,
    retry: false,
  });
  current(generation, signal);
  const receipt = z.object({ actorId: id, workspaceId: id }).parse(raw);
  if (receipt.actorId !== actorId || receipt.workspaceId !== workspaceId)
    throw Error("Actor unlock receipt does not match this workspace.");
  return receipt;
}

/** Caller must persist intent before dispatch and retain it until the canvas insertion
 * is acknowledged. Never mint a new identity for an uncertain use/save response.
 * This endpoint only accepts PlatformProject IDs, not Story project IDs. */
export async function requestActorUse(
  rawScope: ActorProjectScope,
  rawIntent: ActorUseIntent,
  signal: AbortSignal
) {
  const scope = scopeSchema.parse(rawScope);
  const intent = actorUseIntent.parse(rawIntent);
  current(scope.generation, signal);
  const rawProject = await api.get(`/projects/${scope.projectId}`, {
    service: "aurora",
    signal,
    retry: false,
  });
  current(scope.generation, signal);
  const { project } = z
    .object({
      project: z.object({
        id,
        workspaceId: id,
        status: z.literal("active"),
        role: z.enum(["owner", "admin", "editor", "viewer"]).optional(),
      }),
    })
    .parse(rawProject);
  if (
    project.id !== scope.projectId ||
    project.workspaceId !== scope.workspaceId ||
    !["owner", "admin", "editor"].includes(project.role ?? "")
  )
    throw Error("Actor use requires edit access to the selected project.");
  const raw = await api.post(`/ai-actors/${intent.actorId}/use`, {
    service: "aurora",
    data: { projectId: scope.projectId, requestId: intent.clientKey },
    signal,
    retry: false,
  });
  current(scope.generation, signal);
  const receipt = useReceipt.parse(raw);
  if (
    receipt.actorId !== intent.actorId ||
    receipt.nodeId !== intent.clientKey ||
    receipt.url !== `/aurora/media/assets/${receipt.mediaAssetId}/content`
  )
    throw Error("Actor use receipt does not match this request.");
  return receipt;
}
