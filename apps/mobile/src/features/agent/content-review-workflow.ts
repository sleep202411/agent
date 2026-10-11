import { z } from "zod";
import {
  CONTENT_REVIEW_MAX_DURATION_SECONDS,
  contentReviewCreditsForDurationSeconds,
} from "@repo/shared";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord } from "@/lib/durable-record";
import { durableRecordKey } from "@/lib/durable-record-key";
import {
  chargeContentReview,
  reconcileContentReviewCharge,
  submitContentReview,
  queryContentReview,
  saveContentReview,
  reviewResultSchema,
} from "./api/content-review-jobs-api";
import {
  createReviewUploadCheckpoint,
  uploadReviewVideo,
  type ReviewVideoSource,
} from "./content-review-upload";
import { reviewUploadStorage } from "./review-upload-storage";
import { withReviewWorkflowLock } from "./review-workflow-lock";
const uuid = z.string().uuid();
const phases = z.enum([
  "ready",
  "charging",
  "charged",
  "uploaded",
  "submitting",
  "reviewing",
  "reviewed",
  "settled",
  "saved",
  "failed",
  "refunding",
  "refunded",
]);
const schema = z
  .object({
    version: z.literal(1),
    scope: z.string(),
    revision: z.number().int().nonnegative(),
    id: uuid,
    uploadId: uuid,
    phase: phases,
    file: z.object({
      name: z.string().min(1).max(256),
      size: z.number().int().positive(),
      contentType: z.enum(["video/mp4", "video/quicktime"]),
    }),
    durationSeconds: z.number().int().min(1).max(CONTENT_REVIEW_MAX_DURATION_SECONDS),
    credits: z.number().int().positive(),
    asset: z
      .object({ mediaAssetId: uuid, storageKey: z.string().min(1), url: z.string().url() })
      .optional(),
    jobId: z.string().min(1).max(512).optional(),
    result: reviewResultSchema.optional(),
    recordId: uuid.optional(),
    failure: z.string().optional(),
  })
  .strict()
  .superRefine((job, ctx) => {
    const require = (ok: boolean) => {
      if (!ok) ctx.addIssue({ code: "custom", message: "Invalid saved review workflow" });
    };
    require(job.credits === contentReviewCreditsForDurationSeconds(job.durationSeconds));
    if (
      ["uploaded", "submitting", "reviewing", "reviewed", "settled", "failed"].includes(job.phase)
    )
      require(!!job.asset);
    if (["reviewing", "reviewed", "settled", "failed"].includes(job.phase)) require(!!job.jobId);
    if (["reviewed", "settled"].includes(job.phase)) require(!!job.result);
    if (job.phase === "saved") require(!!job.recordId);
  });
