import { z } from "zod";
import { getGenerationJob, generationSession } from "@/features/ai-lab/jobs-api";
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
  const cards: { nodeId: string; jobId: string; type: string }[] = [];
  const types: Record<string, string> = { prompt: "image", video: "video", audio: "audio" };
  for (const [nodeId, raw] of Object.entries(loaded.snapshot.nodes)) {
    const node = raw as {
      id?: unknown;
      type?: unknown;
      data?: { generation?: { jobId?: unknown } };
    } | null;
    if (!node || typeof node.type !== "string" || !Object.hasOwn(types, node.type)) continue;
    const jobId = node.data?.generation?.jobId;
    if (jobId == null) continue;
    if (node.id !== nodeId) throw Error("Canvas generation card identity mismatch.");
    cards.push({ nodeId, jobId: z.string().uuid().parse(jobId), type: types[node.type]! });
  }
  if (!cards.length) return [];
  await readStoryCanvasDocument(scope, scope.documentId, signal);
  generationSession(scope.generation, signal);
  const jobs: CanvasGenerationJob[] = [];
  for (let start = 0; start < cards.length; start += 4) {
    const batch = await Promise.all(
      cards.slice(start, start + 4).map(async (card) => {
        const job = await getGenerationJob(card.jobId, scope.generation, signal);
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
    jobs.push(...batch);
  }
  return jobs;
}
