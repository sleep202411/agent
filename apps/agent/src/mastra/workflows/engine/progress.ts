/**
 * Helpers used *inside* workflow steps to report progress and cooperatively
 * check for cancellation. Workflows import these; the engine's runner layer
 * doesn't — it only writes lifecycle events (queued/started/completed/etc.).
 */
import { isCancelled, patchMeta } from "./state";
import type { WorkflowMeta } from "./types";

export class WorkflowCancelledError extends Error {
  constructor(runId: string) {
    super(`Workflow run ${runId} was cancelled by user`);
    this.name = "WorkflowCancelledError";
  }
}

export type ProgressUpdate = {
  stepId?: string;
  current?: number;
  total?: number;
  label?: string;
};

/**
 * Update the task card UI with step progress. Safe to call frequently;
 * callers should still avoid firing it inside tight inner loops.
 */
export async function reportProgress(runId: string, update: ProgressUpdate): Promise<void> {
  const patch: Partial<WorkflowMeta> = {};
  if (update.stepId) patch.currentStep = update.stepId;
  if (update.current !== undefined && update.total !== undefined) {
    patch.progress = {
      current: update.current,
      total: update.total,
      label: update.label,
    };
  }
  if (Object.keys(patch).length > 0) {
    await patchMeta(runId, patch);
  }
}

/**
 * Cooperative cancellation check. Call at step boundaries and before expensive
 * operations; throws `WorkflowCancelledError` which is caught by the engine's
 * worker and translated to status=cancelled.
 */
export async function throwIfCancelled(runId: string): Promise<void> {
  if (await isCancelled(runId)) {
    throw new WorkflowCancelledError(runId);
  }
}
