"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from "react";
import {
  IconAlertTriangle,
  IconBookmark,
  IconCheck,
  IconLoader2,
  IconPhoto,
  IconUpload,
  IconVideo,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  storyApiErrorMessage,
  type MediaAssetSummary,
  type StoryCandidateAsset,
} from "@/lib/story-projects-api";

export type StoryCandidatePickerKind = Extract<MediaAssetSummary["kind"], "image" | "video">;
type StoryCandidatePickerFilter = "all" | StoryCandidatePickerKind;
export type StoryCandidateAssetUploadState =
  | { stage: "uploading"; progress: number }
  | { stage: "processing" };

const CANDIDATE_PENDING_FEEDBACK_DELAY_MS = 180;

export interface StoryCandidateAssetPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: StoryCandidateAsset[];
  allowedKinds: readonly StoryCandidatePickerKind[];
  currentAssetId?: string | null;
  loading?: boolean;
  error?: string | null;
  canSelect: boolean;
  disabledReason?: string | null;
  onRetry?: () => void;
  isSelectable?: (candidate: StoryCandidateAsset) => boolean;
  unavailableReason?: (candidate: StoryCandidateAsset) => string | undefined;
  onSelect: (candidate: StoryCandidateAsset) => Promise<void>;
  onClearSelection?: () => Promise<void>;
  uploadAccept?: string;
  onUpload?: (
    file: File,
    onState: (state: StoryCandidateAssetUploadState) => void,
    signal: AbortSignal
  ) => Promise<void>;
}

/**
 * Project-scoped candidate media picker.
 *
 * The dialog owns browsing, filtering, selection feedback and retry states.
 * Each consumer owns only the media kinds and eligibility rules that its
 * product slot can actually accept.
 */
