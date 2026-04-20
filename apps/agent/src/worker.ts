/**
 * Standalone worker process — consumes workflow jobs from BullMQ and drives
 * Mastra's workflow runtime. Runs as its own Node process so a crash in the
 * API server doesn't kill in-flight workflow runs (and vice versa).
 *
 * Dev:  npm run worker
 * Prod: node dist/worker.js   (after `mastra build` + separate bundle — or
 *       simply `tsx src/worker.ts` in a container that ships source)
 *
 * The worker imports the same `mastra` instance as the API server so it sees
 * the same registered workflows and storage configuration. Mastra's snapshot
 * store (LibSQL by default) must be reachable from both processes.
 */
export {}; // mark this file as a module so top-level await is permitted

// Load apps/agent/.env — `mastra dev` auto-loads it for the API server, but
// this worker runs as its own tsx process and wouldn't otherwise see it.
// Must happen BEFORE importing anything that reads env (models.ts etc).
try {
  process.loadEnvFile();
} catch {
  // Optional: in prod env comes from docker/k8s, no .env on disk.
}

const { mastra } = await import("./mastra/index.js");
const { startWorker, startImageWorker } = await import("./mastra/workflows/engine/index.js");

// Alias ALIBABA_API_KEY to DASHSCOPE_API_KEY before any Mastra LLM call —
// same shim as the API server's index.ts so the worker uses the same model.
if (!process.env.DASHSCOPE_API_KEY && process.env.ALIBABA_API_KEY) {
  process.env.DASHSCOPE_API_KEY = process.env.ALIBABA_API_KEY;
}

const concurrency = Number(process.env.WORKER_CONCURRENCY ?? 4);
const worker = startWorker({ mastra, concurrency });

// Image-generation worker runs in the same process but on a separate queue.
// Serial (concurrency=1) by default — dashscope burst-rate-limits at >1 per
// few seconds, and the prior concurrency=16 caused whole-batch 429 storms
// that cost retry time and noisy logs. The provider's typical 8-20s gen
// latency paces calls naturally. Bump via IMAGE_WORKER_CONCURRENCY if
// provider quota is known to allow true parallelism.
const imageConcurrency = Number(process.env.IMAGE_WORKER_CONCURRENCY ?? 1);
const imageWorker = startImageWorker({ concurrency: imageConcurrency });

worker.on("ready", () => {
  // eslint-disable-next-line no-console
  console.log(`[storyos-worker] ready (concurrency=${concurrency})`);
});

worker.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("[storyos-worker] error:", err);
});

worker.on("failed", (job, err) => {
  // eslint-disable-next-line no-console
  console.error(`[storyos-worker] job ${job?.id} failed:`, err?.message ?? err);
});

worker.on("completed", (job) => {
  // eslint-disable-next-line no-console
  console.log(`[storyos-worker] job ${job.id} completed`);
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
  await Promise.all([worker.close(), imageWorker.close()]);
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
