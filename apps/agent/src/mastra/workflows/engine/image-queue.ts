/**
 * BullMQ queue for asset-image generation — separate from the workflow queue.
 *
 * Why a dedicated queue rather than a new job type on storyos-workflows:
 *   - Different concurrency: workflow runs are expensive LLM chains; image
 *     generation is fast I/O-bound. 16 parallel image jobs ≠ 16 workflow runs.
 *   - Different retry policy: BullMQ-level attempts=3 with exponential
 *     backoff is the right answer for flaky Replicate/OSS calls; workflows
 *     manage their own retries internally.
 *   - Isolation: if image generation gets stuck behind a Replicate rate
 *     limit, it shouldn't starve workflow run slots.
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
