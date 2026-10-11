import { z } from "zod";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useAuth } from "@/auth";
import { getAuthGeneration } from "@/auth/auth-store";
import { useScreenActive } from "@/hooks/use-app-active";
import { useTranslations } from "@/i18n";
import { api } from "@/lib/api-client";
import {
  audienceGenerationRecord,
  recoverAudienceJob,
  type AudienceAttempt,
} from "./audience-generation-record";
const statusSchema = z.object({
  id: z.string().min(1).optional(),
  status: z.enum(["in_queue", "in_progress", "completed", "failed", "cancelled", "expired"]),
  progress: z.number().nullable().default(null),
  outputs: z
    .array(z.object({ assetId: z.string().min(1), url: z.string().url().optional() }))
    .default([]),
  error: z.object({ message: z.string().optional(), userMessage: z.string().optional() }).nullish(),
});
export type AudienceJobStatus = z.infer<typeof statusSchema> & { id: string };
export function useAudienceGeneration(ipId: string) {
  const { user, generation } = useAuth(),
    active = useScreenActive(),
    t = useTranslations();
  const userId = user?.id;
  const store = useMemo(
    () => (userId ? audienceGenerationRecord(ipId, String(userId), generation) : null),
    [ipId, userId, generation]
  );
  const [initial] = useState(() => {
    try {
      return { attempt: store?.read() ?? null, error: null };
    } catch (error) {
      return {
        attempt: null,
        error: error instanceof Error ? error.message : "Generation record unavailable.",
      };
    }
  });
  const [attempt, setAttempt] = useState<AudienceAttempt | null>(initial.attempt);
  const saved = useRef(attempt);
  const [error, setError] = useState<string | null>(initial.error);
  const [jobStatus, setJobStatus] = useState<AudienceJobStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const live = useRef(false),
    posting = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sameSession = () => getAuthGeneration() === generation;
  const current = () => live.current && sameSession();
  const remember = (value: AudienceAttempt) => {
    saved.current = value;
    if (current()) setAttempt(value);
  };
  const stop = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setBusy(false);
  }, []);
  const failure = (value: unknown) => {
    if (current())
      setError(
        value instanceof Error && value.message ? value.message : t("ipGeneration.errorGeneric")
      );
  };
  const poll = async (value: AudienceAttempt, token: AbortController) => {
    const applicable = () => current() && controller.current === token && !token.signal.aborted;
    try {
      const reply = statusSchema.parse(
        await api.get(
          `/ip-commerce/ips/${encodeURIComponent(ipId)}/generation-templates/${encodeURIComponent(value.templateId)}/jobs/${encodeURIComponent(value.jobId!)}`,
          { service: "aurora", signal: token.signal, retry: false }
        )
      );
      if (!applicable()) return;
      if (reply.id && reply.id !== value.jobId)
        throw new Error("Generation status does not match the saved job.");
      setJobStatus({ ...reply, id: value.jobId!, outputs: reply.outputs ?? [] });
      if (["completed", "failed", "cancelled", "expired"].includes(reply.status)) {
        controller.current = null;
        setBusy(false);
        if (reply.status !== "completed")
          setError(
            reply.error?.message ?? reply.error?.userMessage ?? t("ipGeneration.errorGeneric")
          );
      } else
        timer.current = setTimeout(() => {
          timer.current = null;
          void poll(value, token);
        }, 2000);
    } catch (error) {
      if (applicable()) {
        controller.current = null;
        setBusy(false);
        failure(error);
      }
    }
  };
  const resume = async () => {
    if (!current() || posting.current || controller.current || !saved.current || !store) return;
    const token = new AbortController();
    controller.current = token;
    setBusy(true);
    setError(null);
    try {
      let value = store.read();
      if (!value) throw new Error("Generation record unavailable.");
      if (!value.jobId) {
        const jobId = await recoverAudienceJob(value, token.signal);
        if (!current() || token.signal.aborted) return;
        if (!jobId) throw new Error(t("ipGeneration.awaitingReceipt"));
        value = store.acknowledge(value.key, jobId);
      }
      remember(value);
      await poll(value, token);
    } catch (error) {
      if (current() && controller.current === token && !token.signal.aborted) {
        controller.current = null;
        setBusy(false);
        failure(error);
      }
    }
  };
  const resumeOnReturn = useEffectEvent(() => {
    if (saved.current) setAttempt(saved.current);
    if (!posting.current) setSubmitting(false);
    void resume();
  });
  useEffect(() => {
    live.current = active;
    if (active) {
      resumeOnReturn();
    }
    return () => {
      live.current = false;
      stop();
    };
  }, [active, stop]);
  const start = async (
    templateId: string,
    templateName: string,
    referenceImageAssetId?: string
  ) => {
    if (!current() || posting.current || saved.current || !store || initial.error) return;
    posting.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const value = store.create({
        key: `ip-audience:${globalThis.crypto.randomUUID()}`,
        ipId,
        templateId,
        templateName,
        referenceImageAssetId,
      });
      remember(value);
      const reply = await api.post<{ jobId: string }>(
        `/ip-commerce/ips/${encodeURIComponent(ipId)}/generation-templates/${encodeURIComponent(templateId)}/run`,
        {
          service: "aurora",
          data: { idempotencyKey: value.key, referenceImageAssetId: value.referenceImageAssetId },
          retry: false,
        }
      );
      // Preserve an acknowledgement even if the screen closed while dispatching.
      if (sameSession()) remember(store.acknowledge(value.key, reply.jobId));
    } catch (error) {
      failure(error);
    } finally {
      posting.current = false;
      if (current()) {
        setSubmitting(false);
        if ((saved.current as AudienceAttempt | null)?.jobId) void resume();
      }
    }
  };
  const terminal =
    !!jobStatus && ["completed", "failed", "cancelled", "expired"].includes(jobStatus.status);
  const reset = () => {
    if (!current() || !terminal || !saved.current || !store || posting.current) return;
    try {
      store.clear(saved.current.key);
      saved.current = null;
      setAttempt(null);
      setJobStatus(null);
      setError(null);
    } catch (error) {
      failure(error);
    }
  };
  return {
    attempt,
    jobStatus,
    error,
    busy: active && busy,
    submitting: active && submitting,
    blocked: !!initial.error,
    terminal,
    start,
    resume,
    stop,
    reset,
  };
}
