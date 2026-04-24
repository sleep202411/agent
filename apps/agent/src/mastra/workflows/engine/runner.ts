/**
 * Public API for starting, resuming, cancelling, and inspecting workflow runs.
 * These are the only entry points that the router agent's meta-tools and the
 * HTTP routes (`/workflow/:runId/*`) should use.
 */
import { randomUUID } from "node:crypto";
import type { StoryosContext } from "../../lib/workspace-client";
import type { WorkflowName } from "../../lib/redis-keys";
import {
  getMeta,
  listWorkflowsByUser,
  listWorkflowsByWorkspace,
  patchMeta,
  putMeta,
  requestCancel,
  setStatus,
} from "./state";
import { getQueue } from "./queue";
import { publishWorkflowFailed } from "../../lib/workflow-messages";
import type { ResumeJobData, RunJobData, WorkflowMeta } from "./types";

export async function startWorkflow(input: {
  workflowName: WorkflowName;
  inputData: unknown;
  ctx: StoryosContext;
}): Promise<{ runId: string }> {
  const runId = randomUUID();
  const now = Date.now();
  const meta: WorkflowMeta = {
    runId,
    workflowName: input.workflowName,
    workspaceId: input.ctx.projectId,
    userId: input.ctx.userId,
    status: "queued",
    startedAt: now,
    updatedAt: now,
  };
  await putMeta(meta);

  const jobData: RunJobData = {
    runId,
    workflowName: input.workflowName,
    inputData: input.inputData,
    ctx: input.ctx,
  };
  // BullMQ rejects `:` in custom job ids, so we use `-` as the separator.
  await getQueue().add("run", jobData, { jobId: `run-${runId}` });

  return { runId };
}

export async function resumeWorkflow(input: {
  runId: string;
  resumeData: unknown;
  stepId?: string;
  ctx: StoryosContext;
}): Promise<void> {
  const meta = await getMeta(input.runId);
  if (!meta) throw new Error(`Workflow run not found: ${input.runId}`);
  // Idempotent for non-suspended states — the frontend double-click, WS
  // replay, or stale UI can all re-fire confirm after the run has already
  // transitioned. Throwing 500 in those cases surfaces a scary red toast
  // for what is effectively a no-op.
  if (meta.status === "completed") return;
  if (meta.status === "failed" || meta.status === "cancelled") return;
  if (meta.status === "queued" || meta.status === "running") {
    // Another resume is already in flight (or already ran); don't enqueue
    // a second one — that would step on Mastra's internal state.
    return;
  }
  if (meta.status !== "suspended") {
    throw new Error(
      `Workflow run ${input.runId} is in unknown status=${meta.status}; cannot resume`
    );
  }

  await patchMeta(input.runId, { status: "queued" });

  const jobData: ResumeJobData = {
    runId: input.runId,
    workflowName: meta.workflowName,
    resumeData: input.resumeData,
    stepId: input.stepId,
    ctx: input.ctx,
  };
  // JobId uses a counter-safe suffix so multiple resumes don't collide.
  // `-` instead of `:` because BullMQ rejects colons in custom ids.
  await getQueue().add("resume", jobData, {
    jobId: `resume-${input.runId}-${Date.now()}`,
  });
}

export async function cancelWorkflow(runId: string): Promise<void> {
  const meta = await getMeta(runId);
  if (!meta) throw new Error(`Workflow run not found: ${runId}`);
  if (meta.status === "completed" || meta.status === "failed" || meta.status === "cancelled") {
    return; // idempotent — already in a terminal state
  }
  await requestCancel(runId);
  await setStatus(runId, "cancelled");

  // Publish workflow_failed chat message immediately so the frontend's
  // composer pill can clear right away. The worker's later
  // finalizeCancelled (when throwIfCancelled fires mid-run) will publish
  // with the same deterministic message id (`wf_{runId}_cancelled`) and
  // become an idempotent update — no duplicate card.
  try {
    await publishWorkflowFailed(meta.workspaceId, runId, meta.workflowName, {
      terminalStatus: "cancelled",
      error: "User cancelled",
      retryable: true,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[runner] publishWorkflowFailed(cancelled) failed for ${runId}:`, err);
  }
}

export async function getWorkflowStatus(runId: string): Promise<WorkflowMeta | null> {
  return getMeta(runId);
}

export async function listUserWorkflows(userId: string, limit?: number): Promise<WorkflowMeta[]> {
  return listWorkflowsByUser(userId, { limit });
}

export async function listWorkspaceWorkflows(
  workspaceId: string,
  limit?: number
): Promise<WorkflowMeta[]> {
  return listWorkflowsByWorkspace(workspaceId, { limit });
}