export function StoryCandidateAssetPickerDialog({
  open,
  onOpenChange,
  items,
  allowedKinds,
  currentAssetId = null,
  loading = false,
  error = null,
  canSelect,
  disabledReason = null,
  onRetry,
  isSelectable = () => true,
  unavailableReason,
  onSelect,
  onClearSelection,
  uploadAccept,
  onUpload,
}: StoryCandidateAssetPickerDialogProps) {
  const t = useTranslations("storyStudio.canvas.candidatePicker");
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const pendingFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragDepthRef = useRef(0);
  const normalizedKinds = useMemo(
    () => (["image", "video"] as const).filter((kind) => allowedKinds.includes(kind)),
    [allowedKinds]
  );
  const [filter, setFilter] = useState<StoryCandidatePickerFilter>("all");
  const [pendingAssetId, setPendingAssetId] = useState<string | null>(null);
  const [visiblePendingAssetId, setVisiblePendingAssetId] = useState<string | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [uploadState, setUploadState] = useState<StoryCandidateAssetUploadState | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const effectiveFilter =
    normalizedKinds.length === 1
      ? normalizedKinds[0]
      : filter === "all" || normalizedKinds.includes(filter)
        ? filter
        : "all";

  const candidates = useMemo(
    () =>
      items.filter(
        (candidate) =>
          normalizedKinds.includes(candidate.asset.kind as StoryCandidatePickerKind) &&
          (effectiveFilter === "all" || candidate.asset.kind === effectiveFilter)
      ),
    [effectiveFilter, items, normalizedKinds]
  );

  const filterValues: StoryCandidatePickerFilter[] =
    normalizedKinds.length === 1 ? [...normalizedKinds] : ["all", ...normalizedKinds];
  const acceptedFileTypes =
    uploadAccept ??
    normalizedKinds.map((kind) => (kind === "image" ? "image/*" : "video/*")).join(",");
  const operationPending = pendingAssetId !== null || uploadState !== null;
  const operationError = selectionError ?? uploadError;

  useEffect(
    () => () => {
      uploadAbortRef.current?.abort();
      if (pendingFeedbackTimerRef.current !== null) {
        clearTimeout(pendingFeedbackTimerRef.current);
      }
    },
    []
  );

  const beginCandidatePending = (assetId: string) => {
    if (pendingFeedbackTimerRef.current !== null) {
      clearTimeout(pendingFeedbackTimerRef.current);
    }
    setPendingAssetId(assetId);
    setVisiblePendingAssetId(null);
    pendingFeedbackTimerRef.current = setTimeout(() => {
      pendingFeedbackTimerRef.current = null;
      setVisiblePendingAssetId(assetId);
    }, CANDIDATE_PENDING_FEEDBACK_DELAY_MS);
  };

  const finishCandidatePending = () => {
    if (pendingFeedbackTimerRef.current !== null) {
      clearTimeout(pendingFeedbackTimerRef.current);
      pendingFeedbackTimerRef.current = null;
    }
    setPendingAssetId(null);
    setVisiblePendingAssetId(null);
  };

  const requestOpenChange = (nextOpen: boolean) => {
    if (operationPending) return;
    if (!nextOpen) {
      setSelectionError(null);
      setUploadError(null);
      setDragActive(false);
      dragDepthRef.current = 0;
    }
    onOpenChange(nextOpen);
  };

  const applyCandidateAction = async (candidate: StoryCandidateAsset) => {
    const current = candidate.asset.id === currentAssetId;
    const action = current ? onClearSelection : () => onSelect(candidate);
    if (!canSelect || operationPending || !action || (!current && !isSelectable(candidate))) {
      return;
    }
    beginCandidatePending(candidate.asset.id);
    setSelectionError(null);
    let succeeded = false;
    try {
      await action();
      succeeded = true;
    } catch (candidateError) {
      setSelectionError(
        storyApiErrorMessage(candidateError, t(current ? "clearError" : "selectError"))
      );
    } finally {
      finishCandidatePending();
      if (succeeded) onOpenChange(false);
    }
  };

  const uploadFile = async (file: File) => {
    if (!onUpload || !canSelect || operationPending) return;
    if (!fileMatchesAccept(file, acceptedFileTypes)) {
      setUploadError(t("upload.unsupported"));
      return;
    }

    const controller = new AbortController();
    uploadAbortRef.current?.abort();
    uploadAbortRef.current = controller;
    setSelectionError(null);
    setUploadError(null);
    setUploadState({ stage: "uploading", progress: 0 });
    try {
      await onUpload(
        file,
        (state) => {
          if (uploadAbortRef.current !== controller) return;
          setUploadState(
            state.stage === "uploading"
              ? {
                  stage: "uploading",
                  progress: Math.min(100, Math.max(0, Math.round(state.progress))),
                }
              : state
          );
        },
        controller.signal
      );
      onOpenChange(false);
    } catch (error) {
      if (!controller.signal.aborted) {
        setUploadError(storyApiErrorMessage(error, t("upload.error")));
      }
    } finally {
      if (uploadAbortRef.current === controller) uploadAbortRef.current = null;
      setUploadState(null);
    }
  };

  const handleDragEnter = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!onUpload || !canSelect || operationPending) return;
    dragDepthRef.current += 1;
    setDragActive(true);
  };

  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!onUpload || !canSelect || operationPending) return;
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!onUpload) return;
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  };

  const handleDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!onUpload || !canSelect || operationPending) return;
    dragDepthRef.current = 0;
    setDragActive(false);
    const file = event.dataTransfer.files[0];
    if (file) void uploadFile(file);
  };

  return (
    <Dialog open={open} onOpenChange={requestOpenChange}>
      <DialogContent
        className="flex h-[min(640px,calc(100vh-3rem))] w-[min(920px,calc(100vw-2rem))] max-w-none flex-col gap-0 overflow-hidden rounded-[24px] bg-[oklch(0.19_0_0/0.98)] p-0 text-white shadow-[0_32px_110px_rgba(0,0,0,0.72)] sm:max-w-none"
        onEscapeKeyDown={(event) => {
          if (operationPending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (operationPending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (operationPending) event.preventDefault();
        }}
      >
        <DialogHeader className="px-5 pt-5 pr-14 pb-4">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/[0.065] text-white/62">
              <IconBookmark className="size-4" stroke={1.8} />
            </span>
            <div className="min-w-0">
              <DialogTitle className="text-base font-semibold tracking-[-0.01em] text-white">
                {t("title")}
              </DialogTitle>
              <DialogDescription className="mt-1 max-w-[58ch] text-[11px] leading-5 text-white/42">
                {t("description")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="h-px shrink-0 bg-white/[0.06]" />

        <div className="flex shrink-0 gap-1 px-5 py-3" role="tablist" aria-label={t("filterLabel")}>
          {filterValues.map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={effectiveFilter === value}
              onClick={() => setFilter(value)}
              className={cn(
                "h-8 rounded-xl px-3 text-[10px] font-medium transition",
                effectiveFilter === value
                  ? "bg-white/[0.12] text-white"
                  : "text-white/42 hover:bg-white/[0.07] hover:text-white/72"
              )}
            >
              {t(`filters.${value}`)}
            </button>
          ))}
        </div>

        {onUpload ? (
          <div
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              "mx-5 mb-3 flex min-h-20 shrink-0 items-center gap-3 rounded-2xl bg-white/[0.04] px-4 py-3 transition",
              dragActive && "bg-white/[0.1] ring-2 ring-white/24"
            )}
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.065] text-white/48">
              {uploadState ? (
                <IconLoader2 className="size-4 animate-spin" stroke={1.8} />
              ) : (
                <IconUpload className="size-4" stroke={1.8} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-medium text-white/64">
                {dragActive
                  ? t("upload.release")
                  : uploadState?.stage === "processing"
                    ? t("upload.processing")
                    : uploadState?.stage === "uploading"
                      ? t("upload.uploading", { progress: uploadState.progress })
                      : t("upload.prompt")}
              </p>
              <p className="mt-1 truncate text-[9px] text-white/30">{t("upload.hint")}</p>
              {uploadState?.stage === "uploading" ? (
                <div
                  className="mt-2 h-1 max-w-64 overflow-hidden rounded-full bg-white/[0.07]"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={uploadState.progress}
                >
                  <div
                    className="h-full rounded-full bg-white/58 transition-[width] duration-150"
                    style={{ width: `${uploadState.progress}%` }}
                  />
                </div>
              ) : null}
            </div>
            <button
              type="button"
              disabled={!canSelect || operationPending}
              title={!canSelect ? (disabledReason ?? undefined) : undefined}
              onClick={() => inputRef.current?.click()}
              className="h-9 shrink-0 rounded-xl bg-white/[0.09] px-3 text-[10px] font-medium text-white/72 transition hover:bg-white/[0.14] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
            >
              {t("upload.action")}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept={acceptedFileTypes}
              tabIndex={-1}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) void uploadFile(file);
              }}
            />
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {loading ? (
            <PickerState icon={<IconLoader2 className="size-5 animate-spin" stroke={1.7} />}>
              {t("loading")}
            </PickerState>
          ) : error ? (
            <PickerError message={error} retryLabel={t("retry")} onRetry={onRetry} />
          ) : candidates.length === 0 ? (
            <PickerState icon={<IconBookmark className="size-5" stroke={1.6} />}>
              <span className="font-medium text-white/58">{t("empty")}</span>
              <span className="mt-1 block text-[10px] leading-4 text-white/30">
                {t("emptyDescription")}
              </span>
            </PickerState>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {candidates.map((candidate, index) => {
                const current = candidate.asset.id === currentAssetId;
                const pending = candidate.asset.id === visiblePendingAssetId;
                const selectable = isSelectable(candidate);
                const blocked = !canSelect || (current ? !onClearSelection : !selectable);
                return (
                  <CandidatePickerCard
                    key={candidate.asset.id}
                    candidate={candidate}
                    index={index}
                    current={current}
                    pending={pending}
                    disabled={operationPending || blocked}
                    disabledReason={
                      !canSelect
                        ? (disabledReason ?? undefined)
                        : !selectable
                          ? unavailableReason?.(candidate)
                          : undefined
                    }
                    onSelect={() => void applyCandidateAction(candidate)}
                  />
                );
              })}
            </div>
          )}
        </div>

        {operationError ? (
          <div
            className="mx-5 mb-5 flex shrink-0 items-start gap-2 rounded-xl bg-destructive/10 px-3 py-2 text-[10px] leading-4 text-destructive-foreground"
            role="alert"
          >
            <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" stroke={1.8} />
            <span>{operationError}</span>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CandidatePickerCard({
  candidate,
  index,
  current,
  pending,
  disabled,
  disabledReason,
  onSelect,
}: {
  candidate: StoryCandidateAsset;
  index: number;
  current: boolean;
  pending: boolean;
  disabled: boolean;
  disabledReason?: string;
  onSelect: () => void;
}) {
  const t = useTranslations("storyStudio.canvas.candidatePicker");
  const { asset } = candidate;
  const label = t(`assetLabel.${asset.kind}`, { index: index + 1 });
  const metadataIncomplete =
    asset.kind === "video" &&
    candidate.videoVariant !== null &&
    (!candidate.videoVariant.checksumSha256 ||
      !candidate.videoVariant.width ||
      !candidate.videoVariant.height ||
      !candidate.videoVariant.durationSeconds);

  return (
    <button
      type="button"
      disabled={disabled}
      title={disabledReason}
      aria-label={current ? t("clearAsset", { label }) : t("selectAsset", { label })}
      onClick={onSelect}
      className={cn(
        "group cursor-pointer overflow-hidden rounded-[18px] bg-white/[0.045] text-left transition focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none",
        "hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-55"
      )}
    >
      <div className="relative aspect-video bg-black/28">
        {asset.previewUrl && asset.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.previewUrl} alt={label} className="size-full object-cover" />
        ) : asset.previewUrl && asset.kind === "video" ? (
          <video
            src={asset.previewUrl}
            aria-label={label}
            muted
            playsInline
            preload="metadata"
            className="size-full object-cover"
          />
        ) : (
          <div className="grid size-full place-items-center text-white/24">
            {asset.kind === "video" ? (
              <IconVideo className="size-6" stroke={1.5} />
            ) : (
              <IconPhoto className="size-6" stroke={1.5} />
            )}
          </div>
        )}
        {pending ? (
          <span className="absolute inset-0 grid place-items-center bg-black/55 backdrop-blur-[2px]">
            <IconLoader2 className="size-5 animate-spin text-white/82" stroke={1.8} />
          </span>
        ) : current ? (
          <span className="absolute top-2 right-2 grid size-7 place-items-center rounded-full bg-white text-black shadow-lg">
            <IconCheck className="size-4" stroke={2.2} />
          </span>
        ) : null}
      </div>
      <div className="px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-[10px] font-medium text-white/68">{label}</p>
          <span className="shrink-0 text-[8px] text-white/28">{t(`filters.${asset.kind}`)}</span>
        </div>
        <p className="mt-1 truncate text-[9px] text-white/32">
          {asset.width && asset.height
            ? `${asset.width}×${asset.height}`
            : asset.contentType.split("/", 2)[1]?.toUpperCase() || t(`filters.${asset.kind}`)}
          {asset.kind === "video" && asset.durationSeconds
            ? ` · ${formatDuration(asset.durationSeconds)}`
            : ""}
        </p>
        <p className="mt-1.5 flex min-h-3 items-center gap-1 text-[8px] leading-3 text-white/38">
          {current ? (
            <>
              <span className="group-hover:hidden group-focus-visible:hidden">{t("current")}</span>
              <span className="hidden text-white/62 group-hover:inline group-focus-visible:inline">
                {t("clear")}
              </span>
            </>
          ) : metadataIncomplete ? (
            <>
              <IconAlertTriangle className="size-2.5 shrink-0" stroke={1.8} />
              <span className="truncate">{t("metadataIncomplete")}</span>
            </>
          ) : (
            <span className="opacity-0 transition group-hover:opacity-100">{t("select")}</span>
          )}
        </p>
      </div>
    </button>
  );
}

