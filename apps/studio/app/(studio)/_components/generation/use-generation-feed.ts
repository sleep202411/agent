"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getFizzAiJob,
  generationIdempotencyKey,
  generationStatusFromRaw,
  isTerminalGenerationStatus,
  listFizzAiJobs,
  normalizeFizzAiError,
  retryFizzAiJob,
  submitFizzAiJob,
  type FizzAiGenerationStatus,
  type FizzAiJobOutput,
  type FizzAiJobType,
  type FizzAiJobView,
  type FizzAiSubmitJobInput,
} from "@/app/canvas/_lib/generation-api";
import { openAssetsRealtime } from "@/app/canvas/_lib/assets-realtime";

/** One row of the create-and-browse feed (optimistic local row or server job). */
export interface FeedJob {
  /** Stable client key — survives the optimistic→server transition. */
  localId: string;
  /** Server job id; empty until the submit response lands. */
  jobId: string;
  status: FizzAiGenerationStatus;
  stage: string;
  progress: number | null;
  queuePosition: number | null;
  etaSeconds: number | null;
  prompt: string;
  modelId: string;
  input: Record<string, unknown>;
  outputs: FizzAiJobOutput[];
  error?: string;
  createdAtMs: number;
}

const HISTORY_LIMIT = 60;
const POLL_INTERVAL_MS = 2500;

function jobToFeedJob(job: FizzAiJobView): FeedJob {
  return {
    localId: job.id,
    jobId: job.id,
    status: generationStatusFromRaw(job.status),
    stage: job.stage ?? "",
    progress: job.progress ?? null,
    queuePosition: job.queuePosition ?? null,
    etaSeconds: job.estimatedTotalSeconds ?? null,
    prompt: job.promptDisplayText ?? job.prompt ?? "",
    modelId: job.modelId,
    input: job.input ?? {},
    outputs: job.outputs ?? [],
    error: job.error ? (job.error.userMessage ?? job.error.message) : undefined,
    createdAtMs: Date.parse(job.createdAt) || Date.now(),
  };
}

/** Optimistic local row (just submitted) vs an incoming server row of the
 *  same generation: match by jobId, else by prompt + freshness window. */
function sameLogicalJob(a: FeedJob, b: FeedJob): boolean {
  if (a.jobId && b.jobId) return a.jobId === b.jobId;
  if (a.localId === b.localId) return true;
  return (
    !isTerminalGenerationStatus(a.status) &&
    !isTerminalGenerationStatus(b.status) &&
    a.prompt === b.prompt &&
    Math.abs(a.createdAtMs - b.createdAtMs) < 5 * 60_000
  );
}

function mergeRow(existing: FeedJob, incoming: FeedJob): FeedJob {
  return {
    ...existing,
    ...incoming,
    localId: existing.localId,
    // Sticky fields — a stale poll response must not blank them out.
    outputs: incoming.outputs.length ? incoming.outputs : existing.outputs,
    error: incoming.error ?? existing.error,
    prompt: incoming.prompt || existing.prompt,
    input: Object.keys(incoming.input).length ? incoming.input : existing.input,
  };
}

function mergeIntoList(list: FeedJob[], incoming: FeedJob): FeedJob[] {
  const index = list.findIndex((row) => sameLogicalJob(row, incoming));
  if (index === -1) {
    return [...list, incoming].sort((a, b) => b.createdAtMs - a.createdAtMs);
  }
  const next = list.slice();
  next[index] = mergeRow(next[index], incoming);
  return next;
}

export interface SubmitFeedJob {
  prompt: string;
  modelId: string;
  schemaVersion: string;
  input: Record<string, unknown>;
  promptDocument?: FizzAiSubmitJobInput["promptDocument"];
  referenceBindings?: FizzAiSubmitJobInput["referenceBindings"];
}

/**
 * The create-and-browse feed for one modality: history (server jobs) + live
 * rows, kept current by realtime push, a polling backstop for in-flight jobs,
 * and a visibility-refocus reconcile. Submit prepends an optimistic row.
 */
