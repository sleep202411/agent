"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { IconDownload, IconLoader2, IconShieldCheck, IconUpload } from "@tabler/icons-react";
import { toast } from "sonner";
import { useAuth } from "@/app/_components/auth-provider";
import { useActiveWorkspaceId } from "@/app/_components/workspace-context";
import { Button } from "@/components/ui/button";
import { ApiRequestError } from "@/lib/api";
import {
  addContentReviewComment,
  creditsForDurationSeconds,
  downloadModerationExcel,
  getContentReviewRecord,
  holdReviewCredits,
  isVideoFileAllowed,
  CONTENT_REVIEW_MAX_DURATION_SECONDS,
  MAX_REVIEW_VIDEO_BYTES,
  releaseReviewCredits,
  resultFromReviewRecord,
  reviewModeration,
  saveContentReviewRecord,
  settleReviewCredits,
  type ContentReviewComment,
  type ModerationResult,
  type SaveContentReviewRecordInput,
} from "@/lib/content-review-api";
import {
  mergeReviewFindings,
  reviewFindingsFromComments,
  reviewFindingsFromDetails,
} from "@/lib/content-review-findings";
import { uploadContentReviewVideo } from "@/lib/content-review-upload";
import { isUploadAbort } from "@/lib/media-upload";
import { cn } from "@/lib/utils";
import { ContentReviewHistory, CONTENT_REVIEW_RECORDS_QUERY_KEY } from "./content-review-history";
import { ContentReviewPlayer } from "./content-review-player";
import { ContentReviewSidebar } from "./content-review-sidebar";

type Phase = "idle" | "uploading" | "reviewing" | "downloading";

function displayOrDash(value: string | number | null | undefined, empty: string): string {
  if (value === null || value === undefined || value === "") return empty;
  return String(value);
}

