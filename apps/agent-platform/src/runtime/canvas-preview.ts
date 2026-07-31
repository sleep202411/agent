import { createHash } from "node:crypto";

import { z } from "zod";

import { storyChangeSetSchema } from "../capabilities/story-studio/contract.js";

export const studioAgentCanvasPreviewSchema = z
  .object({
    schemaVersion: z.literal("story-canvas-preview/v1"),
    previewId: z.uuid(),
    runId: z.uuid(),
    toolCallId: z.string().min(1).max(512),
    chapterId: z.uuid(),
    baseDraftRevision: z.number().int().nonnegative(),
    baseContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    baseLayoutRevision: z.number().int().nonnegative(),
    title: z.string().min(1).max(160).optional(),
    summary: z.string().min(1).max(4_000).optional(),
    operations: z
      .array(
        z
          .object({
            operationId: z.uuid(),
            kind: z.string().min(1).max(128),
            payload: z.unknown(),
          })
          .strict()
      )
      .min(1)
      .max(100),
  })
  .strict();

export type StudioAgentCanvasPreview = z.infer<typeof studioAgentCanvasPreviewSchema>;

export type StudioAgentCanvasPreviewChunk = Readonly<{
  type: "data-studio-agent-canvas-preview";
  id: string;
  transient: true;
  data: StudioAgentCanvasPreview;
}>;

/**
 * Convert a fully schema-validated Story change set into a transient visual
 * projection. The deterministic operation IDs exactly mirror the Domain
 * Gateway's eventual canonical IDs, while no canonical mutation occurs here.
 */
export function canvasPreviewChunkForToolCall(input: {
  runId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
}): StudioAgentCanvasPreviewChunk | null {
  if (input.toolName !== "story_apply_change_set") return null;
  const parsed = z
    .object({
      schemaVersion: z.literal("story-apply/v1"),
      changeSet: storyChangeSetSchema,
    })
    .strict()
    .safeParse(input.args);
  if (!parsed.success) return null;

  const changeSet = parsed.data.changeSet;
  const idempotencyKey = `${input.runId}:${input.toolCallId}`;
  const data = studioAgentCanvasPreviewSchema.parse({
    schemaVersion: "story-canvas-preview/v1",
    previewId: deterministicUuid(`agent-domain.story-preview:${idempotencyKey}`),
    runId: input.runId,
    toolCallId: input.toolCallId,
    chapterId: changeSet.chapterId,
    baseDraftRevision: changeSet.baseDraftRevision,
    baseContentHash: changeSet.baseContentHash,
    baseLayoutRevision: changeSet.baseLayoutRevision,
    title: changeSet.title,
    summary: changeSet.summary,
    operations: changeSet.operations.map((operation, index) => ({
      operationId: deterministicUuid(
        `agent-domain.story-operation:${idempotencyKey}:${index}:${operation.kind}`
      ),
      kind: operation.kind,
      payload: structuredClone(operation.payload),
    })),
  });

  return {
    type: "data-studio-agent-canvas-preview",
    id: `canvas-preview:${input.toolCallId}`,
    transient: true,
    data,
  };
}

/**
 * Inject the preview after Mastra has converted its internal chunks to the AI
 * SDK v6 protocol. Mastra's current conversion intentionally projects custom
 * chunks down to `{type,id,data}` and drops `transient`; adding the preview at
 * this boundary preserves `transient: true`, so Ably streams it live without
 * turning an optimistic projection into canonical chat history.
 */
export function withCanvasPreview<TStream extends ReadableStream<unknown>>(
  stream: TStream,
  runId: string
): TStream {
  // @mastra/ai-sdk intentionally bundles its supported AI SDK v6 types so it
  // can bridge multiple SDK versions. At runtime its output is the same AI SDK
  // protocol consumed by Ably, but the bundled type cannot be augmented with
  // FizzDragon's product-specific data part. Keep that compatibility cast
  // isolated at this one validated protocol boundary.
  const protocolStream = stream as ReadableStream<unknown>;
  const transformed = protocolStream.pipeThrough(
    new TransformStream<unknown, unknown>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        if (!isRecord(chunk) || chunk.type !== "tool-input-available") return;
        if (typeof chunk.toolCallId !== "string" || typeof chunk.toolName !== "string") {
          return;
        }
        const preview = canvasPreviewChunkForToolCall({
          runId,
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          args: chunk.input,
        });
        if (preview) controller.enqueue(preview);
      },
    })
  );
  return transformed as TStream;
}

function deterministicUuid(value: string): string {
  const bytes = createHash("sha256").update(value, "utf8").digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
