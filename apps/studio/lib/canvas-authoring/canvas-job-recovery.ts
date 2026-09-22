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
  if (!generation) return false;
  // A completed receipt without an output is not a usable terminal result. It
  // can happen when the completion event races the output read, so keep the
  // job eligible for the authoritative list endpoint to hydrate its outputs.
  return (
    !isTerminalGenerationStatus(generation.status) ||
    (generation.status === "done" && (generation.outputs?.length ?? 0) === 0)
  );
}

function jobTypeForNode(node: CanvasNodeShape): FizzAiJobView["type"] | undefined {
  if (node.type === "prompt") return "image";
  if (node.type === "video") return "video";
  if (node.type === "audio") return "audio";
  return undefined;
}

export function matchesCanvasJob(node: CanvasNodeShape, job: FizzAiJobView): boolean {
  const data = node.data as { generation?: GenerationState; modelId?: string };
  const generation = data.generation;
  // A full node replacement can erase the client-side generation projection
  // while the authoritative job and its asset remain intact. A missing
  // projection is recoverable only with all three stable identities: exact
  // block, modality, and model. This prevents an old or adjacent job from
  // being attached to an empty card.
  if (!generation) {
    return (
      node.id === job.documentBlockId &&
      data.modelId === job.modelId &&
      job.type === jobTypeForNode(node)
    );
  }
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
