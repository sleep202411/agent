import { z } from "zod";
import { api } from "@/lib/api-client";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import { fetchCrewAssetAccess } from "@/features/crew-assets/api";
import { generationSession } from "./jobs-api";
const id = z.string().uuid();
const output = z.object({
  assetId: id.nullable(),
  url: z.string().nullable(),
  mimeType: z.string().nullable(),
  moderationStatus: z.string(),
});
export const likenessOutputJob = z.object({
  jobId: id,
  projectId: id.nullable(),
  status: z.string(),
  createdAt: z.string().datetime({ offset: true }),
  outputs: z.array(output),
});
export type LikenessOutputJob = z.infer<typeof likenessOutputJob>;
export const takedownScope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }).strict(),
  z.object({ kind: z.literal("project"), projectId: id }).strict(),
  z.object({ kind: z.literal("job"), jobId: id }).strict(),
]);
export type TakedownScope = z.infer<typeof takedownScope>;
export async function loadLikenessOutputs(
  characterId: string,
  generation: number,
  signal: AbortSignal
) {
  generationSession(generation, signal);
  id.parse(characterId);
  const rows = z.object({ items: z.array(likenessOutputJob) }).parse(
    await api.get(`/characters/${characterId}/outputs`, {
      service: "aurora",
      signal,
      retry: false,
    })
  ).items;
  generationSession(generation, signal);
  if (new Set(rows.map((r) => r.jobId)).size !== rows.length)
    throw new Error("Duplicate likeness output jobs. Refresh before continuing.");
  return rows;
}
const snapshotRow = z.object({ jobId: id, projectId: id.nullable(), assetIds: z.array(id) });
function snapshot(rows: LikenessOutputJob[], scope: TakedownScope) {
  return rows
    .filter(
      (r) =>
        scope.kind === "all" ||
        (scope.kind === "project" ? r.projectId === scope.projectId : r.jobId === scope.jobId)
    )
    .map((r) => ({
      jobId: r.jobId,
      projectId: r.projectId,
      assetIds: [...new Set(r.outputs.flatMap((o) => (o.assetId ? [o.assetId] : [])))].sort(),
    }))
    .sort((a, b) => a.jobId.localeCompare(b.jobId));
}
const commandSchema = z.object({
  clientKey: id,
  characterId: id,
  characterName: z.string(),
  scope: takedownScope,
  targets: z.array(snapshotRow),
});
export type LikenessTakedown = z.infer<typeof commandSchema>;
export const likenessTakedownBox = (userId: string, generation: number, characterId: string) =>
  pendingRequest(
    commandSchema,
    generation,
    durableRecord("likeness-takedown", userId, id.parse(characterId))
  );
export function prepareLikenessTakedown(
  characterId: string,
  characterName: string,
  rows: LikenessOutputJob[],
  scope: TakedownScope,
  clientKey: string
) {
  const targets = snapshot(rows, takedownScope.parse(scope));
  if (!targets.some((r) => r.assetIds.length))
    throw new Error("No stored output assets are available in this scope.");
  return commandSchema.parse({ clientKey, characterId, characterName, scope, targets });
}
export async function submitLikenessTakedown(
  command: LikenessTakedown,
  userId: string,
  generation: number,
  signal: AbortSignal
) {
  generationSession(generation, signal);
  const intent = commandSchema.parse(command),
    box = likenessTakedownBox(userId, generation, intent.characterId);
  if (box.read())
    throw new Error(
      "The original takedown result needs review. It will not be sent again automatically."
    );
  const fresh = await loadLikenessOutputs(intent.characterId, generation, signal);
  if (JSON.stringify(snapshot(fresh, intent.scope)) !== JSON.stringify(intent.targets))
    throw new Error("The outputs in this scope changed. Refresh and confirm again.");
  box.save(intent);
  const data =
    intent.scope.kind === "all"
      ? {}
      : intent.scope.kind === "project"
        ? { projectId: intent.scope.projectId }
        : { jobId: intent.scope.jobId };
  const receipt = z.object({ blocked: z.number().int().nonnegative().safe() }).parse(
    await api.post(`/characters/${intent.characterId}/outputs/takedown`, {
      service: "aurora",
      signal,
      retry: false,
      data,
    })
  );
  generationSession(generation, signal);
  box.clear(intent.clientKey);
  // Receipt is a count, not proof that every selected asset is blocked. The official list
  // currently reports moderationStatus=unknown; never infer success from a disappeared row.
  return receipt;
}
export async function previewLikenessOutput(
  characterId: string,
  jobId: string,
  assetId: string,
  generation: number,
  signal: AbortSignal
) {
  id.parse(jobId);
  id.parse(assetId);
  const rows = await loadLikenessOutputs(characterId, generation, signal),
    item = rows.find((r) => r.jobId === jobId)?.outputs.find((o) => o.assetId === assetId);
  if (!item || item.moderationStatus === "blocked")
    throw new Error("This output is no longer available for preview.");
  const access = await fetchCrewAssetAccess(assetId, signal);
  generationSession(generation, signal);
  return { url: access.url, mimeType: item.mimeType };
}
