import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import type { TimelineScope } from "./story-timeline-api";
const id = z.string().uuid();
const version = z.number().int().nonnegative();
const text = (max: number) => z.string().trim().min(1).max(max);
export const assetPatchInput = z
  .object({
    expectedVersion: version,
    name: text(240).optional(),
    description: z.string().trim().max(4000).nullable().optional(),
    imagePrompt: text(12000).optional(),
    videoPrompt: text(12000).nullable().optional(),
    negativePrompt: text(4000).nullable().optional(),
    selectedMediaVersionId: id.nullable().optional(),
    sourceMediaAssetId: id.optional(),
    sourceMediaPurpose: z.enum(["primary", "turnaround"]).optional(),
  })
  .strict()
  .refine((v) => !(v.sourceMediaAssetId && v.selectedMediaVersionId !== undefined))
  .refine((v) => !!v.sourceMediaAssetId || v.sourceMediaPurpose === undefined)
  .refine((v) => Object.keys(v).some((k) => k !== "expectedVersion"));
export const assetCreateInput = z
  .object({
    kind: z.enum(["character", "location", "prop"]),
    name: text(240),
    imagePrompt: text(12000),
    description: z.string().trim().max(4000).nullable().optional(),
    videoPrompt: text(12000).nullable().optional(),
    negativePrompt: text(4000).nullable().optional(),
  })
  .strict();
const commandSchema = z.discriminatedUnion("action", [
  z.object({ clientKey: id, action: z.literal("create"), input: assetCreateInput }).strict(),
  z
    .object({ clientKey: id, assetId: id, action: z.literal("patch"), input: assetPatchInput })
    .strict(),
  z
    .object({
      clientKey: id,
      assetId: id,
      action: z.literal("archive"),
      input: z.object({ expectedVersion: version }).strict(),
    })
    .strict(),
]);
export type AssetCommand = z.infer<typeof commandSchema>;
const media = z.object({ id, mediaAssetId: id }).passthrough();
const receipt = z
  .object({
    id,
    projectId: id,
    chapterId: id,
    version,
    status: z.enum(["current", "archived"]),
    kind: z.enum(["character", "location", "prop"]).optional(),
    name: z.string(),
    description: z.string().nullable(),
    imagePrompt: z.string().nullable(),
    videoPrompt: z.string().nullable().optional(),
    negativePrompt: z.string().nullable().optional(),
    selectedMediaVersion: media.nullable(),
    mediaVersions: z.array(media),
  })
  .passthrough();
function current(scope: TimelineScope) {
  id.parse(scope.projectId);
  id.parse(scope.chapterId);
  if (getAuthGeneration() !== scope.generation) throw Error("Asset session expired.");
}
export async function mutateStoryAsset(scope: TimelineScope, raw: AssetCommand) {
  current(scope);
  const command = commandSchema.parse(raw);
  const base = `/story-projects/${scope.projectId}/chapters/${scope.chapterId}/asset-specs`;
  const path = command.action === "create" ? base : `${base}/${command.assetId}`;
  const config = {
    service: "aurora" as const,
    retry: false,
    headers: { "Idempotency-Key": `story-asset:${command.clientKey}` },
    data: command.input,
  };
  const result = receipt.parse(
    await (command.action === "create"
      ? api.post(path, config)
      : command.action === "archive"
        ? api.delete(path, config)
        : api.patch(path, config))
  );
  current(scope);
  if (
    (command.action !== "create" && result.id !== command.assetId) ||
    result.projectId !== scope.projectId ||
    result.chapterId !== scope.chapterId ||
    result.version !== (command.action === "create" ? 0 : command.input.expectedVersion + 1) ||
    result.status !== (command.action === "archive" ? "archived" : "current")
  )
    throw Error("Asset receipt does not match the saved request.");
  if (command.action === "create") {
    const input = command.input;
    if (
      result.kind !== input.kind ||
      result.name !== input.name ||
      result.imagePrompt !== input.imagePrompt ||
      result.description !== (input.description ?? null) ||
      (result.videoPrompt ?? null) !== (input.videoPrompt ?? null) ||
      (result.negativePrompt ?? null) !== (input.negativePrompt ?? null) ||
      result.selectedMediaVersion !== null ||
      result.mediaVersions.length !== 0
    )
      throw Error("Created asset receipt mismatch.");
  }
  if (command.action === "patch") {
    const input = command.input;
    for (const key of [
      "name",
      "description",
      "imagePrompt",
      "videoPrompt",
      "negativePrompt",
    ] as const) {
      if (input[key] !== undefined && result[key] !== input[key])
        throw Error("Asset field receipt mismatch.");
    }
    if (
      input.selectedMediaVersionId !== undefined &&
      (result.selectedMediaVersion?.id ?? null) !== input.selectedMediaVersionId
    )
      throw Error("Selected asset version receipt mismatch.");
    if (input.sourceMediaAssetId) {
      const imported = result.mediaVersions.filter(
        (v) => v.mediaAssetId === input.sourceMediaAssetId
      );
      if (
        !imported.length ||
        ((input.sourceMediaPurpose ?? "primary") === "primary" &&
          result.selectedMediaVersion?.mediaAssetId !== input.sourceMediaAssetId)
      )
        throw Error("Imported asset receipt mismatch.");
    }
  }
  return result;
}
export function assetMutationPending(
  scope: TimelineScope,
  userId: string,
  storage: DurableRecord = durableRecord(
    "story-asset-mutation",
    userId,
    `${scope.projectId}:${scope.chapterId}`
  )
) {
  if (!userId) throw Error("An account is required.");
  const pending = pendingRequest(commandSchema, scope.generation, storage);
  return {
    ...pending,
    submit: async (command: AssetCommand) => {
      current(scope);
      pending.save(command);
      const result = await mutateStoryAsset(scope, command);
      pending.clear(command.clientKey);
      return result;
    },
  };
}
