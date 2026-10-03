"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { isUncertainSubmission } from "@/lib/canvas-authoring/canvas-job-recovery";
import {
  generationReceiptKey,
  readGenerationReceipt,
  saveGenerationReceipt,
  clearGenerationReceipt,
  type GenerationSubmissionReceipt,
} from "@/lib/canvas-authoring/generation-submission-receipt";
import { useAuth } from "@/app/_components/auth-provider";
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
} from "@/lib/canvas-authoring/generation-api";
import { getAssetsRealtimeKernel } from "@/lib/canvas-authoring/assets-realtime-kernel";
import { charactersKeys } from "@/app/[locale]/(studio)/characters/_lib/use-characters";
import { computeWalletBalanceQueryKey } from "@/app/_components/credits-badge";
import { useProjectPayerWorkspace } from "@/app/[locale]/project/_components/project-context";

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
  /** Provider/job error code (e.g. PROVIDER_CONTENT_FILTER), so the tile can
   *  show a code-specific localized message instead of the raw server string. */
  errorCode?: string;
  createdAtMs: number;
}

const HISTORY_LIMIT = 60;
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
    errorCode: job.error?.code,
    createdAtMs: Date.parse(job.createdAt) || Date.now(),
  };
}

function sameLogicalJob(a: FeedJob, b: FeedJob): boolean {
  if (a.jobId && b.jobId) return a.jobId === b.jobId;
  if (a.localId === b.localId) return true;
  return false;
}

