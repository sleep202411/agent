"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
} from "@/app/[locale]/canvas/_lib/generation-api";
import { getAssetsRealtimeKernel } from "@/app/[locale]/canvas/_lib/assets-realtime-kernel";
import { computeWalletBalanceQueryKey } from "@/app/_components/credits-badge";
import { useActiveWorkspaceId } from "@/app/_components/workspace-context";

/** One row of the create-and-browse feed. Rows are inserted after server accept. */
export interface FeedJob {
  /** Stable React key; server jobs use the server request id. */
  localId: string;
  /** Server job id. */
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
const CONNECTED_RECONCILE_INTERVAL_MS = 20_000;
const DISCONNECTED_FALLBACK_INTERVAL_MS = 5_000;

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

function sameLogicalJob(a: FeedJob, b: FeedJob): boolean {
  if (a.jobId && b.jobId) return a.jobId === b.jobId;
  if (a.localId === b.localId) return true;
  return false;
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

function outputMatchesAsset(output: FizzAiJobOutput, assetId: string): boolean {
  return output.assetId === assetId || output.id === assetId;
}

function removeMediaAssetFromList(list: FeedJob[], assetId: string): FeedJob[] {
  return list.map((row) => {
    if (!row.outputs.some((output) => outputMatchesAsset(output, assetId))) return row;
    const outputs = row.outputs.filter((output) => !outputMatchesAsset(output, assetId));
    return {
      ...row,
      outputs,
      status: outputs.length > 0 ? row.status : "failed",
      error: outputs.length > 0 ? row.error : "This asset is no longer available.",
    };
  });
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
 * The create-and-browse feed for one modality: scoped history (server jobs) +
 * realtime pushes, plus low-frequency reconciliation for missed updates.
 */
export function useGenerationFeed(type: FizzAiJobType, sourceSurface: string) {
  const queryClient = useQueryClient();
  const [jobs, setJobs] = useState<FeedJob[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const historySeq = useRef(0);
  const pollInFlight = useRef(false);
  const activeIdsRef = useRef<string[]>([]);

  const reconcileHistory = useCallback(async () => {
    const seq = ++historySeq.current;
    try {
      const response = await listFizzAiJobs({ limit: HISTORY_LIMIT, sourceSurface, type });
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
  }, [sourceSurface, type]);

  // Initial history load.
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void reconcileHistory();
    });
    return () => {
      cancelled = true;
    };
  }, [reconcileHistory]);

  // Realtime: ai_job_update pushes for this modality merge into the feed. One
  // socket per active workspace (so it carries that workspace's wallet channel).
  const workspaceId = useActiveWorkspaceId();
  useEffect(() => {
    const client = getAssetsRealtimeKernel({
      workspaceId: workspaceId ?? undefined,
    }).subscribe({
      onConnected: () => {
        setRealtimeConnected(true);
        void reconcileHistory();
      },
      onDisconnected: () => setRealtimeConnected(false),
      onEvent: (event) => {
        if (event.kind === "media_asset_moderation_changed") {
          if (event.action === "blocked") {
            setJobs((prev) => removeMediaAssetFromList(prev, event.assetId));
            return;
          }
          void reconcileHistory();
          return;
        }
        if (event.kind !== "ai_job_update") return;
        const job = event.job as unknown as FizzAiJobView;
        if (job.type !== type) return;
        if (job.sourceSurface !== sourceSurface) return;
        if (isTerminalGenerationStatus(generationStatusFromRaw(job.status))) {
          void queryClient.invalidateQueries({ queryKey: computeWalletBalanceQueryKey });
        }
        setJobs((prev) => mergeIntoList(prev, jobToFeedJob(job)));
      },
    });
    return () => client.close();
  }, [queryClient, reconcileHistory, sourceSurface, type, workspaceId]);

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
    activeIdsRef.current = activeIds ? activeIds.split(",") : [];
  }, [activeIds]);

  useEffect(() => {
    if (!activeIds) return;
    const poll = async () => {
      const ids = activeIdsRef.current;
      if (ids.length === 0) return;
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
    };
    const timer = setInterval(
      () => void poll(),
      realtimeConnected ? CONNECTED_RECONCILE_INTERVAL_MS : DISCONNECTED_FALLBACK_INTERVAL_MS
    );
    return () => clearInterval(timer);
  }, [activeIds, realtimeConnected]);

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

  /** Submit a generation; insert a card only after the server accepts it. */
  const submit = useCallback(
    async (params: SubmitFeedJob): Promise<{ ok: boolean; error?: string; jobId?: string }> => {
      try {
        const response = await submitFizzAiJob({
          context: { documentBlockId: crypto.randomUUID(), sourceSurface },
          idempotencyKey: generationIdempotencyKey(sourceSurface),
          input: params.input,
          promptDocument: params.promptDocument,
          referenceBindings: params.referenceBindings,
          modelId: params.modelId,
          schemaVersion: params.schemaVersion,
        });
        const raw = generationStatusFromRaw(response.status);
        setJobs((prev) =>
          mergeIntoList(prev, {
            localId: response.request_id,
            jobId: response.request_id,
            // A too-fast "done" is coerced until a poll confirms real outputs.
            status: raw === "done" ? "generating" : raw,
            stage: response.stage ?? "queued",
            progress: response.progress ?? null,
            queuePosition: response.queue_position ?? null,
            etaSeconds: response.estimated_total_seconds ?? null,
            prompt: params.prompt,
            modelId: params.modelId,
            input: params.input,
            outputs: [],
            createdAtMs: Date.now(),
          })
        );
        void queryClient.invalidateQueries({ queryKey: computeWalletBalanceQueryKey });
        return { ok: true, jobId: response.request_id };
      } catch (error) {
        const message = normalizeFizzAiError(error, "Generation failed");
        return { ok: false, error: message };
      }
    },
    [queryClient, sourceSurface]
  );

  /** Retry a failed row: server-side when it has a jobId, else resubmit. */
  const retry = useCallback(
    async (row: FeedJob, modelMeta?: { schemaVersion: string }) => {
      if (row.jobId) {
        try {
          const response = await retryFizzAiJob(row.jobId);
          setJobs((prev) => prev.filter((r) => r.localId !== row.localId));
          setJobs((prev) =>
            mergeIntoList(prev, {
              ...row,
              localId: response.request_id,
              jobId: response.request_id,
              status: generationStatusFromRaw(response.status),
              stage: response.stage ?? "queued",
              progress: response.progress ?? null,
              queuePosition: response.queue_position ?? null,
              etaSeconds: response.estimated_total_seconds ?? null,
              outputs: [],
              error: undefined,
              createdAtMs: Date.now(),
            })
          );
          void queryClient.invalidateQueries({ queryKey: computeWalletBalanceQueryKey });
        } catch (error) {
          patchRow(row.localId, {
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
    [patchRow, queryClient, submit]
  );

  const hasActiveJobs = useMemo(
    () => jobs.some((row) => !isTerminalGenerationStatus(row.status)),
    [jobs]
  );

  return { jobs, historyLoading, hasActiveJobs, submit, retry };
}
