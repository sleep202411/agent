"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { IconDownload, IconLoader2, IconShieldCheck, IconUpload, IconX } from "@tabler/icons-react";
import { toast } from "sonner";
import { useAuth } from "@/app/_components/auth-provider";
import { useActiveWorkspaceId } from "@/app/_components/workspace-context";
import { Button } from "@/components/ui/button";
import { ApiRequestError } from "@/lib/api";
import {
  creditsForDurationSeconds,
  downloadModerationExcel,
  holdReviewCredits,
  isVideoFileAllowed,
  CONTENT_REVIEW_MAX_DURATION_SECONDS,
  MAX_REVIEW_VIDEO_BYTES,
  releaseReviewCredits,
  reviewModeration,
  settleReviewCredits,
  type ModerationResult,
} from "@/lib/content-review-api";
import { uploadContentReviewVideo } from "@/lib/content-review-upload";
import { isUploadAbort } from "@/lib/media-upload";
import { cn } from "@/lib/utils";

type Phase = "idle" | "uploading" | "reviewing" | "downloading";

function displayOrDash(value: string | number | null | undefined, empty: string): string {
  if (value === null || value === undefined || value === "") return empty;
  return String(value);
}

export function ContentReviewStudio() {
  const t = useTranslations("studioModes.contentReview");
  const tError = useTranslations("studioModes.error");
  const { requireAuth } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const inputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<ModerationResult | null>(null);

  const busy = phase !== "idle";

  const formatRisk = (value: string | null | undefined) => {
    const key = value?.trim().toLowerCase();
    if (key === "none") return t("riskNone");
    if (key === "low") return t("riskLow");
    if (key === "medium") return t("riskMedium");
    if (key === "high") return t("riskHigh");
    return displayOrDash(value, t("emptyValue"));
  };

  const formatSuggestion = (value: string | null | undefined) => {
    const key = value?.trim().toLowerCase();
    if (key === "pass") return t("suggestionPass");
    if (key === "review") return t("suggestionReview");
    if (key === "block") return t("suggestionBlock");
    return displayOrDash(value, t("emptyValue"));
  };

  const clearFile = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setFile(null);
    setPreviewUrl(null);
    setDurationSeconds(null);
    setResult(null);
    setPhase("idle");
    setProgress(0);
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    []
  );

  const chooseFile = useCallback(
    (next: File | undefined) => {
      if (!next) return;
      if (!isVideoFileAllowed(next)) {
        toast.error(t("invalidType"));
        return;
      }
      if (next.size > MAX_REVIEW_VIDEO_BYTES) {
        toast.error(t("tooLarge"));
        return;
      }
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      const url = URL.createObjectURL(next);
      objectUrlRef.current = url;
      setFile(next);
      setPreviewUrl(url);
      setDurationSeconds(null);
      setResult(null);
      setPhase("idle");
      setProgress(0);
    },
    [t]
  );

  const runReview = useCallback(async () => {
    if (!file) {
      toast.error(t("needFile"));
      return;
    }
    if (!workspaceId) {
      toast.error(t("needWorkspace"));
      return;
    }
    if (!durationSeconds) {
      toast.error(t("needDuration"));
      return;
    }
    if (durationSeconds > CONTENT_REVIEW_MAX_DURATION_SECONDS) {
      toast.error(t("tooLong"));
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    let chargeId: string | null = null;
    let settled = false;
    let reviewed = false;
    try {
      setResult(null);
      setPhase("uploading");
      setProgress(0);
      chargeId = crypto.randomUUID();
      const charge = await holdReviewCredits(durationSeconds, controller.signal, chargeId);
      chargeId = charge.id;
      const uploaded = await uploadContentReviewVideo(file, {
        workspaceId,
        onProgress: setProgress,
        signal: controller.signal,
      });
      setPhase("reviewing");
      const next = await reviewModeration(uploaded.url, controller.signal);
      reviewed = true;
      try {
        await settleReviewCredits(charge.id, controller.signal);
      } catch (settleError) {
        if (controller.signal.aborted) throw settleError;
      } finally {
        settled = true;
      }
      setResult({ ...next, creditsCharged: charge.credits });
      setPhase("idle");
      setProgress(0);
    } catch (error) {
      if (isUploadAbort(error) || (error instanceof DOMException && error.name === "AbortError")) {
        setPhase("idle");
        return;
      }
      const insufficient =
        error instanceof ApiRequestError &&
        (error.code === "INSUFFICIENT_COMPUTE_POINTS" ||
          error.code === "INSUFFICIENT_UNEXPIRED_COMPUTE_POINTS");
      const chargeUnavailable =
        error instanceof ApiRequestError && error.code === "CHARGE_UNAVAILABLE";
      const message = insufficient
        ? tError("insufficientCredits")
        : chargeUnavailable
          ? t("chargeUnavailable")
          : error instanceof ApiRequestError || error instanceof Error
            ? error.message
            : t("failed");
      toast.error(message || t("failed"));
      setPhase("idle");
    } finally {
      if (chargeId && !settled) {
        try {
          if (reviewed) await settleReviewCredits(chargeId);
          else await releaseReviewCredits(chargeId);
        } catch {
          /* Refund/settle is best-effort if the tab is already closing. */
        }
      }
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [durationSeconds, file, t, tError, workspaceId]);

  const runDownload = useCallback(async () => {
    if (!result) return;
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setPhase("downloading");
      const filename = await downloadModerationExcel(result, controller.signal);
      toast.success(t("done", { filename }));
    } catch (error) {
      if (isUploadAbort(error) || (error instanceof DOMException && error.name === "AbortError")) {
        return;
      }
      const message =
        error instanceof ApiRequestError || error instanceof Error ? error.message : t("failed");
      toast.error(message || t("failed"));
    } finally {
      setPhase("idle");
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [result, t]);

  const overview = result?.overview;
  const suggestionTone = overview?.aiSuggestion?.trim().toLowerCase();
  const credits = durationSeconds ? creditsForDurationSeconds(durationSeconds) : null;
  const canSubmit = Boolean(file && durationSeconds && !busy);

  return (
    <section className="mx-auto mt-8 w-full max-w-2xl">
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime,.mp4,.mov"
        className="sr-only"
        onChange={(event) => chooseFile(event.target.files?.[0])}
      />
      <div
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragOver(false);
          if (!busy) chooseFile(event.dataTransfer.files?.[0]);
        }}
        className={cn(
          "rounded-2xl border border-dashed border-white/15 bg-white/[0.03] p-6 transition-colors",
          dragOver ? "border-white/40 bg-white/[0.06]" : null
        )}
      >
        {file && previewUrl ? (
          <div className="space-y-4">
            <div className="relative overflow-hidden rounded-xl bg-black">
              <video
                src={previewUrl}
                controls
                className="mx-auto max-h-[360px] w-full"
                onLoadedMetadata={(event) => {
                  const next = event.currentTarget.duration;
                  if (Number.isFinite(next) && next > 0) {
                    setDurationSeconds(Math.max(1, Math.ceil(next)));
                  } else {
                    setDurationSeconds(null);
                  }
                }}
              />
              {busy ? null : (
                <button
                  type="button"
                  onClick={clearFile}
                  aria-label={t("remove")}
                  className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80"
                >
                  <IconX className="size-4" stroke={1.8} />
                </button>
              )}
            </div>
            <p className="truncate text-sm text-white/75">{file.name}</p>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center gap-3 py-10 text-center"
          >
            <span className="flex size-12 items-center justify-center rounded-2xl bg-white/[0.06] text-white/70">
              <IconUpload className="size-6" stroke={1.7} />
            </span>
            <span className="text-sm font-medium text-white">{t("dropTitle")}</span>
            <span className="text-xs text-muted-foreground">{t("dropHint")}</span>
          </button>
        )}
      </div>

      {phase === "uploading" ? (
        <p className="mt-4 text-sm text-white/70">{t("uploading", { percent: progress })}</p>
      ) : null}
      {phase === "reviewing" ? (
        <p className="mt-4 text-sm text-white/70">{t("reviewing")}</p>
      ) : null}

      {overview ? (
        <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.04] p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-white">{t("overviewTitle")}</p>
              <p
                className={cn(
                  "mt-1 text-lg font-semibold",
                  suggestionTone === "block"
                    ? "text-red-400"
                    : suggestionTone === "review"
                      ? "text-amber-300"
                      : "text-emerald-300"
                )}
              >
                {formatSuggestion(overview.aiSuggestion)}
              </p>
              {result?.creditsCharged ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("creditsCharged", { credits: result.creditsCharged })}
                </p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              className="gap-2"
              disabled={busy}
              data-loading={phase === "downloading" || undefined}
              onClick={() => requireAuth(() => void runDownload())}
            >
              {phase === "downloading" ? (
                <IconLoader2 className="size-4 animate-spin" stroke={1.8} />
              ) : (
                <IconDownload className="size-4" stroke={1.8} />
              )}
              <span>{phase === "downloading" ? t("downloading") : t("download")}</span>
            </Button>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">{t("risk")}</dt>
              <dd className="mt-1 text-white/90">{formatRisk(overview.riskLevel)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("frameRisk")}</dt>
              <dd className="mt-1 text-white/90">{formatRisk(overview.frameRiskLevel)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("audioRisk")}</dt>
              <dd className="mt-1 text-white/90">{formatRisk(overview.audioRiskLevel)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("frameNum")}</dt>
              <dd className="mt-1 text-white/90">
                {displayOrDash(overview.frameNum, t("emptyValue"))}
              </dd>
            </div>
            <div className="col-span-2 sm:col-span-2">
              <dt className="text-xs text-muted-foreground">{t("finishedAt")}</dt>
              <dd className="mt-1 text-white/90">
                {displayOrDash(overview.finishedAt, t("emptyValue"))}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="primary-cta"
          className="gap-2"
          disabled={!canSubmit}
          data-loading={busy && phase !== "downloading" ? true : undefined}
          onClick={() => requireAuth(() => void runReview())}
        >
          {phase === "uploading" || phase === "reviewing" ? (
            <IconLoader2 className="size-4 animate-spin" stroke={1.8} />
          ) : (
            <IconShieldCheck className="size-4" stroke={1.8} />
          )}
          <span>
            {phase === "reviewing"
              ? t("reviewingCta")
              : phase === "uploading"
                ? t("uploadingCta")
                : t("submit")}
          </span>
        </Button>
        {file && !busy ? (
          <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>
            {t("replace")}
          </Button>
        ) : null}
      </div>
      {file && credits && !overview ? (
        <p className="mt-3 text-xs text-muted-foreground">{t("creditCost", { credits })}</p>
      ) : null}
      {file && !credits && !busy ? (
        <p className="mt-3 text-xs text-muted-foreground">{t("needDuration")}</p>
      ) : null}
    </section>
  );
}
