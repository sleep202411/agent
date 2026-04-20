/**
 * BullMQ worker — consumes `run` and `resume` jobs and delegates to Mastra's
 * workflow runtime. Kept thin on purpose: anything interesting (state, events,
 * retries) lives in Mastra or in our state module.
 *
 * Runs in a standalone Node process started by `apps/agent/src/worker.ts`.
 * For small deployments the worker can also be started in-process alongside
 * the Mastra API server — same `startWorker()` entry point.
 */
import { Worker, type Job } from "bullmq";
import type { Mastra } from "@mastra/core/mastra";
import { RequestContext } from "@mastra/core/request-context";
import { clearCancel, isCancelled, setStatus } from "./state";
import { buildConnection, QUEUE_NAME, type StoryosJobData, type StoryosJobName } from "./queue";
import { WorkflowCancelledError } from "./progress";
import { classifyError } from "../../lib/error-classifier";
import { publishWorkflowFailed } from "../../lib/workflow-messages";
import type { ResumeJobData, RunJobData } from "./types";
import { WORKFLOW_NAMES, type WorkflowName } from "../../lib/redis-keys";
import type { StoryosContext } from "../../lib/workspace-client";

export type WorkflowEngineWorker = Worker<StoryosJobData, unknown, StoryosJobName>;

export function startWorker(opts: { mastra: Mastra; concurrency?: number }): WorkflowEngineWorker {
  return new Worker<StoryosJobData, unknown, StoryosJobName>(
    QUEUE_NAME,
    async (job) => {
      if (job.name === "run") {
        await handleRun(opts.mastra, job as Job<RunJobData, unknown, "run">);
      } else if (job.name === "resume") {
        await handleResume(opts.mastra, job as Job<ResumeJobData, unknown, "resume">);
      } else {
        throw new Error(`Unknown job name: ${job.name}`);
      }
    },
    {
      connection: buildConnection(),
      concurrency: opts.concurrency ?? 4,
    }
  );
}

async function handleRun(mastra: Mastra, job: Job<RunJobData, unknown, "run">): Promise<void> {
  const { runId, workflowName, inputData, ctx } = job.data;

  if (await isCancelled(runId)) {
    await finalizeCancelled(runId, workflowName, ctx.projectId);
    return;
  }

  const workflow = getWorkflow(mastra, workflowName);

  await setStatus(runId, "running");

  try {
    const run = await workflow.createRun({ runId });
    const result = await run.start({
      inputData,
      requestContext: buildRequestContext(ctx, runId),
    });
    await applyResult(runId, result, workflowName, ctx.projectId);
  } catch (err) {
    await applyError(runId, err, workflowName, ctx.projectId);
  }
}

async function handleResume(
  mastra: Mastra,
  job: Job<ResumeJobData, unknown, "resume">
): Promise<void> {
  const { runId, workflowName, resumeData, stepId, ctx } = job.data;

  if (await isCancelled(runId)) {
    await finalizeCancelled(runId, workflowName, ctx.projectId);
    return;
  }

  const workflow = getWorkflow(mastra, workflowName);

  await setStatus(runId, "running");

  try {
    const run = await workflow.createRun({ runId });
    const result = await run.resume({
      resumeData,
      ...(stepId ? { step: stepId } : {}),
    });
    await applyResult(runId, result, workflowName, ctx.projectId);
  } catch (err) {
    await applyError(runId, err, workflowName, ctx.projectId);
  }
}

/**
 * Terminal cancellation path shared by handleRun / handleResume (when the
 * job fires already-cancelled) and applyError (WorkflowCancelledError).
 * Updates internal state AND publishes a workflow_failed chat message so the
 * frontend composer pill can clear — without this the "工作中..." pill sticks
 * forever because useSyncActiveWorkflow only clears on workflow_failed/completed
 * card renders.
 */
