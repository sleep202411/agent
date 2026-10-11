import { z } from "zod";
import { api } from "@/lib/api-client";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord } from "@/lib/durable-record";
import { pendingRequest } from "@/lib/pending-request";
import type { TimelineScope } from "./story-timeline-api";

const id = z.string().uuid();
const count = z.number().int().nonnegative();
const target = z.object({ id, expectedVersion: count, sequenceId: id.optional() }).strict();
const quoteCommand = z
  .object({
    clientKey: id,
    targets: z
      .array(target)
      .min(1)
      .max(500)
      .refine((rows) => new Set(rows.map((row) => row.id)).size === rows.length),
  })
  .strict();
const batch = z
  .object({
    id,
    projectId: id,
    chapterId: id,
    version: count,
    status: z.enum([
      "awaiting_confirmation",
      "blocked",
      "queued",
      "running",
      "cancelling",
      "completed",
      "partial_failed",
      "cancelled",
      "failed",
      "expired",
    ]),
    totalPoints: count,
    itemCount: count,
    canCancel: z.boolean(),
    availablePoints: z.string().regex(/^\d+$/).nullable(),
    quoteExpiresAt: z.string().datetime({ offset: true }),
    blockReason: z.unknown().optional(),
    items: z.array(
      z.object({
        id,
        targetId: id,
        targetVersion: count,
        sequenceId: id.nullish(),
        targetKind: z.enum(["asset_spec", "storyboard_clip"]),
        status: z.enum([
          "awaiting_confirmation",
          "ready",
          "dispatching",
          "submitted",
          "completed",
          "failed",
          "cancelled",
        ]),
        modelId: z.string(),
        quotedPoints: count,
        error: z.unknown().optional(),
      })
    ),
  })
  .refine(
    (row) =>
      row.items.length === row.itemCount &&
      new Set(row.items.map((item) => item.id)).size === row.items.length
  );
export type ManagedStoryBatch = z.infer<typeof batch>;
export type BatchQuoteCommand = z.infer<typeof quoteCommand>;

export function storyBatchManagement(
  scope: TimelineScope,
  userId: string,
  mode: "assets" | "storyboard" = "assets"
) {
  id.parse(scope.projectId);
  id.parse(scope.chapterId);
  const path = `/story-projects/${scope.projectId}/chapters/${scope.chapterId}/generation-batches`;
  const pending = pendingRequest(
    quoteCommand,
    scope.generation,
    durableRecord("story-batch-quote", userId, `${scope.projectId}:${scope.chapterId}:${mode}`)
  );
  const current = (signal: AbortSignal) => {
    signal.throwIfAborted();
    if (getAuthGeneration() !== scope.generation) throw Error("Story batch session expired.");
  };
  const receipt = (value: unknown, batchId?: string) => {
    const row = batch.parse(value);
    if (
      row.projectId !== scope.projectId ||
      row.chapterId !== scope.chapterId ||
      (batchId && row.id !== batchId)
    )
      throw Error("Generation batch response does not match this chapter.");
    return row;
  };
  return {
    pending: pending.read,
    discardQuote() {
      const old = pending.read();
      if (old) pending.clear(old.clientKey);
    },
    async list(signal: AbortSignal) {
      current(signal);
      const value = await api.get(path, { service: "aurora", signal, retry: false });
      current(signal);
      const rows = z
        .array(z.unknown())
        .parse(value)
        .map((row) => receipt(row));
      if (new Set(rows.map((row) => row.id)).size !== rows.length)
        throw Error("Duplicate generation batch response.");
      return rows;
    },
    async quote(input: BatchQuoteCommand, signal: AbortSignal) {
      current(signal);
      const command = quoteCommand.parse(input);
      if (
        command.targets.some((target) =>
          mode === "storyboard" ? !target.sequenceId : !!target.sequenceId
        )
      )
        throw Error("Generation targets do not match the batch type.");
      pending.save(command);
      const raw = await api.post(
        `${path}/${mode === "assets" ? "asset-specs" : "storyboard/clips"}/quote`,
        {
          service: "aurora",
          signal,
          retry: false,
          headers: { "Idempotency-Key": `mobile-asset-batch:${command.clientKey}` },
          data:
            mode === "assets"
              ? { targets: command.targets, outputKind: "image", options: {} }
              : { targets: command.targets },
        }
      );
      current(signal);
      const row = receipt(raw);
      if (
        row.items.length !== command.targets.length ||
        new Set(row.items.map((item) => item.targetId)).size !== row.items.length ||
        row.items.some(
          (item) =>
            item.targetKind !== (mode === "assets" ? "asset_spec" : "storyboard_clip") ||
            !command.targets.some(
              (target) =>
                target.id === item.targetId &&
                target.expectedVersion === item.targetVersion &&
                (mode === "assets" || target.sequenceId === item.sequenceId)
            )
        )
      )
        throw Error("Generation quote does not match the selected assets.");
      pending.clear(command.clientKey);
      return row;
    },
    async act(
      action: "confirm" | "resume" | "cancel",
      row: ManagedStoryBatch,
      signal: AbortSignal
    ) {
      current(signal);
      receipt(row, row.id);
      z.enum(["confirm", "resume", "cancel"]).parse(action);
      const raw = await api.post(`${path}/${row.id}/${action}`, {
        service: "aurora",
        signal,
        retry: false,
        data: action === "confirm" ? { expectedVersion: row.version } : {},
      });
      current(signal);
      return receipt(raw, row.id);
    },
  };
}
