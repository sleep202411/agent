import type { CanvasNodeShape } from "@/lib/canvas-core/types";
import { ApiRequestError } from "@/lib/api";
import {
  isTerminalGenerationStatus,
  type FizzAiJobView,
  type GenerationState,
} from "./generation-api";

/** A lost response is not proof that the server rejected a paid operation. */
export function isUncertainSubmission(error: unknown): boolean {
  return (
    !(error instanceof ApiRequestError) ||
    error.status === 0 ||
    error.status >= 500 ||
    error.status === 408
  );
}

export function needsJobRecovery(generation: GenerationState | undefined): boolean {
  return !!generation && !isTerminalGenerationStatus(generation.status);
}

export function matchesCanvasJob(node: CanvasNodeShape, job: FizzAiJobView): boolean {
  const data = node.data as { generation?: GenerationState; modelId?: string };
  const generation = data.generation;
  if (!generation) return false;
  if (generation.jobId) return generation.jobId === job.id;
  if (generation.submissionKey) return generation.submissionKey === job.idempotencyKey;
  // Recover existing cards that predate durable submission receipts. Never
  // replace a settled result or attach another model's run to this card.
  return (
    needsJobRecovery(generation) && node.id === job.documentBlockId && data.modelId === job.modelId
  );
}

/** Slow responses from an earlier attempt must never replace a newer run. */
export function acceptsSubmissionResponse(
  generation: GenerationState | undefined,
  key: string
): boolean {
  return generation?.submissionKey === key && !isTerminalGenerationStatus(generation.status);
}