async function finalizeCancelled(
  runId: string,
  workflowName: WorkflowName,
  projectId: string
): Promise<void> {
  await setStatus(runId, "cancelled");
  await clearCancel(runId);
  try {
    await publishWorkflowFailed(projectId, runId, workflowName, {
      terminalStatus: "cancelled",
      error: "用户已取消",
      retryable: true,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[worker] publishWorkflowFailed(cancelled) failed for ${runId}:`, err);
  }
}

async function finalizeFailed(
  runId: string,
  workflowName: WorkflowName,
  projectId: string,
  error: string,
  classification: ReturnType<typeof classifyError>
): Promise<void> {
  try {
    await publishWorkflowFailed(projectId, runId, workflowName, {
      terminalStatus: "failed",
      error,
      classification,
      retryable: classification !== "content_policy" && classification !== "invalid_input",
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[worker] publishWorkflowFailed(failed) failed for ${runId}:`, err);
  }
}

function getWorkflow(mastra: Mastra, name: string) {
  const wf = mastra.getWorkflowById(name) ?? mastra.getWorkflow(name as never);
  if (!wf) throw new Error(`Workflow not registered in Mastra: ${name}`);
  return wf;
}

function buildRequestContext(ctx: StoryosContext, runId: string): RequestContext {
  const rc = new RequestContext();
  rc.set("cookie", ctx.cookie);
  rc.set("userId", ctx.userId);
  rc.set("projectId", ctx.projectId);
  if (ctx.worldId) rc.set("worldId", ctx.worldId);
  if (ctx.episodeId) rc.set("episodeId", ctx.episodeId);
  if (ctx.locale) rc.set("locale", ctx.locale);
  if (ctx.acceptLanguage) rc.set("acceptLanguage", ctx.acceptLanguage);
  rc.set("runId", runId); // So steps can call reportProgress(runId, ...)
  return rc;
}

async function applyResult(
  runId: string,
  result: unknown,
  workflowName: WorkflowName,
  projectId: string
): Promise<void> {
  // We keep this boundary loose: Mastra's WorkflowResult type varies with
  // generic parameters and evolves across minor versions. We care about the
  // `status` tag and a handful of fields — access them defensively.
  const r = (result ?? {}) as { status?: string; [k: string]: unknown };

  if (r.status === "success") {
    await setStatus(runId, "completed", { result: r.result });
    await clearCancel(runId);
    return;
  }
  if (r.status === "suspended") {
    await setStatus(runId, "suspended", { suspendPayload: r.suspendPayload });
    return;
  }
  if (r.status === "failed") {
    const message = formatWorkflowError(r.error);
    const classification = classifyError(r.error ?? message);
    // When the outer workflow is a composition (e.g. main_flow) and the
    // failure came from a sub-workflow step, use the sub-workflow's name
    // on the failed card so the user's "重试" button re-invokes that
    // specific phase rather than the whole pipeline from scratch.
    const failingWorkflow = resolveFailingWorkflow(r.error, workflowName);
    await setStatus(runId, "failed", { error: message, errorClassification: classification });
    await clearCancel(runId);
    await finalizeFailed(runId, failingWorkflow, projectId, message, classification);
    return;
  }
  // tripwire / paused / anything unexpected — log and mark failed so the run
  // doesn't sit forever in "running".
  const unexpectedMsg = `Unexpected workflow status: ${r.status ?? "undefined"}`;
  await setStatus(runId, "failed", {
    error: unexpectedMsg,
    errorClassification: "unknown",
  });
  await finalizeFailed(runId, workflowName, projectId, unexpectedMsg, "unknown");
}

async function applyError(
  runId: string,
  err: unknown,
  workflowName: WorkflowName,
  projectId: string
): Promise<void> {
  if (err instanceof WorkflowCancelledError) {
    await finalizeCancelled(runId, workflowName, projectId);
    return;
  }
  const message = formatWorkflowError(err);
  const classification = classifyError(err);
  const failingWorkflow = resolveFailingWorkflow(err, workflowName);
  await setStatus(runId, "failed", { error: message, errorClassification: classification });
  await clearCancel(runId);
  await finalizeFailed(runId, failingWorkflow, projectId, message, classification);
}

/**
 * When the outer workflow is a composition like main_flow, a step failure
 * bubbles up with a `stepId` pointing at the sub-workflow that actually
 * blew up. Surface that as the failed card's workflowName so the "重试"
 * button re-invokes only that phase (storyboard_phase etc) — retrying
 * main_flow from scratch would re-run every already-committed phase
 * and waste LLM tokens. If no stepId matches a known workflow, fall
 * back to the outer name.
 */
function resolveFailingWorkflow(err: unknown, fallback: WorkflowName): WorkflowName {
  if (!err || typeof err !== "object") return fallback;
  const e = err as Record<string, unknown>;
  const candidates: unknown[] = [e.stepId, e.stepPath];
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      if ((WORKFLOW_NAMES as readonly string[]).includes(candidate)) {
        return candidate as WorkflowName;
      }
    }
    if (Array.isArray(candidate)) {
      // Look for the deepest step that matches a known workflow name —
      // e.g. stepPath might be ["main_flow", "storyboard_phase",
      // "generate"], we want "storyboard_phase".
      for (let i = candidate.length - 1; i >= 0; i--) {
        const v = candidate[i];
        if (
          typeof v === "string" &&
          v !== fallback &&
          (WORKFLOW_NAMES as readonly string[]).includes(v)
        ) {
          return v as WorkflowName;
        }
      }
    }
  }
  return fallback;
}

/**
 * Mastra's workflow result returns `error` as an object on step failure —
 * typically `{ message, stack, stepId, ... }`. Plain `String(obj)` gives
 * "[object Object]" which is useless when diagnosing real failures. Walk
 * common shapes to surface a human-readable message before falling back.
 */
function formatWorkflowError(err: unknown): string {
  if (err == null) return "unknown error";
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.message === "string" && e.message.length > 0) return e.message;
    if (typeof e.error === "string" && e.error.length > 0) return e.error;
    if (e.error && typeof e.error === "object") {
      const inner = e.error as { message?: unknown };
      if (typeof inner.message === "string") return inner.message;
    }
    try {
      return JSON.stringify(err).slice(0, 500);
    } catch {
      /* cyclic */
    }
  }
  return String(err);
}