export function ContentReviewStudio() {
  const t = useTranslations("studioModes.contentReview");
  const tError = useTranslations("studioModes.error");
  const { requireAuth, user } = useAuth();
  const workspaceId = useActiveWorkspaceId();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const objectUrlRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pendingSaveRef = useRef<SaveContentReviewRecordInput | null>(null);
  const openedRecordIdRef = useRef<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [playbackAssetId, setPlaybackAssetId] = useState<string | null>(null);
  const [openedRecordId, setOpenedRecordId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [result, setResult] = useState<ModerationResult | null>(null);
  const [comments, setComments] = useState<ContentReviewComment[]>([]);
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [playheadSeconds, setPlayheadSeconds] = useState(0);
  const [commentFocusToken, setCommentFocusToken] = useState(0);
  const [commentBusy, setCommentBusy] = useState(false);

  const busy = phase !== "idle";
  const canComment = Boolean(result || openedRecordId) && !busy;
  const findings = useMemo(
    () =>
      mergeReviewFindings(
        reviewFindingsFromDetails(result?.details ?? []),
        reviewFindingsFromComments(comments)
      ),
    [comments, result]
  );

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
    setPlaybackAssetId(null);
    pendingSaveRef.current = null;
    openedRecordIdRef.current = null;
    setOpenedRecordId(null);
    setDisplayName(null);
    setDurationSeconds(null);
    setResult(null);
    setComments([]);
    setSelectedFindingId(null);
    setPlayheadSeconds(0);
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
      setPlaybackAssetId(null);
      pendingSaveRef.current = null;
      openedRecordIdRef.current = null;
      setOpenedRecordId(null);
      setDisplayName(next.name);
      setDurationSeconds(null);
      setResult(null);
      setComments([]);
      setSelectedFindingId(null);
      setPlayheadSeconds(0);
      setPhase("idle");
      setProgress(0);
    },
    [t]
  );

  const openRecord = useCallback(
    async (id: string) => {
      const controller = new AbortController();
      abortRef.current?.abort();
      abortRef.current = controller;
      try {
        const record = await getContentReviewRecord(id, controller.signal);
        if (objectUrlRef.current) {
          URL.revokeObjectURL(objectUrlRef.current);
          objectUrlRef.current = null;
        }
        const next = resultFromReviewRecord(record);
        const nextFindings = mergeReviewFindings(
          reviewFindingsFromDetails(next.details),
          reviewFindingsFromComments(record.comments)
        );
        setFile(null);
        setPreviewUrl(`/aurora/media/assets/${encodeURIComponent(record.mediaAssetId)}/access`);
        setPlaybackAssetId(record.mediaAssetId);
        pendingSaveRef.current = null;
        openedRecordIdRef.current = record.id;
        setOpenedRecordId(record.id);
        setDisplayName(record.fileName);
        setDurationSeconds(record.durationSeconds);
        setResult(next);
        setComments(record.comments);
        setSelectedFindingId(nextFindings[0]?.id ?? null);
        setPlayheadSeconds(0);
        setPhase("idle");
        setProgress(0);
        if (inputRef.current) inputRef.current.value = "";
      } catch (error) {
        if (
          isUploadAbort(error) ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          return;
        }
        const message =
          error instanceof ApiRequestError || error instanceof Error ? error.message : t("failed");
        toast.error(message || t("failed"));
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [t]
  );

  const persistPendingRecord = useCallback(
    async (signal?: AbortSignal): Promise<string | null> => {
      if (openedRecordIdRef.current) return openedRecordIdRef.current;
      const input = pendingSaveRef.current;
      if (!input) return null;
      const saved = await saveContentReviewRecord(input, signal);
      pendingSaveRef.current = null;
      openedRecordIdRef.current = saved.id;
      setOpenedRecordId(saved.id);
      setComments(saved.comments);
      await queryClient.invalidateQueries({
        queryKey: [CONTENT_REVIEW_RECORDS_QUERY_KEY, workspaceId],
      });
      return saved.id;
    },
    [queryClient, workspaceId]
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
      setComments([]);
      pendingSaveRef.current = null;
      openedRecordIdRef.current = null;
      setOpenedRecordId(null);
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
      const charged = { ...next, creditsCharged: charge.credits };
      setResult(charged);
      const nextFindings = reviewFindingsFromDetails(next.details ?? []);
      setSelectedFindingId(nextFindings[0]?.id ?? null);
      setPhase("idle");
      setProgress(0);
      pendingSaveRef.current = {
        mediaAssetId: uploaded.mediaAssetId,
        chargeId: charge.id,
        fileName: file.name,
        exportFileName: next.fileName,
        durationSeconds,
        creditsCharged: charge.credits,
        overview: next.overview,
        details: next.details ?? [],
      };
      try {
        await persistPendingRecord(controller.signal);
      } catch (saveError) {
        if (controller.signal.aborted) throw saveError;
        const message =
          saveError instanceof ApiRequestError || saveError instanceof Error
            ? saveError.message
            : t("saveFailed");
        toast.error(message || t("saveFailed"));
      }
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
  }, [durationSeconds, file, persistPendingRecord, t, tError, workspaceId]);

  const postComment = useCallback(
    async (body: string) => {
      setCommentBusy(true);
      try {
        let recordId = openedRecordIdRef.current;
        if (!recordId && pendingSaveRef.current) {
          recordId = await persistPendingRecord();
        }
        if (!recordId) {
          toast.error(t("commentNeedReview"));
          return false;
        }
        const next = await addContentReviewComment(recordId, {
          seconds: playheadSeconds,
          body,
        });
        setComments(next);
        const created = next[next.length - 1];
        if (created) setSelectedFindingId(created.id);
        return true;
      } catch (error) {
        const message =
          error instanceof ApiRequestError || error instanceof Error ? error.message : t("failed");
        toast.error(message || t("failed"));
        return false;
      } finally {
        setCommentBusy(false);
      }
    },
    [persistPendingRecord, playheadSeconds, t]
  );

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
  const billedCredits = result?.creditsCharged ?? credits;
  const canSubmit = Boolean(file && durationSeconds && !busy);

  return (
    <section className="mx-auto mt-5 w-full max-w-[1600px]">
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime,.mp4,.mov"
        className="sr-only"
        onChange={(event) => chooseFile(event.target.files?.[0])}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div
          className="space-y-4"
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
        >
          {previewUrl ? (
            <ContentReviewPlayer
              key={playbackAssetId ?? previewUrl}
              src={previewUrl}
              mediaAssetId={playbackAssetId}
              findings={findings}
              selectedId={selectedFindingId}
              onSelect={setSelectedFindingId}
              onDuration={(next) => setDurationSeconds(next)}
              onTime={setPlayheadSeconds}
              onCommentRequest={() => setCommentFocusToken((token) => token + 1)}
              onRemove={clearFile}
              canRemove={!busy}
              canComment={canComment}
            />
          ) : (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className={cn(
                "flex min-h-[min(62dvh,760px)] max-h-[min(82dvh,920px)] w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-white/15 bg-white/[0.03] text-center",
                dragOver ? "border-white/40 bg-white/[0.06]" : null
              )}
            >
              <span className="flex size-12 items-center justify-center rounded-2xl bg-white/[0.06] text-white/70">
                <IconUpload className="size-6" stroke={1.7} />
              </span>
              <span className="text-sm font-medium text-white">{t("dropTitle")}</span>
              <span className="text-xs text-muted-foreground">{t("dropHint")}</span>
            </button>
          )}
          {displayName ? <p className="truncate text-sm text-white/75">{displayName}</p> : null}
          {phase === "uploading" ? (
            <p className="text-sm text-white/70">{t("uploading", { percent: progress })}</p>
          ) : null}
          {phase === "reviewing" ? <p className="text-sm text-white/70">{t("reviewing")}</p> : null}
          {file || openedRecordId ? (
            <div className="flex items-start justify-between gap-12">
              <div className="flex shrink-0 flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  {file ? (
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
                  ) : null}
                  {file && !busy ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => inputRef.current?.click()}
                    >
                      {t("replace")}
                    </Button>
                  ) : null}
                  {openedRecordId && !file && !busy ? (
                    <Button type="button" variant="outline" onClick={clearFile}>
                      {t("newReview")}
                    </Button>
                  ) : null}
                </div>
                {billedCredits != null ? (
                  <p className="px-1 text-xs leading-5 text-muted-foreground">
                    {t("creditCost", { credits: billedCredits })}
                  </p>
                ) : file && !busy ? (
                  <p className="px-1 text-xs leading-5 text-muted-foreground">
                    {t("needDuration")}
                  </p>
                ) : null}
              </div>
              {overview ? (
                <div className="min-w-0 w-full max-w-2xl rounded-2xl bg-white/[0.04] px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">{t("overviewTitle")}</p>
                      <p
                        className={cn(
                          "mt-0.5 text-sm font-semibold",
                          suggestionTone === "block"
                            ? "text-red-400"
                            : suggestionTone === "review"
                              ? "text-amber-300"
                              : "text-emerald-300"
                        )}
                      >
                        {formatSuggestion(overview.aiSuggestion)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="primary-cta"
                      size="sm"
                      className="gap-1.5"
                      disabled={busy}
                      data-loading={phase === "downloading" || undefined}
                      onClick={() => requireAuth(() => void runDownload())}
                    >
                      {phase === "downloading" ? (
                        <IconLoader2 className="size-3.5 animate-spin" stroke={1.8} />
                      ) : (
                        <IconDownload className="size-3.5" stroke={1.8} />
                      )}
                      <span>{phase === "downloading" ? t("downloading") : t("download")}</span>
                    </Button>
                  </div>
                  <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                    <div className="flex items-baseline gap-1.5">
                      <dt className="text-muted-foreground">{t("risk")}</dt>
                      <dd className="text-white/90">{formatRisk(overview.riskLevel)}</dd>
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <dt className="text-muted-foreground">{t("frameRisk")}</dt>
                      <dd className="text-white/90">{formatRisk(overview.frameRiskLevel)}</dd>
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <dt className="text-muted-foreground">{t("audioRisk")}</dt>
                      <dd className="text-white/90">{formatRisk(overview.audioRiskLevel)}</dd>
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <dt className="text-muted-foreground">{t("frameNum")}</dt>
                      <dd className="text-white/90">
                        {displayOrDash(overview.frameNum, t("emptyValue"))}
                      </dd>
                    </div>
                    <div className="flex items-baseline gap-1.5">
                      <dt className="text-muted-foreground">{t("finishedAt")}</dt>
                      <dd className="text-white/90">
                        {displayOrDash(overview.finishedAt, t("emptyValue"))}
                      </dd>
                    </div>
                  </dl>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <ContentReviewSidebar
          findings={findings}
          selectedId={selectedFindingId}
          onSelect={setSelectedFindingId}
          playheadSeconds={playheadSeconds}
          currentUserId={user?.id}
          canComment={canComment}
          commentBusy={commentBusy}
          commentFocusToken={commentFocusToken}
          emptyLabel={previewUrl ? t("findingsEmpty") : t("findingsIdle")}
          onComment={async (body) => {
            if (!user) {
              requireAuth(() => undefined);
              return false;
            }
            return postComment(body);
          }}
        />
      </div>

      <ContentReviewHistory
        selectedId={openedRecordId}
        onOpen={(id) => {
          if (!busy) void openRecord(id);
        }}
        formatSuggestion={formatSuggestion}
      />
    </section>
  );
}
