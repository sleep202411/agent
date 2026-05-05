/**
 * Standalone worker process — consumes image-generation jobs from BullMQ.
 * Runs as its own Node process so a crash in the API server doesn't kill
 * in-flight image jobs (and vice versa).
 *
 * Dev:  npm run worker
 * Prod: node dist/worker.js
 *
 * Workflow worker / reaper were removed 2026-05-05 along with the rest of
 * the workflow engine. Image generation kept its own queue (the supervisor
 * fans out short blocking calls per asset) — this file now only manages
 * that queue.
 */
export {}; // mark this file as a module so top-level await is permitted

try {
  process.loadEnvFile();
} catch {
  // Optional: in prod env comes from docker/k8s, no .env on disk.
}

const { startImageWorker } = await import("./mastra/workflows/engine/image-worker.js");

if (!process.env.DASHSCOPE_API_KEY && process.env.ALIBABA_API_KEY) {
  process.env.DASHSCOPE_API_KEY = process.env.ALIBABA_API_KEY;
}

// Image-generation worker on its own queue. Serial (concurrency=1) by
// default — dashscope burst-rate-limits at >1 per few seconds. Bump via
// IMAGE_WORKER_CONCURRENCY if provider quota allows true parallelism.
const imageConcurrency = Number(process.env.IMAGE_WORKER_CONCURRENCY ?? 1);
const imageWorker = startImageWorker({ concurrency: imageConcurrency });

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
  console.log(`[image-worker] received ${signal}, draining…`);
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
