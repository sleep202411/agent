/**
 * BullMQ worker for asset-image generation jobs.
 *
 * Runs alongside the main workflow worker in the same Node process
 * (see index.ts -> startWorker + startImageWorker). Separate queue =
 * separate concurrency budget so image gen doesn't starve workflow runs.
 *
 * Per-job flow:
 *   1. Mark status "generating" in Redis (frontend starts showing spinner)
 *   2. Call Replicate + upload to OSS via image-pipeline
 *   3. PATCH Java role/scene/prop record with new path
 *   4. Mark status "ready" with the new OSS path
 *
 * All failures land in a classified status (`failed_config` / `failed_policy`
 * / `failed_server` / `failed_upload`) so the UI can show the right message
 * + retry button. BullMQ retries transient failures up to 3x before giving
 * up (see image-queue.ts attempts/backoff).
 */
import { Worker, type Job } from "bullmq";
import { IMAGE_QUEUE_NAME, type AssetImageJobData, type AssetImageJobName } from "./image-queue";
import { buildConnection } from "./queue";
import { generateAssetImageViaJava } from "../../lib/java-image-gen";
import { setAssetImageStatus } from "../../lib/asset-image-status";
import { javaRequest, type StoryosContext } from "../../lib/workspace-client";

const LOG_PREFIX = "[image-worker]";

/**
 * Structured log line for a job phase. Keeps output grep-friendly and
 * machine-parseable (k=v pairs) — easy to lift into Sentry/Grafana/Loki
 * later without changing the call sites.
 */
function logJob(
  level: "info" | "warn" | "error",
  phase: string,
  ctx: Record<string, unknown>,
  message?: string
) {
  const fields = { phase, ...ctx };
  const pairs = Object.entries(fields)
    .map(([k, v]) => {
      if (v === undefined || v === null) return null;
      if (typeof v === "string") return `${k}="${v.replace(/"/g, '\\"').slice(0, 200)}"`;
      if (typeof v === "number" || typeof v === "boolean") return `${k}=${v}`;
      return `${k}=${JSON.stringify(v).slice(0, 200)}`;
    })
    .filter(Boolean)
    .join(" ");
  const line = `${LOG_PREFIX} ${pairs}${message ? ` msg="${message}"` : ""}`;
  // eslint-disable-next-line no-console
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
}

export type AssetImageWorker = Worker<AssetImageJobData, unknown, AssetImageJobName>;

export function startImageWorker(opts: { concurrency?: number } = {}): AssetImageWorker {
  return new Worker<AssetImageJobData, unknown, AssetImageJobName>(
    IMAGE_QUEUE_NAME,
    async (job) => handleImageJob(job),
    {
      connection: buildConnection(),
      // Phase 1 target: 16 parallel image gens. Replicate default account
      // concurrent-prediction limit is 50, so we have headroom even if
      // multiple workers share the queue.
      concurrency: opts.concurrency ?? 16,
    }
  );
}