function mergeRow(existing: FeedJob, incoming: FeedJob): FeedJob {
  // History, polling and realtime can arrive out of order. A settled task must
  // not become active again, but a retry with a new job ID can reuse its row.
  if (
    existing.jobId &&
    existing.jobId === incoming.jobId &&
    isTerminalGenerationStatus(existing.status) &&
    !isTerminalGenerationStatus(incoming.status)
  )
    return existing;
  return {
    ...existing,
    ...incoming,
    localId: existing.localId,
    // Sticky fields — a stale poll response must not blank them out.
    outputs: incoming.outputs.length ? incoming.outputs : existing.outputs,
    error: incoming.error ?? existing.error,
    errorCode: incoming.errorCode ?? existing.errorCode,
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
  const recoveryText = useTranslations("generationSubmission");
  const [pendingReceipt, setPendingReceipt] = useState<GenerationSubmissionReceipt | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [checkingReceipt, setCheckingReceipt] = useState(false);
  const submissionRun = useRef<object | null>(null);
  const [jobs, setJobs] = useState<FeedJob[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const historySeq = useRef(0);
  const pollInFlight = useRef(false);
  const activeIdsRef = useRef<string[]>([]);
  const { user } = useAuth();
  const workspaceId = useProjectPayerWorkspace()?.id ?? null;
  const receiptKey =
    user?.id != null ? generationReceiptKey(String(user.id), workspaceId, sourceSurface) : null;
  const epoch = useMemo(
    () => ({ userId: user?.id, workspaceId, type, sourceSurface }),
    [user?.id, workspaceId, type, sourceSurface]
  );
  const activeEpoch = useRef<typeof epoch | null>(null);
  const retries = useRef(new Set<string>());
  const isCurrent = useCallback(() => activeEpoch.current === epoch, [epoch]);
  useLayoutEffect(() => {
    activeEpoch.current = epoch;
    activeIdsRef.current = [];
    const retryClaims = retries.current;
    return () => {
      activeEpoch.current = null;
      setJobs([]);
      setHistoryLoading(true);
      setHistoryError(null);
      setRealtimeConnected(false);
      historySeq.current += 1;
      pollInFlight.current = false;
      retryClaims.clear();
    };
  }, [epoch]);

  const initializedReceiptScope = useRef<string | null | undefined>(undefined);
  useLayoutEffect(() => {
    if (initializedReceiptScope.current === receiptKey) return;
    submissionRun.current = null;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      initializedReceiptScope.current = receiptKey;
      setCheckingReceipt(false);
      setReceiptError(null);
      try {
        setPendingReceipt(receiptKey ? readGenerationReceipt(receiptKey) : null);
      } catch (error) {
        setPendingReceipt(null);
        setReceiptError(normalizeFizzAiError(error, recoveryText("storageUnavailable")));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [receiptKey, recoveryText]);

  const recoverSubmission = useCallback(
    async (retryOriginal = false) => {
      if (!isCurrent() || !receiptKey || submissionRun.current) return;
      const run = {};
      submissionRun.current = run;
      setCheckingReceipt(true);
      setReceiptError(null);
      try {
        const receipt = readGenerationReceipt(receiptKey);
        if (!receipt) {
          setPendingReceipt(null);
          return;
        }
        const response = await listFizzAiJobs({
          idempotencyKey: receipt.request.idempotencyKey,
          documentBlockId: receipt.request.context.documentBlockId,
          sourceSurface,
          type,
        });
        if (!isCurrent()) return;
        const job = response.jobs.find(
          (item) =>
            item.idempotencyKey === receipt.request.idempotencyKey &&
            item.modelId === receipt.request.modelId
        );
        if (job) {
          clearGenerationReceipt(receiptKey, receipt.request.idempotencyKey);
          setPendingReceipt(null);
          setJobs((previous) => mergeIntoList(previous, jobToFeedJob(job)));
          void queryClient.invalidateQueries({ queryKey: computeWalletBalanceQueryKey });
        } else if (retryOriginal) {
          // Explicitly retry the original command, never the edited composer or
          // a new key. An empty lookup alone does not establish rejection.
          const accepted = await submitFizzAiJob(receipt.request);
          clearGenerationReceipt(receiptKey, receipt.request.idempotencyKey);
          if (!isCurrent()) return;
          setPendingReceipt(null);
          setJobs((previous) =>
            mergeIntoList(previous, {
              localId: accepted.request_id,
              jobId: accepted.request_id,
              status:
                generationStatusFromRaw(accepted.status) === "done"
                  ? "generating"
                  : generationStatusFromRaw(accepted.status),
              stage: accepted.stage ?? "queued",
              progress: accepted.progress ?? null,
              queuePosition: accepted.queue_position ?? null,
              etaSeconds: accepted.estimated_total_seconds ?? null,
              prompt: receipt.prompt,
              modelId: receipt.request.modelId,
              input: receipt.request.input,
              outputs: [],
              createdAtMs: Date.parse(receipt.createdAt),
            })
          );
          void queryClient.invalidateQueries({ queryKey: computeWalletBalanceQueryKey });
        } else setReceiptError(recoveryText("notFoundYet"));
      } catch (error) {
        if (isCurrent()) setReceiptError(normalizeFizzAiError(error, recoveryText("lookupFailed")));
      } finally {
        if (submissionRun.current === run) submissionRun.current = null;
        if (isCurrent()) setCheckingReceipt(false);
      }
    },
    [isCurrent, receiptKey, sourceSurface, type, queryClient, recoveryText]
  );

  const reconcileHistory = useCallback(async () => {
    if (!isCurrent()) return;
    const seq = ++historySeq.current;
    try {
      const response = await listFizzAiJobs({ limit: HISTORY_LIMIT, sourceSurface, type });
      if (!isCurrent() || seq !== historySeq.current) return;
      setHistoryError(null);
      setJobs((prev) => {
        let next = prev;
        for (const job of response.jobs) next = mergeIntoList(next, jobToFeedJob(job));
        return next;
      });
    } catch (error) {
      if (isCurrent() && seq === historySeq.current)
        setHistoryError(normalizeFizzAiError(error, "Could not load generation history"));
    } finally {
      if (isCurrent() && seq === historySeq.current) setHistoryLoading(false);
    }
  }, [isCurrent, sourceSurface, type]);

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

  // Realtime: ai_job_update pushes for this modality merge into the feed. Scoped
  // to the project's PAYER workspace, not the global active selection: always a
  // workspace I am a member of (negotiate never 403s) and the one carrying this
  // project's job + wallet channels when I belong to the project's workspace.
  useEffect(() => {
    const client = getAssetsRealtimeKernel({
      workspaceId: workspaceId ?? undefined,
    }).subscribe({
      onConnected: () => {
        if (!isCurrent()) return;
        setRealtimeConnected(true);
        void reconcileHistory();
      },
      onDisconnected: () => {
        if (isCurrent()) setRealtimeConnected(false);
      },
      onEvent: (event) => {
        if (!isCurrent()) return;
        if (event.kind === "media_asset_moderation_changed") {
          if (event.action === "blocked") {
            setJobs((prev) => removeMediaAssetFromList(prev, event.assetId));
            return;
          }
          void reconcileHistory();
          return;
        }
        if (event.kind === "character_media_updated") {
          // Provider-mirror / enrollment change — refresh the character caches
          // so the reference picker + library surfaces show the new state.
          void queryClient.invalidateQueries({
            queryKey: charactersKeys.detail(event.characterId),
          });
          void queryClient.invalidateQueries({ queryKey: charactersKeys.lists() });
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
  }, [isCurrent, queryClient, reconcileHistory, sourceSurface, type, workspaceId]);

  // Non-terminal jobs still awaiting updates — input for the disconnected-only
  // polling bridge below.
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
    // While the realtime channel is live the socket delivers job updates —
    // and the kernel's per-channel seq + gap replay backfills anything a
    // reconnect missed — so we do NOT poll when connected (same contract as
    // the canvas). Only while the channel is down does the interval bridge.
    if (realtimeConnected) return;
    const poll = async () => {
      if (!isCurrent()) return;
      const ids = activeIdsRef.current;
      if (ids.length === 0) return;
      if (pollInFlight.current) return;
      pollInFlight.current = true;
      try {
        const results = await Promise.allSettled(ids.map((id) => getFizzAiJob(id)));
        if (!isCurrent()) return;
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
        if (isCurrent()) pollInFlight.current = false;
      }
    };
    const timer = setInterval(() => void poll(), DISCONNECTED_FALLBACK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [isCurrent, activeIds, realtimeConnected]);

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
      if (!isCurrent() || !receiptKey || submissionRun.current) return { ok: false };
      const run = {};
      submissionRun.current = run;
      let receipt: GenerationSubmissionReceipt | null = null;
      let sent = false;
      try {
        const pending = readGenerationReceipt(receiptKey);
        if (pending) {
          setPendingReceipt(pending);
          return { ok: false, error: recoveryText("pending") };
        }
        const request: FizzAiSubmitJobInput = {
          context: {
            workspaceId: workspaceId ?? undefined,
            documentBlockId: crypto.randomUUID(),
            sourceSurface,
          },
          idempotencyKey: generationIdempotencyKey(sourceSurface),
          input: params.input,
          promptDocument: params.promptDocument,
          referenceBindings: params.referenceBindings,
          modelId: params.modelId,
          schemaVersion: params.schemaVersion,
        };
        receipt = {
          version: 1,
          request,
          prompt: params.prompt,
          createdAt: new Date().toISOString(),
        };
        saveGenerationReceipt(receiptKey, receipt);
        sent = true;
        const response = await submitFizzAiJob(request);
        clearGenerationReceipt(receiptKey, request.idempotencyKey);
        if (!isCurrent()) return { ok: false };
        setPendingReceipt(null);
        setReceiptError(null);
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
        let uncertain = isUncertainSubmission(error);
        if (receipt && sent && !uncertain) {
          try {
            clearGenerationReceipt(receiptKey, receipt.request.idempotencyKey);
          } catch {
            uncertain = true;
          }
        }
        if (!isCurrent()) return { ok: false };
        const message = normalizeFizzAiError(error, recoveryText("submissionFailed"));
        if (receipt && sent && uncertain) setPendingReceipt(receipt);
        else if (receipt && sent) {
          setPendingReceipt(null);
          setReceiptError(null);
        } else if (!sent) setReceiptError(message);
        return { ok: false, error: message };
      } finally {
        if (submissionRun.current === run) submissionRun.current = null;
      }
    },
    [isCurrent, receiptKey, queryClient, sourceSurface, workspaceId, recoveryText]
  );

  /** Retry a failed row: server-side when it has a jobId, else resubmit. */
  const retry = useCallback(
    async (row: FeedJob, modelMeta?: { schemaVersion: string }) => {
      if (!isCurrent() || retries.current.has(row.localId)) return;
      retries.current.add(row.localId);
      try {
        if (row.jobId) {
          try {
            const response = await retryFizzAiJob(row.jobId);
            if (!isCurrent()) return;
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
            if (!isCurrent()) return;
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
      } finally {
        if (isCurrent()) retries.current.delete(row.localId);
      }
    },
    [isCurrent, patchRow, queryClient, submit]
  );

  const hasActiveJobs = useMemo(
    () => jobs.some((row) => !isTerminalGenerationStatus(row.status)),
    [jobs]
  );

  return {
    jobs,
    submissionRecovery: {
      pending: !!pendingReceipt || !!receiptError,
      prompt: pendingReceipt?.prompt,
      checking: checkingReceipt,
      error: receiptError,
      canRetry: !!pendingReceipt,
      check: () => recoverSubmission(false),
      retryOriginal: () => recoverSubmission(true),
    },
    historyLoading,
    historyError,
    refreshHistory: reconcileHistory,
    hasActiveJobs,
    submit,
    retry,
  };
}
