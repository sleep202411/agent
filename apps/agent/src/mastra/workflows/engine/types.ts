import type { ErrorClassification } from "@repo/shared";
import type { WorkflowName } from "../../lib/redis-keys";
import type { StoryosContext } from "../../lib/workspace-client";

export type WorkflowStatus =
  | "queued"
  | "running"
  | "suspended"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Our side's view of a workflow run — a summary of what's happening, separate
 * from Mastra's internal snapshot (which stores the full step execution state
 * in the configured `storage` adapter).
 *
 * We keep this light and safe-to-expose because it flows into the task card
 * UI. Full tool outputs, LLM responses, tokens etc. stay in Mastra's storage.
 */
export type WorkflowMeta = {
  runId: string;
  workflowName: WorkflowName;
  workspaceId: string;
  userId: string;
  status: WorkflowStatus;
  /** Workflow step id currently executing (or last-executed for suspended/completed). */
  currentStep?: string;
  /** UI progress indicator; steps update this via setProgress(). */
  progress?: { current: number; total: number; label?: string };
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
  /**
   * Categorized error for the UI layer — lets us show "服务繁忙，请稍后
   *重试" instead of a raw "DeepSeek 429" string. Raw `error` is still
   * available for copy/debug. See packages/shared/src/error-classification.ts.
   */
  errorClassification?: ErrorClassification;
  /** Populated when status=suspended — what the resume UI should present. */
  suspendPayload?: unknown;
  /** Populated when status=completed — workflow's final output. */
  result?: unknown;
  /**
   * Last time the owning client signalled it was still watching this run.
   * Used by the stale-run reaper: if a queued/running run hasn't been
   * heartbeated in HEARTBEAT_GRACE_MS, the reaper assumes the user closed
   * the page and cancels the run to free its worker slot.
   *
   * Set to `startedAt` at dispatch so a fresh run has the full grace
   * window before it's eligible for reaping.
   */
  lastHeartbeatAt?: number;
};

/**
 * Data carried on a BullMQ "run" job — the worker picks this up and calls
 * `mastra.getWorkflow(workflowName).createRun({runId}).start({inputData})`.
 */
export type RunJobData = {
  runId: string;
  workflowName: WorkflowName;
  inputData: unknown;
  /** Storyos-specific context reconstructed into RequestContext by the worker. */
  ctx: StoryosContext;
};

/** Data carried on a "resume" job for a suspended run. */
export type ResumeJobData = {
  runId: string;
  workflowName: WorkflowName;
  resumeData: unknown;
  /** Optional step id; Mastra infers the suspended step if omitted. */
  stepId?: string;
  ctx: StoryosContext;
};
