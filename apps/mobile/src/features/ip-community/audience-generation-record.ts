import { z } from "zod";
import { getAuthGeneration } from "@/auth/auth-store";
import { durableRecord, type DurableRecord } from "@/lib/durable-record";
import { api } from "@/lib/api-client";

const attemptSchema = z.object({
  key: z.string().min(1).max(128),
  ipId: z.string().min(1),
  templateId: z.string().min(1),
  templateName: z.string(),
  referenceImageAssetId: z.string().optional(),
  jobId: z.string().min(1).optional(),
});
export type AudienceAttempt = z.infer<typeof attemptSchema>;
const envelope = z.object({ version: z.literal(1), attempt: attemptSchema.nullable() });
export function audienceGenerationRecord(
  ipId: string,
  userId: string,
  generation: number,
  storage: DurableRecord = durableRecord("audience-generation", userId, ipId)
) {
  const guard = () => {
    if (generation !== getAuthGeneration()) throw new Error("Generation session expired.");
  };
  const read = () => {
    guard();
    const raw = storage.read();
    const value = raw === null ? null : envelope.parse(JSON.parse(raw)).attempt;
    if (value && value.ipId !== ipId) throw new Error("Generation record does not match this IP.");
    return value;
  };
  const write = (attempt: AudienceAttempt | null) =>
    storage.write(JSON.stringify({ version: 1, attempt }));
  return {
    read,
    create(value: AudienceAttempt) {
      guard();
      const next = attemptSchema.parse(value);
      if (next.ipId !== ipId || read())
        throw new Error("An existing generation must be recovered first.");
      write(next);
      return next;
    },
    acknowledge(key: string, jobId: string) {
      z.string().min(1).parse(jobId);
      const prior = read();
      if (!prior || prior.key !== key || (prior.jobId && prior.jobId !== jobId))
        throw new Error("Generation receipt does not match the saved request.");
      const next = attemptSchema.parse({ ...prior, jobId });
      write(next);
      return next;
    },
    clear(key: string) {
      const prior = read();
      if (prior?.key !== key) throw new Error("Generation receipt changed. Reopen this IP.");
      write(null);
    },
  };
}
/** Lookup only: audience templates can change models, so a same-key POST is
 * not a safe retry (the canonical server deduplicates by user + model + key). */
export async function recoverAudienceJob(attempt: AudienceAttempt, signal: AbortSignal) {
  const result = z
    .object({
      jobs: z.array(
        z.object({ id: z.string().min(1), idempotencyKey: z.string(), sourceSurface: z.string() })
      ),
    })
    .parse(
      await api.get("/ai/jobs", {
        service: "aurora",
        retry: false,
        signal,
        params: { idempotencyKey: attempt.key, sourceSurface: "ip_audience_generation", limit: 80 },
      })
    );
  if (
    result.jobs.some(
      (job) => job.idempotencyKey !== attempt.key || job.sourceSurface !== "ip_audience_generation"
    ) ||
    result.jobs.length > 1
  )
    throw new Error("Generation receipts need review; no new job was started.");
  return result.jobs[0]?.id ?? null;
}