async function handleImageJob(job: Job<AssetImageJobData, unknown, AssetImageJobName>) {
  const { projectId, assetType, assetId, prompt, assetName, ctx } = job.data;
  const jobId = job.id ?? "unknown";
  const attempt = job.attemptsMade + 1; // 1-indexed for log readability
  const promptPreview = prompt.slice(0, 80) + (prompt.length > 80 ? "…" : "");

  const baseCtx = {
    jobId,
    attempt,
    projectId,
    assetType,
    assetId,
    assetName,
    userId: ctx.userId,
  };

  logJob("info", "start", { ...baseCtx, promptPreview });
  const started = Date.now();

  // 1. Flip to generating. Idempotent: re-running the same job id on a
  // BullMQ retry will just overwrite the same hash field.
  await setAssetImageStatus(projectId, assetType, assetId, { status: "generating" });

  let ossPath: string;
  const genStart = Date.now();
  try {
    // Java's generate endpoint handles model inference + OSS upload + path
    // assignment in one synchronous call (blocks 5-30s while the image is
    // generated). We don't need Replicate or direct OSS access — Java owns
    // credentials, billing attribution, and safety filters.
    ossPath = await generateAssetImageViaJava(ctx, {
      assetType,
      assetId,
      prompt,
    });
    logJob("info", "generate_success", {
      ...baseCtx,
      durationMs: Date.now() - genStart,
      ossPath,
    });
  } catch (err) {
    const status = classifyFailure(err);
    const message = err instanceof Error ? err.message : String(err);
    logJob("error", "generate_failed", {
      ...baseCtx,
      durationMs: Date.now() - genStart,
      classification: status,
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage: message,
      willRetry: attempt < (job.opts.attempts ?? 1),
    });
    await setAssetImageStatus(projectId, assetType, assetId, {
      status,
      error: truncate(message, 400),
    });
    // TODO: Sentry.captureException(err, { tags: { ...baseCtx, phase: "generate" } });
    throw err;
  }

  // 2. Persist to Java.
  const updateStart = Date.now();
  try {
    await updateAssetImage(ctx, assetType, assetId, assetName, ossPath);
    logJob("info", "java_update_success", {
      ...baseCtx,
      durationMs: Date.now() - updateStart,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logJob("error", "java_update_failed", {
      ...baseCtx,
      durationMs: Date.now() - updateStart,
      ossPath,
      errorName: err instanceof Error ? err.name : typeof err,
      errorMessage: message,
      willRetry: attempt < (job.opts.attempts ?? 1),
    });
    await setAssetImageStatus(projectId, assetType, assetId, {
      status: "failed_upload",
      error: truncate(`Java update failed: ${message}`, 400),
      imageUrl: ossPath,
    });
    // TODO: Sentry.captureException(err, { tags: { ...baseCtx, phase: "java_update" } });
    throw err;
  }

  // 3. Mark ready.
  await setAssetImageStatus(projectId, assetType, assetId, {
    status: "ready",
    imageUrl: ossPath,
  });
  logJob("info", "ready", {
    ...baseCtx,
    totalDurationMs: Date.now() - started,
    ossPath,
  });
}

async function updateAssetImage(
  ctx: StoryosContext,
  assetType: "role" | "scene" | "prop",
  assetId: string,
  assetName: string,
  ossPath: string
): Promise<void> {
  // Java's update endpoints validate required fields (at minimum `name`)
  // even when we only want to patch the image path — so we have to echo
  // the name back. Name comes from the job payload (role_phase commit
  // passes the committed name; user-initiated retries pass it from the
  // frontend panel which already has the record loaded).
  const endpoint = `/api/user/world/update/world${assetType}`;
  const imgField =
    assetType === "role" ? "roleImgPath" : assetType === "scene" ? "sceneImgPath" : "propImgPath";

  await javaRequest<unknown>(ctx, endpoint, {
    data: {
      id: assetId,
      name: assetName,
      [imgField]: [ossPath],
    },
  });
}

function classifyFailure(err: unknown): "failed_config" | "failed_policy" | "failed_server" {
  if (err instanceof Error) {
    const msg = err.message;
    // Java returns "Unauthorized"/"401" when the caller's session is
    // dropped mid-flight — that's a config / auth issue, not a user
    // retryable server error.
    if (/unauthorized|401|no cookie|not login/i.test(msg)) return "failed_config";
    // Rate limit / quota — must be checked BEFORE the content-policy branch
    // because upstream 429 messages often include the word "policy" (e.g.
    // "throttling policy exceeded" / "rate limit policy") which used to
    // steal the classification and mask the real cause. AliCloud's specific
    // code is `Throttling.RateQuota`; Tongyi / DashScope use `RateLimit`.
    if (
      /\b429\b/.test(msg) ||
      /rate[- ]?limit|too many requests|throttling|rate[\s._-]*quota/i.test(msg) ||
      /quota (?:exceeded|used up)|daily limit|请求频繁|请求过于频繁|额度(?:不足|用完)/i.test(msg)
    ) {
      return "failed_server";
    }
    // Java's safety filter messages typically mention these terms. Regex
    // tightened to "content policy" (not just "policy") so rate-limit
    // wording above can't match here.
    if (/nsfw|safety|content\s*policy|moderation|违规|敏感|不合规|违禁/i.test(msg)) {
      return "failed_policy";
    }
  }
  return "failed_server";
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