export type ReviewWorkflow = z.infer<typeof schema>;
const terminal = (job: ReviewWorkflow) => job.phase === "saved" || job.phase === "refunded";
export function contentReviewWorkflow(userId: string, workspaceId: string, generation: number) {
  z.string().min(1).parse(userId);
  uuid.parse(workspaceId);
  const scope = durableRecordKey("content-review-workflow", userId, workspaceId);
  const store = durableRecord("content-review-workflow", userId, workspaceId);
  const current = (signal?: AbortSignal) => {
    if (signal?.aborted || generation !== getAuthGeneration())
      throw new Error("Content review session expired");
  };
  function read() {
    current();
    const raw = store.read();
    if (raw === null || raw === "null") return null;
    const job = schema.parse(JSON.parse(raw));
    if (job.scope !== scope) throw new Error("Saved review scope mismatch");
    return job;
  }
  function commit(previous: ReviewWorkflow, changes: Partial<ReviewWorkflow>, signal: AbortSignal) {
    current(signal);
    const actual = read();
    if (actual?.id !== previous.id || actual.revision !== previous.revision)
      throw new Error("Review changed. Reload before continuing");
    const next = schema.parse({ ...previous, ...changes, revision: previous.revision + 1 });
    store.write(JSON.stringify(next));
    return next;
  }
  async function begin(
    ids: { chargeId: string; uploadId: string },
    source: ReviewVideoSource,
    durationSeconds: number
  ) {
    return withReviewWorkflowLock(scope, async () => {
      current();
      const old = read();
      if (old && !terminal(old)) throw new Error("Finish or resolve the existing review first");
      const checkpoint = createReviewUploadCheckpoint(ids.uploadId, workspaceId, userId, source);
      const job = schema.parse({
        version: 1,
        scope,
        revision: 0,
        id: ids.chargeId,
        uploadId: ids.uploadId,
        phase: "ready",
        file: {
          name: checkpoint.fileName,
          size: checkpoint.sizeBytes,
          contentType: checkpoint.contentType,
        },
        durationSeconds,
        credits: contentReviewCreditsForDurationSeconds(durationSeconds),
      });
      // This creates a local intent only. The caller shows its price before run().
      store.write(JSON.stringify(job));
      return job;
    });
  }
  async function run(
    signal: AbortSignal,
    expectedReviewId: string,
    source?: ReviewVideoSource,
    onProgress?: (percent: number) => void
  ) {
    return withReviewWorkflowLock(scope, async () => {
      current(signal);
      let job = read();
      if (!job) throw new Error("No pending review");
      if (job.id !== uuid.parse(expectedReviewId))
        throw new Error("Review changed. Reload and confirm the current review before continuing");
      if (terminal(job)) return job;
      if (job.phase === "submitting")
        throw new Error(
          "The review submission result is unknown. Do not submit again; the original job needs to be recovered"
        );
      if (job.phase === "failed" || job.phase === "refunding") return job;
      if (
        ["ready", "charging", "charged"].includes(job.phase) &&
        (!source ||
          source.name !== job.file.name ||
          source.size !== job.file.size ||
          source.contentType !== job.file.contentType)
      )
        throw new Error("Select the original video to resume uploading");
      const charge = { id: job.id, durationSeconds: job.durationSeconds };
      if (job.phase === "ready") {
        job = commit(job, { phase: "charging" }, signal);
        await chargeContentReview(workspaceId, generation, charge, signal);
        job = commit(job, { phase: "charged" }, signal);
      } else if (job.phase === "charging") {
        // Confirm a possibly completed debit first. Only the explicit not-found contract permits replaying the same idempotent charge.
        try {
          await reconcileContentReviewCharge(workspaceId, generation, charge, "settle", signal);
        } catch (error) {
          if (!isMissingCharge(error)) throw error;
          await chargeContentReview(workspaceId, generation, charge, signal);
        }
        job = commit(job, { phase: "charged" }, signal);
      }
      if (job.phase === "charged") {
        if (
          !source ||
          source.name !== job.file.name ||
          source.size !== job.file.size ||
          source.contentType !== job.file.contentType
        )
          throw new Error("Select the original video to resume uploading");
        const parts = reviewUploadStorage(userId, workspaceId, job.uploadId);
        const checkpoint =
          parts.read() ?? createReviewUploadCheckpoint(job.uploadId, workspaceId, userId, source);
        const asset = await uploadReviewVideo(source, {
          workspaceId,
          userId,
          generation,
          signal,
          checkpoint,
          persist: parts.save,
          onProgress,
        });
        job = commit(job, { phase: "uploaded", asset }, signal);
      }
      if (job.phase === "uploaded") {
        job = commit(job, { phase: "submitting" }, signal);
        const jobId = await submitContentReview(workspaceId, generation, job.asset!.url, signal);
        job = commit(job, { phase: "reviewing", jobId }, signal);
      }
      if (job.phase === "reviewing") {
        const response = await queryContentReview(
          workspaceId,
          generation,
          job.jobId!,
          job.asset!.url,
          signal
        );
        if (response.status === "processing") {
          current(signal);
          return job;
        }
        if (response.status === "failed")
          return commit(job, { phase: "failed", failure: response.message }, signal);
        job = commit(job, { phase: "reviewed", result: response.result }, signal);
      }
      if (job.phase === "reviewed") {
        await reconcileContentReviewCharge(workspaceId, generation, charge, "settle", signal);
        job = commit(job, { phase: "settled" }, signal);
      }
      if (job.phase === "settled") {
        const saved = await saveContentReview(
          workspaceId,
          generation,
          {
            chargeId: job.id,
            mediaAssetId: job.asset!.mediaAssetId,
            durationSeconds: job.durationSeconds,
            creditsCharged: job.credits,
            fileName: job.file.name,
            exportFileName: job.result!.fileName,
            overview: job.result!.overview,
            details: job.result!.details,
          },
          signal
        );
        job = commit(
          job,
          { phase: "saved", recordId: saved.id, asset: undefined, result: undefined },
          signal
        );
        reviewUploadStorage(userId, workspaceId, job.uploadId).clear();
      }
      return job;
    });
  }
  /** Caller explicitly requests cancellation/refund. Never refunds a running or unknown Java job. */
  async function refund(signal: AbortSignal, expectedReviewId: string) {
    return withReviewWorkflowLock(scope, async () => {
      current(signal);
      let job = read();
      if (!job) throw new Error("No pending review");
      if (job.id !== uuid.parse(expectedReviewId))
        throw new Error("Review changed. Reload and confirm the current review before continuing");
      if (job.phase === "refunded") return job;
      if (!["ready", "charging", "charged", "uploaded", "failed", "refunding"].includes(job.phase))
        throw new Error("Resolve the running review before requesting a refund");
      const charge = { id: job.id, durationSeconds: job.durationSeconds };
      if (job.phase === "ready") return commit(job, { phase: "refunded" }, signal);
      if (job.phase === "charging") {
        // A zero refund before an uncertain debit finishes is not proof of cancellation.
        await reconcileContentReviewCharge(workspaceId, generation, charge, "settle", signal);
      }
      job = commit(job, { phase: "refunding" }, signal);
      const receipt = await reconcileContentReviewCharge(
        workspaceId,
        generation,
        charge,
        "release",
        signal
      );
      if (receipt.credits !== job.credits)
        throw new Error("Refund is not yet confirmed. Keep this review for reconciliation");
      job = commit(job, { phase: "refunded", asset: undefined, result: undefined }, signal);
      reviewUploadStorage(userId, workspaceId, job.uploadId).clear();
      return job;
    });
  }
  return { read, begin, run, refund };
}

function isMissingCharge(error: unknown) {
  if (
    !(error instanceof Error) ||
    !("status" in error) ||
    error.status !== 404 ||
    !("responseBody" in error) ||
    typeof error.responseBody !== "string"
  )
    return false;
  try {
    return z
      .object({ code: z.literal("CONTENT_REVIEW_CHARGE_NOT_FOUND") })
      .safeParse(JSON.parse(error.responseBody)).success;
  } catch {
    return false;
  }
}