export function useGenerationFeed(type: FizzAiJobType, sourceSurface: string) {
  const [jobs, setJobs] = useState<FeedJob[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const historySeq = useRef(0);
  const pollInFlight = useRef(false);

  const reconcileHistory = useCallback(async () => {
    const seq = ++historySeq.current;
    try {
      const response = await listFizzAiJobs({ limit: HISTORY_LIMIT, type });
      if (seq !== historySeq.current) return;
      setJobs((prev) => {
        let next = prev;
        for (const job of response.jobs) next = mergeIntoList(next, jobToFeedJob(job));
        return next;
      });
    } catch {
      // History is non-critical chrome — the page still composes/generates.
    } finally {
      if (seq === historySeq.current) setHistoryLoading(false);
    }
  }, [type]);

  // Initial history load.
  useEffect(() => {
    void reconcileHistory();
  }, [reconcileHistory]);

  // Realtime: ai_job_update pushes for this modality merge into the feed.
  useEffect(() => {
    const client = openAssetsRealtime({
      onEvent: (event) => {
        if (event.kind !== "ai_job_update") return;
        const job = event.job as unknown as FizzAiJobView;
        if (job.type !== type) return;
        setJobs((prev) => mergeIntoList(prev, jobToFeedJob(job)));
      },
    });
    return () => client.close();
  }, [type]);

  // Polling backstop for non-terminal jobs (covers missed pushes).
  const activeIds = useMemo(
    () =>
      jobs
        .filter((row) => row.jobId && !isTerminalGenerationStatus(row.status))
        .map((row) => row.jobId)
        .sort()
        .join(","),
    [jobs]
  );
  useEffect(() => {
    if (!activeIds) return;
    const ids = activeIds.split(",");
    const timer = setInterval(async () => {
      if (pollInFlight.current) return;
      pollInFlight.current = true;
      try {
        const results = await Promise.allSettled(ids.map((id) => getFizzAiJob(id)));
        setJobs((prev) => {
          let next = prev;
          for (const result of results) {
            if (result.status === "fulfilled") {
              next = mergeIntoList(next, jobToFeedJob(result.value));
            }
          }
          return next;
        });
      } finally {
        pollInFlight.current = false;
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [activeIds]);

  // Tab refocus → reconcile (catches anything missed while hidden).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void reconcileHistory();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reconcileHistory]);

  const patchRow = useCallback((localId: string, patch: Partial<FeedJob>) => {
    setJobs((prev) => prev.map((row) => (row.localId === localId ? { ...row, ...patch } : row)));
  }, []);

  /** Submit a generation: optimistic row first, then the server request. */
  const submit = useCallback(
    async (params: SubmitFeedJob): Promise<{ ok: boolean; error?: string }> => {
      const localId = crypto.randomUUID();
      const optimistic: FeedJob = {
        localId,
        jobId: "",
        status: "queued",
        stage: "submitting",
        progress: null,
        queuePosition: null,
        etaSeconds: null,
        prompt: params.prompt,
        modelId: params.modelId,
        input: params.input,
        outputs: [],
        createdAtMs: Date.now(),
      };
      setJobs((prev) => [optimistic, ...prev]);
      try {
        const response = await submitFizzAiJob({
          context: { documentBlockId: localId, sourceSurface },
          idempotencyKey: generationIdempotencyKey(sourceSurface),
          input: params.input,
          promptDocument: params.promptDocument,
          referenceBindings: params.referenceBindings,
          modelId: params.modelId,
          schemaVersion: params.schemaVersion,
        });
        const raw = generationStatusFromRaw(response.status);
        patchRow(localId, {
          jobId: response.request_id,
          // A too-fast "done" is coerced until a poll confirms real outputs.
          status: raw === "done" ? "generating" : raw,
          stage: response.stage ?? "queued",
          progress: response.progress ?? null,
          queuePosition: response.queue_position ?? null,
          etaSeconds: response.estimated_total_seconds ?? null,
        });
        return { ok: true };
      } catch (error) {
        const message = normalizeFizzAiError(error, "Generation failed");
        patchRow(localId, { status: "failed", error: message });
        return { ok: false, error: message };
      }
    },
    [sourceSurface, patchRow]
  );

  /** Retry a failed row: server-side when it has a jobId, else resubmit. */
  const retry = useCallback(
    async (row: FeedJob, modelMeta?: { schemaVersion: string }) => {
      setJobs((prev) => prev.filter((r) => r.localId !== row.localId));
      if (row.jobId) {
        const localId = crypto.randomUUID();
        setJobs((prev) => [
          {
            ...row,
            localId,
            jobId: "",
            status: "queued",
            stage: "submitting",
            progress: null,
            queuePosition: null,
            etaSeconds: null,
            outputs: [],
            error: undefined,
            createdAtMs: Date.now(),
          },
          ...prev,
        ]);
        try {
          const response = await retryFizzAiJob(row.jobId);
          patchRow(localId, {
            jobId: response.request_id,
            status: generationStatusFromRaw(response.status),
            stage: response.stage ?? "queued",
          });
        } catch (error) {
          patchRow(localId, {
            status: "failed",
            error: normalizeFizzAiError(error, "Retry failed"),
          });
        }
        return;
      }
      // Never reached the server — local resubmit from the stored input.
      if (row.modelId && modelMeta) {
        await submit({
          prompt: row.prompt,
          modelId: row.modelId,
          schemaVersion: modelMeta.schemaVersion,
          input: row.input,
        });
      }
    },
    [patchRow, submit]
  );

  const hasActiveJobs = useMemo(
    () => jobs.some((row) => !isTerminalGenerationStatus(row.status)),
    [jobs]
  );

  return { jobs, historyLoading, hasActiveJobs, submit, retry };
}
