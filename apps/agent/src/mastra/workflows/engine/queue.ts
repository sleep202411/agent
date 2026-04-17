/**
 * BullMQ queue used for backgrounding Mastra workflow runs + resumes.
 *
 * Both the Mastra API server (enqueues) and the worker process (consumes)
 * import `getQueue()`. Connection is derived from REDIS_URL, same as the
 * ioredis singleton in redis-client.ts (kept separate because BullMQ needs
 * its own dedicated connections per queue/worker and doesn't share with
 * application traffic).
 */
import { Queue, type ConnectionOptions } from "bullmq";
import type { ResumeJobData, RunJobData } from "./types";

export const QUEUE_NAME = "storyos-workflows";

export type StoryosJobName = "run" | "resume";
export type StoryosJobData = RunJobData | ResumeJobData;

let queue: Queue<StoryosJobData, unknown, StoryosJobName> | null = null;

export function buildConnection(): ConnectionOptions {
  const url = process.env.REDIS_URL;
  if (!url) {
    // ioredis constructor default targets localhost:6379; surfacing this
    // explicitly in config makes BullMQ's own diagnostics clearer.
    return { host: "127.0.0.1", port: 6379 };
  }
  return { url } as unknown as ConnectionOptions;
}

export function getQueue(): Queue<StoryosJobData, unknown, StoryosJobName> {
  if (queue) return queue;
  queue = new Queue<StoryosJobData, unknown, StoryosJobName>(QUEUE_NAME, {
    connection: buildConnection(),
    defaultJobOptions: {
      attempts: 1, // We use our own retry/backoff in workflow steps; don't retry at queue level.
      removeOnComplete: { age: 24 * 3600, count: 1000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
  return queue;
}

/** Test teardown hook. */
export async function __closeQueueForTests(): Promise<void> {
  if (queue) {
    await queue.close().catch(() => {});
    queue = null;
  }
}
