import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import type { TimelineScope } from "./story-timeline-api";
import {
  timelineGenerationInput,
  timelineGenerationReceiptSchema,
} from "./story-timeline-generation";
const id = z.string().uuid(),
  version = z.number().int().nonnegative();
export const assetGenerationInput = timelineGenerationInput
  .innerType()
  .extend({
    purpose: z.enum(["primary", "turnaround"]).default("primary"),
    outputKind: z.enum(["image", "video"]).default("image"),
  })
  .refine(
    (v) => Boolean(v.modelId) === Boolean(v.schemaVersion),
    "Select both model and schema version."
  )
  .refine(
    (v) => v.purpose !== "turnaround" || v.outputKind === "image",
    "Three-view generation requires image output."
  );
const common = { clientKey: id };
const commandSchema = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("create"), input: assetGenerationInput }).strict(),
  z
    .object({
      ...common,
      action: z.literal("retry"),
      generationId: id,
      input: z.object({ expectedVersion: version }).strict(),
    })
    .strict(),
  z.object({ ...common, action: z.literal("cancel"), generationId: id }).strict(),
  z.object({ ...common, action: z.literal("attach"), generationId: id }).strict(),
]);
export type AssetGenerationCommand = z.input<typeof commandSchema>;
export type AssetGenerationScope = TimelineScope & {
  assetId: string;
  purpose: "primary" | "turnaround";
  outputKind: "image" | "video";
};
const receiptSchema = timelineGenerationReceiptSchema.extend({
  target: z.object({ kind: z.literal("asset_spec"), id, sequenceId: z.null() }),
  purpose: z.enum(["primary", "turnaround"]),
});
export type AssetGeneration = z.infer<typeof receiptSchema>;
function current(scope: AssetGenerationScope, signal?: AbortSignal) {
  signal?.throwIfAborted();
  z.enum(["primary", "turnaround"]).parse(scope.purpose);
  z.enum(["image", "video"]).parse(scope.outputKind);
  if (scope.purpose === "turnaround" && scope.outputKind !== "image")
    throw Error("Three-view generation requires image output.");
  if (scope.generation !== getAuthGeneration()) throw Error("Asset generation session expired.");
  [scope.projectId, scope.chapterId, scope.assetId].forEach((v) => id.parse(v));
}
function path(scope: AssetGenerationScope) {
  return `/story-projects/${scope.projectId}/chapters/${scope.chapterId}/asset-specs/${scope.assetId}/generations`;
}
function receipt(scope: AssetGenerationScope, raw: unknown, generationId?: string) {
  current(scope);
  const value = receiptSchema.parse(raw);
  const url = `/aurora${path(scope)}/${value.id}`;
  if (
    value.projectId !== scope.projectId ||
    value.chapterId !== scope.chapterId ||
    value.target.id !== scope.assetId ||
    value.purpose !== scope.purpose ||
    value.outputKind !== scope.outputKind ||
    (generationId && value.id !== generationId) ||
    value.statusUrl !== url ||
    value.cancelUrl !== `${url}/cancel` ||
    value.retryUrl !== `${url}/retry` ||
    value.materialization.retryUrl !== `${url}/materialization/retry`
  )
    throw Error("Generation response does not match the requested asset.");
  return value;
}
export async function getAssetGeneration(
  scope: AssetGenerationScope,
  generationId: string,
  signal: AbortSignal
) {
  current(scope, signal);
  id.parse(generationId);
  const raw = await api.get(`${path(scope)}/${generationId}`, {
    service: "aurora",
    retry: false,
    signal,
  });
  current(scope, signal);
  return receipt(scope, raw, generationId);
}
/** Commands are retried only explicitly, using their original body and idempotency key. */
export function assetGenerationPending(
  scope: AssetGenerationScope,
  userId: string,
  storage: DurableRecord = durableRecord(
    "story-asset-generation",
    userId,
    `${scope.projectId}:${scope.chapterId}:${scope.assetId}:${scope.purpose}:${scope.outputKind}`
  )
) {
  const pending = pendingRequest(commandSchema, scope.generation, storage);
  return {
    ...pending,
    submit: async (raw: AssetGenerationCommand) => {
      current(scope);
      const command = commandSchema.parse(raw);
      if (
        command.action === "create" &&
        (command.input.purpose !== scope.purpose || command.input.outputKind !== scope.outputKind)
      )
        throw Error("Generation purpose or output does not match the asset request.");
      pending.save(command);
      const suffix =
        command.action === "create"
          ? ""
          : `/${command.generationId}/${command.action === "attach" ? "materialization/retry" : command.action}`;
      const value = receipt(
        scope,
        await api.post(`${path(scope)}${suffix}`, {
          service: "aurora",
          retry: false,
          ...(command.action === "cancel"
            ? {}
            : { headers: { "Idempotency-Key": `asset-generation:${command.clientKey}` } }),
          ...("input" in command ? { data: command.input } : {}),
        }),
        command.action === "cancel" || command.action === "attach"
          ? command.generationId
          : undefined
      );
      if ("input" in command && value.targetVersion !== command.input.expectedVersion)
        throw Error("Generation target version could not be verified. Retry the saved request.");
      if (
        command.action === "retry" &&
        (value.retryOfGenerationId !== command.generationId || value.id === command.generationId)
      )
        throw Error("Generation retry receipt could not be verified.");
      if (
        command.action === "create" &&
        (value.retryOfGenerationId !== null ||
          (command.input.modelId &&
            (value.aiJob.modelId !== command.input.modelId ||
              value.aiJob.schemaVersion !== command.input.schemaVersion)))
      )
        throw Error("Generation model receipt could not be verified.");
      pending.clear(command.clientKey);
      return value;
    },
  };
}
