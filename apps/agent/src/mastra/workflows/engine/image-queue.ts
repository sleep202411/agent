/**
 * BullMQ queue for asset-image generation — separate from the workflow queue.
 *
 * Each job calls Java's /api/ai/image/generate/basic synchronously (Java
 * handles model inference + OSS upload), then PATCHes the asset record
 * with the returned storage path. We don't talk to Replicate or OSS
 * directly from this process.
 *
 * Why a dedicated queue rather than a new job type on storyos-workflows:
 *   - Different concurrency: workflow runs are expensive LLM chains;
 *     image jobs are I/O-bound on Java's response time (5-30s each).
 *     16 parallel image jobs ≠ 16 workflow runs — they compete for
 *     different resources.
 *   - Different retry policy: BullMQ-level attempts=3 with exponential
 *     backoff is the right answer for flaky Java / upstream calls;
 *     workflows manage their own retries internally.
 *   - Isolation: if image generation gets stuck behind a slow upstream,
 *     it shouldn't starve workflow run slots.
 */
import { Queue } from "bullmq";
import { buildConnection } from "./queue";
import type { StoryosContext } from "../../lib/workspace-client";

export const IMAGE_QUEUE_NAME = "asset-images";

export type AssetImageJobName = "generate";

/**
 * One image generation job = one asset's one image.
 *
 * The BullMQ job id is `img-{assetType}-{assetId}` — makes it trivially
 * idempotent: re-enqueueing the same asset while one is in flight is a
 * no-op. Regeneration explicitly bumps the id with a timestamp suffix so
 * users can force a new image without cancelling the stuck one.
 */
export type AssetImageJobData = {
  projectId: string;
  worldId: string;
  assetType: "role" | "scene" | "prop";
  assetId: string;
  /** Prompt fed directly to the image model. */
  prompt: string;
  /** Display name for event emission (shown in UI progress). */
  assetName: string;
  /** Context needed to call Java + emit events with the right auth. */
  ctx: StoryosContext;
  /** Optional force flag — included in the job id to bypass idempotency. */
  regenerateAt?: number;
};

let queue: Queue<AssetImageJobData, unknown, AssetImageJobName> | null = null;

export function getImageQueue(): Queue<AssetImageJobData, unknown, AssetImageJobName> {
  if (queue) return queue;
  queue = new Queue<AssetImageJobData, unknown, AssetImageJobName>(IMAGE_QUEUE_NAME, {
    connection: buildConnection(),
    defaultJobOptions: {
      attempts: 3,
      backoff: { type: "exponential", delay: 2_000 }, // 2s → 4s → 8s
      removeOnComplete: { age: 24 * 3600, count: 500 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
  return queue;
}

export function buildImageJobId(assetType: string, assetId: string, regenerateAt?: number): string {
  const base = `img-${assetType}-${assetId}`;
  return regenerateAt ? `${base}-${regenerateAt}` : base;
}

/** Test teardown. */
export async function __closeImageQueueForTests(): Promise<void> {
  if (queue) {
    await queue.close().catch(() => {});
    queue = null;
  }
}
