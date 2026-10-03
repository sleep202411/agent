"use client";

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useCurrentUser } from "@/src/hooks/use-user";
import { useTranslations } from "@/src/i18n/i18n";
import { ApiRequestError } from "@/src/lib/api";
import {
  listFizzAiJobs,
  submitFizzAiJob,
  normalizeFizzAiError,
  type FizzAiJobView,
  type FizzAiSubmitJobInput,
  type FizzAiSubmitResponse,
} from "../_lib/generation-api";
import {
  generationReceiptKey,
  readGenerationReceipt,
  saveGenerationReceipt,
  clearGenerationReceipt,
  type GenerationSubmissionReceipt,
} from "../_lib/generation-submission-receipt";

export class UncertainGenerationSubmissionError extends Error {}

export function isUncertainGenerationSubmission(error: unknown) {
  return (
    !(error instanceof ApiRequestError) ||
    error.status === 0 ||
    error.status === 408 ||
    error.status >= 500
  );
}

export function recoveredGenerationJob(
  response: FizzAiSubmitResponse,
  receipt: GenerationSubmissionReceipt
): FizzAiJobView {
  return {
    id: response.request_id,
    idempotencyKey: receipt.request.idempotencyKey,
    type: receipt.type,
    modelId: receipt.request.modelId,
    // Submission responses contain no outputs; let the normal job poll hydrate them.
    status:
      response.status === "completed" || response.status === "done"
        ? "in_progress"
        : response.status,
    stage: response.stage,
    progress: response.progress,
    queuePosition: response.queue_position,
    estimatedWaitSeconds: response.estimated_wait_seconds,
    estimatedRunSeconds: response.estimated_run_seconds,
    estimatedTotalSeconds: response.estimated_total_seconds,
    etaConfidence: response.eta_confidence,
    prompt: receipt.prompt,
    input: receipt.request.input,
    outputs: [],
    createdAt: receipt.createdAt,
    updatedAt: new Date().toISOString(),
    ...receipt.request.context,
  };
}

/** Persist the browser's outstanding command, never a second copy of server state. */
export function useGenerationSubmission({
  workspaceId,
  surface,
  onRecovered,
}: {
  workspaceId: string;
  surface: string;
  onRecovered: (job: FizzAiJobView, receipt: GenerationSubmissionReceipt) => void;
}) {
  const { user } = useCurrentUser();
  const t = useTranslations("generationSubmission");
  const key = user?.id ? generationReceiptKey(user.id, workspaceId, surface) : null;
  const scope = useMemo(() => ({ key }), [key]);
  const activeScope = useRef<typeof scope | null>(null);
  const command = useRef<object | null>(null);
  const recovered = useRef(onRecovered);
  const [receipt, setReceipt] = useState<GenerationSubmissionReceipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  useLayoutEffect(() => {
    recovered.current = onRecovered;
  }, [onRecovered]);
  useLayoutEffect(() => {
    activeScope.current = scope;
    command.current = null;
    queueMicrotask(() => {
      if (activeScope.current !== scope) return;
      setChecking(false);
      setError(null);
      try {
        setReceipt(key ? readGenerationReceipt(key) : null);
      } catch (reason) {
        setReceipt(null);
        setError(normalizeFizzAiError(reason, "Generation recovery storage is unavailable."));
      }
    });
    return () => {
      activeScope.current = null;
    };
  }, [key, scope]);
  const isCurrent = useCallback(() => activeScope.current === scope, [scope]);

  const submit = useCallback(
    async (
      request: FizzAiSubmitJobInput,
      type: "image" | "video",
      target: GenerationSubmissionReceipt["target"]
    ) => {
      if (!isCurrent() || !key || !workspaceId) throw new Error(t("signInRequired"));
      if (command.current) throw new Error(t("pending"));
      const run = {};
      command.current = run;
      let saved: GenerationSubmissionReceipt | null = null;
      let sent = false;
      try {
        const previous = readGenerationReceipt(key);
        if (previous) {
          setReceipt(previous);
          throw new Error(t("pending"));
        }
        saved = {
          version: 1,
          request,
          type,
          target,
          prompt: String(request.input.prompt ?? ""),
          createdAt: new Date().toISOString(),
        };
        saveGenerationReceipt(key, saved);
        sent = true;
        const response = await submitFizzAiJob(request);
        clearGenerationReceipt(key, request.idempotencyKey);
        if (!isCurrent()) throw new Error(t("pending"));
        setReceipt(null);
        setError(null);
        return response;
      } catch (reason) {
        let uncertain = isUncertainGenerationSubmission(reason);
        if (saved && sent && !uncertain) {
          try {
            clearGenerationReceipt(key, saved.request.idempotencyKey);
          } catch {
            uncertain = true;
          }
        }
        if (isCurrent()) {
          if (saved && sent && uncertain) setReceipt(saved);
          else if (saved && sent) {
            setReceipt(null);
            setError(null);
          } else if (!sent) setError(normalizeFizzAiError(reason, t("storageUnavailable")));
        }
        if (saved && sent && uncertain)
          throw new UncertainGenerationSubmissionError(
            normalizeFizzAiError(reason, t("lookupFailed"))
          );
        throw reason;
      } finally {
        if (command.current === run) command.current = null;
      }
    },
    [isCurrent, key, workspaceId, t]
  );

  const recover = useCallback(
    async (retryOriginal: boolean) => {
      if (!isCurrent() || !key || command.current) return;
      const run = {};
      command.current = run;
      setChecking(true);
      setError(null);
      try {
        const saved = readGenerationReceipt(key);
        if (!saved) {
          setReceipt(null);
          return;
        }
        const result = await listFizzAiJobs({
          workspaceId: saved.request.context.workspaceId,
          idempotencyKey: saved.request.idempotencyKey,
          documentId: saved.request.context.documentId,
          documentBlockId: saved.request.context.documentBlockId,
          sourceSurface: saved.request.context.sourceSurface,
          type: saved.type,
        });
        if (!isCurrent()) return;
        let job = result.jobs.find(
          (item) =>
            item.idempotencyKey === saved.request.idempotencyKey &&
            item.modelId === saved.request.modelId
        );
        if (!job && retryOriginal) {
          const accepted = await submitFizzAiJob(saved.request);
          job = recoveredGenerationJob(accepted, saved);
        }
        if (job) {
          if (!isCurrent()) return;
          recovered.current(job, saved);
          clearGenerationReceipt(key, saved.request.idempotencyKey);
          setReceipt(null);
        } else setError(t("notFoundYet"));
      } catch (reason) {
        // Even a rejected replay cannot prove that the original was rejected.
        if (isCurrent()) setError(normalizeFizzAiError(reason, t("lookupFailed")));
      } finally {
        if (command.current === run) command.current = null;
        if (isCurrent()) setChecking(false);
      }
    },
    [isCurrent, key, t]
  );

  return {
    submit,
    isCurrent,
    ready: !!key && !!workspaceId,
    recovery: {
      pending: !!receipt || !!error,
      prompt: receipt?.prompt,
      checking,
      error,
      canRetry: !!receipt,
      check: () => recover(false),
      retryOriginal: () => recover(true),
    },
  };
}
