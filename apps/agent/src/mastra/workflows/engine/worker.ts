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
import { appendEvent, clearCancel, isCancelled, setStatus } from "./state";
import { buildConnection, QUEUE_NAME, type StoryosJobData, type StoryosJobName } from "./queue";
import { WorkflowCancelledError } from "./progress";
import { classifyError } from "../../lib/error-classifier";
import type { ResumeJobData, RunJobData } from "./types";
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
    await setStatus(runId, "cancelled");
    return;
  }

  const workflow = getWorkflow(mastra, workflowName);

  await setStatus(runId, "running");
  await appendEvent(runId, "started", { workflowName });

  try {
    const run = await workflow.createRun({ runId });
    const result = await run.start({
      inputData,
      requestContext: buildRequestContext(ctx, runId),
    });
    await applyResult(runId, result);
  } catch (err) {
    await applyError(runId, err);
  }
}

async function handleResume(
  mastra: Mastra,
  job: Job<ResumeJobData, unknown, "resume">
): Promise<void> {
  const { runId, workflowName, resumeData, stepId, ctx } = job.data;

  if (await isCancelled(runId)) {
    await setStatus(runId, "cancelled");
    return;
  }

  const workflow = getWorkflow(mastra, workflowName);

  await setStatus(runId, "running");
  await appendEvent(runId, "resumed", { stepId });

  try {
    const run = await workflow.createRun({ runId });
    const result = await run.resume({
      resumeData,
      ...(stepId ? { step: stepId } : {}),
    });
    await applyResult(runId, result);
  } catch (err) {
    await applyError(runId, err);
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

async function applyResult(runId: string, result: unknown): Promise<void> {
  // We keep this boundary loose: Mastra's WorkflowResult type varies with
  // generic parameters and evolves across minor versions. We care about the
  // `status` tag and a handful of fields — access them defensively.
  const r = (result ?? {}) as { status?: string; [k: string]: unknown };

  if (r.status === "success") {
    await setStatus(runId, "completed", { result: r.result });
    await appendEvent(runId, "completed", { status: "success" });
    await clearCancel(runId);
    return;
  }
  if (r.status === "suspended") {
    await setStatus(runId, "suspended", { suspendPayload: r.suspendPayload });
    await appendEvent(runId, "suspended", {
      suspended: r.suspended,
      suspendPayload: r.suspendPayload,
    });
    return;
  }
  if (r.status === "failed") {
    const message = formatWorkflowError(r.error);
    const classification = classifyError(r.error ?? message);
    await setStatus(runId, "failed", { error: message, errorClassification: classification });
    await appendEvent(runId, "failed", { error: message, classification });
    await clearCancel(runId);
    return;
  }
  // tripwire / paused / anything unexpected — log and mark failed so the run
  // doesn't sit forever in "running".
  const unexpectedMsg = `Unexpected workflow status: ${r.status ?? "undefined"}`;
  await setStatus(runId, "failed", {
    error: unexpectedMsg,
    errorClassification: "unknown",
  });
  await appendEvent(runId, "failed", { status: r.status, classification: "unknown" });
}

async function applyError(runId: string, err: unknown): Promise<void> {
  if (err instanceof WorkflowCancelledError) {
    await setStatus(runId, "cancelled");
    await appendEvent(runId, "cancelled");
    await clearCancel(runId);
    return;
  }
  const message = formatWorkflowError(err);
  const classification = classifyError(err);
  await setStatus(runId, "failed", { error: message, errorClassification: classification });
  await appendEvent(runId, "failed", { error: message, classification });
  await clearCancel(runId);
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
