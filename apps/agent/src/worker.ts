/**
 * Standalone worker process — consumes produce workflow jobs and
 * image-generation jobs from BullMQ. Runs as its own Node process so a
 * crash in the API server doesn't kill in-flight jobs (and vice versa).
 *
 * Dev:  npm run worker
 * Prod: node dist/worker.js
 *
 * StoryOS chat no longer dispatches phase workflows. Produce mode still
 * uses one isolated workflow for Step 1 draft analysis, so the workflow
 * worker is enabled again without remounting the legacy chat workflow API.
 */
export {}; // mark this file as a module so top-level await is permitted

try {
  process.loadEnvFile();
} catch {
  // Optional: in prod env comes from docker/k8s, no .env on disk.
}

const { mastra } = await import("./mastra/index.js");
const { startImageWorker, startWorker } = await import("./mastra/workflows/engine/index.js");

// Image-generation worker on its own queue. Serial (concurrency=1) by
// default — dashscope burst-rate-limits at >1 per few seconds. Bump via
// IMAGE_WORKER_CONCURRENCY if provider quota allows true parallelism.
const workflowConcurrency = Number(process.env.WORKFLOW_WORKER_CONCURRENCY ?? 2);
const workflowWorker = startWorker({ mastra, concurrency: workflowConcurrency });

const imageConcurrency = Number(process.env.IMAGE_WORKER_CONCURRENCY ?? 1);
const imageWorker = startImageWorker({ concurrency: imageConcurrency });

workflowWorker.on("ready", () => {
  // eslint-disable-next-line no-console
  console.log(`[workflow-worker] ready (concurrency=${workflowConcurrency})`);
});
workflowWorker.on("failed", (job, err) => {
  // eslint-disable-next-line no-console
  console.error(`[workflow-worker] job ${job?.id} failed:`, err?.message ?? err);
});
workflowWorker.on("completed", (job) => {
  // eslint-disable-next-line no-console
  console.log(`[workflow-worker] job ${job.id} completed`);
});

imageWorker.on("ready", () => {
  // eslint-disable-next-line no-console
  console.log(`[image-worker] ready (concurrency=${imageConcurrency})`);
});
imageWorker.on("failed", (job, err) => {
  // eslint-disable-next-line no-console
  console.error(`[image-worker] job ${job?.id} failed:`, err?.message ?? err);
});
imageWorker.on("completed", (job) => {
  // eslint-disable-next-line no-console
  console.log(`[image-worker] job ${job.id} completed`);
});

async function shutdown(signal: string): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(`[storyos-worker] received ${signal}, draining…`);
  await workflowWorker.close();
  await imageWorker.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

// Last-resort guards — a single bad step / rejection should NOT kill the
// whole worker process (which would drop all queued jobs). BullMQ's own
// job-level handler marks the job as failed; these are for errors that
// escape that path (e.g. async leaks in tool callbacks).
process.on("uncaughtException", (err) => {
  // eslint-disable-next-line no-console
  console.error("[storyos-worker] uncaughtException:", err);
});

process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error("[storyos-worker] unhandledRejection:", reason);
});