function PickerState({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-full min-h-64 flex-col items-center justify-center px-6 text-center text-[11px] text-white/34">
      <span className="mb-3 grid size-11 place-items-center rounded-2xl bg-white/[0.055] text-white/30">
        {icon}
      </span>
      <span>{children}</span>
    </div>
  );
}

function PickerError({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry?: () => void;
}) {
  return (
    <div className="mx-auto mt-8 max-w-sm rounded-2xl bg-destructive/10 p-4 text-[10px] leading-4 text-destructive-foreground">
      <div className="flex items-start gap-2">
        <IconAlertTriangle className="mt-0.5 size-3.5 shrink-0" stroke={1.8} />
        <span>{message}</span>
      </div>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg bg-white/[0.07] px-2.5 py-1.5 font-medium text-white/68 transition hover:bg-white/[0.12] hover:text-white"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const rounded = Math.max(0, seconds);
  if (rounded < 60) return `${rounded.toFixed(rounded % 1 === 0 ? 0 : 1)}s`;
  const minutes = Math.floor(rounded / 60);
  const remainder = Math.round(rounded % 60);
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function fileMatchesAccept(file: File, accept: string): boolean {
  const fileName = file.name.toLowerCase();
  const contentType = file.type.toLowerCase();
  return accept
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .some((token) => {
      if (token.startsWith(".")) return fileName.endsWith(token);
      if (token.endsWith("/*")) return contentType.startsWith(token.slice(0, -1));
      return contentType === token;
    });
}
