import { z } from "zod";
import { api } from "@/lib/api-client";
import { generationJob, getGenerationJob, generationSession } from "@/features/ai-lab/jobs-api";
import {
  canvasGenerationJobSchema,
  type CanvasGenerationJob,
} from "../../../../canvas-editor/generation-schema";
import type { CanvasLoaded } from "../../../../canvas-editor/protocol";
import type { CanvasWriteScope } from "./story-canvas-update";
import { readStoryCanvasDocument } from "./story-canvas-document";

/** Read only jobs already owned by cards in the current materialized document.
 * A missing response never starts/retries a paid job or clears its card receipt. */
export async function loadTrackedCanvasJobs(
  scope: CanvasWriteScope,
  loaded: CanvasLoaded,
  signal: AbortSignal
): Promise<CanvasGenerationJob[]> {
  generationSession(scope.generation, signal);
  if (loaded.documentId !== scope.documentId) throw Error("Canvas generation document mismatch.");
  const cards: { nodeId: string; jobId?: string; submissionKey?: string; type: string }[] = [];
  const types: Record<string, string> = { prompt: "image", video: "video", audio: "audio" };
  for (const [nodeId, raw] of Object.entries(loaded.snapshot.nodes)) {
    const node = raw as {
      id?: unknown;
      type?: unknown;
      data?: { generation?: { jobId?: unknown; submissionKey?: unknown } };
    } | null;
    if (!node || typeof node.type !== "string" || !Object.hasOwn(types, node.type)) continue;
    const jobId = node.data?.generation?.jobId;
    const submissionKey = node.data?.generation?.submissionKey;
    if (jobId == null && submissionKey == null) continue;
    if (node.id !== nodeId) throw Error("Canvas generation card identity mismatch.");
    cards.push({
      nodeId,
      jobId: jobId == null ? undefined : z.string().uuid().parse(jobId),
      submissionKey: submissionKey == null ? undefined : z.string().min(1).parse(submissionKey),
      type: types[node.type]!,
    });
  }
  if (!cards.length) return [];
  await readStoryCanvasDocument(scope, scope.documentId, signal);
  generationSession(scope.generation, signal);
  const jobs: CanvasGenerationJob[] = [];
  for (let start = 0; start < cards.length; start += 4) {
    const batch = await Promise.all(
      cards.slice(start, start + 4).map(async (card) => {
        let job;
        if (card.jobId) job = await getGenerationJob(card.jobId, scope.generation, signal);
        else {
          const response = z
            .object({ jobs: z.array(generationJob), nextCursor: z.string().nullable() })
            .parse(
              await api.get("/ai/jobs", {
                service: "aurora",
                signal,
                retry: false,
                params: {
                  storyProjectId: scope.projectId,
                  documentId: scope.documentId,
                  documentBlockId: card.nodeId,
                  sourceSurface: "fizzstudio-canvas",
                  idempotencyKey: card.submissionKey,
                  limit: 80,
                },
              })
            );
          generationSession(scope.generation, signal);
          if (response.nextCursor || response.jobs.length > 1)
            throw Error("Generation recovery is ambiguous. Keep the saved request and retry.");
          // Empty lookup is not evidence of failure or permission to submit again.
          if (!response.jobs.length) return null;
          job = response.jobs[0]!;
          if (job.idempotencyKey !== card.submissionKey)
            throw Error("Generation recovery does not match the saved request.");
        }
        if (
          job.storyProjectId !== scope.projectId ||
          job.projectId ||
          job.documentId !== scope.documentId ||
          job.documentBlockId !== card.nodeId ||
          job.sourceSurface !== "fizzstudio-canvas" ||
          job.type !== card.type
        )
          throw Error("Generation does not belong to this canvas card.");
        // Runtime uses optional fields rather than the API's nullable metadata.
        const optional = (value: unknown) => (value == null ? undefined : value);
        return canvasGenerationJobSchema.parse({
          ...job,
          progress: optional(job.progress),
          queuePosition: optional(job.queuePosition),
          estimatedTotalSeconds: optional(job.estimatedTotalSeconds),
          error: optional(job.error),
          outputs: job.outputs.map((output) =>
            Object.fromEntries(Object.entries(output).filter(([, value]) => value != null))
          ),
        });
      })
    );
    generationSession(scope.generation, signal);
    jobs.push(...batch.filter((job): job is CanvasGenerationJob => job !== null));
  }
  return jobs;
}
