"use client";

import { useAuth } from "@/app/_components/auth-provider";
import { useQuery } from "@tanstack/react-query";
import {
  getProjectCrewAssetContext,
  listAllProjectCrewAssets,
} from "@/lib/collab/project-crew-assets-api";
import {
  useLayoutEffect,
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
  addStoryCandidateAsset,
  storyApiErrorMessage,
  type MediaAssetSummary,
  type StoryCandidateAsset,
} from "@/lib/story-projects-api";

const REFERENCE_VIDEO_MAX_BYTES = 2 * 1024 * 1024 * 1024;

function isVideoUpload(file: File): boolean {
  return file.type.startsWith("video/") || /\.(mp4|mov)$/i.test(file.name);
}

export type StoryCandidatePickerKind = Extract<MediaAssetSummary["kind"], "image" | "video">;
type StoryCandidatePickerFilter = "all" | StoryCandidatePickerKind;
export type StoryCandidateAssetUploadState =
  | { stage: "uploading"; progress: number }
  | { stage: "processing" };

const CANDIDATE_PENDING_FEEDBACK_DELAY_MS = 180;

export interface StoryCandidateAssetPickerDialogProps {
  projectId?: string;
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
  onSelect: (candidate: StoryCandidateAsset, signal?: AbortSignal) => Promise<void>;
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
export function StoryCandidateAssetPickerDialog(props: StoryCandidateAssetPickerDialogProps) {
  const { user } = useAuth();
  const sessionKey = JSON.stringify([
    props.projectId,
    user?.id,
    props.open,
    // A transient capability change must not remount the picker and abort an
    // upload already accepted by the user. Upload confirmation and candidate
    // attachment re-check authorization on the server.
    [...props.allowedKinds].sort(),
  ]);
  return props.projectId ? (
    <CrewCandidateDialog
      key={sessionKey}
      {...props}
      projectId={props.projectId}
      userId={user ? String(user.id) : ""}
    />
  ) : (
    <CandidateDialog key={sessionKey} {...props} />
  );
}
function CrewCandidateDialog(
  props: StoryCandidateAssetPickerDialogProps & { projectId: string; userId: string }
) {
  const { projectId, open, items: suppliedItems } = props;
  const context = useQuery({
    queryKey: ["project-crew-assets", `story:${projectId}`, "context", props.userId],
    queryFn: ({ signal }) => getProjectCrewAssetContext(`story:${projectId}`, signal),
    enabled: open && Boolean(projectId && props.userId),
    retry: false,
  });
  const crewId = context.data?.crew?.id;
  const crew = useQuery({
    queryKey: ["project-crew-assets", `story:${projectId}`, "picker", props.userId, crewId],
    queryFn: ({ signal }) => listAllProjectCrewAssets(`story:${projectId}`, signal),
    enabled: open && Boolean(projectId && props.userId && crewId) && !context.isError,
    retry: false,
  });
  const items = useMemo(() => {
    const result = [...suppliedItems];
    const ids = new Set(result.map((item) => item.asset.id));
    for (const node of context.isError ? [] : (crew.data ?? [])) {
      if (!node.media || ids.has(node.media.id)) continue;
      ids.add(node.media.id);
      result.push({
        asset: {
          ...node.media,
          fileName: node.name,
          status: "ready",
          moderationStatus: "unreviewed",
          checksumSha256: null,
        },
        videoVariant: null,
        addedAt: "",
        addedByUserId: "",
      });
    }
    return result;
  }, [suppliedItems, crew.data, context.isError]);
  return (
    <CandidateDialog
      key={`${crewId}:${context.isError}`}
      {...props}
      items={items}
      loading={props.loading || context.isLoading || crew.isLoading}
      error={props.error ?? context.error?.message ?? crew.error?.message ?? null}
      onRetry={() => {
        props.onRetry?.();
        if (context.isError) void context.refetch();
        else if (crewId) void crew.refetch();
      }}
      onSelect={async (candidate, signal) => {
        signal?.throwIfAborted();
        // Register the selected shared asset through the existing authorized import
        // path before binding it to a film/game production slot.
        if (!suppliedItems.some((item) => item.asset.id === candidate.asset.id)) {
          const imported = await addStoryCandidateAsset(projectId, candidate.asset.id, signal);
          signal?.throwIfAborted();
          await props.onSelect(imported, signal);
          return;
        }
        await props.onSelect(candidate, signal);
      }}
    />
  );
}

function CandidateDialog({
  projectId,
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
  const activeRef = useRef(false);
  const operationAbortRef = useRef<AbortController | null>(null);
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

  useLayoutEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      operationAbortRef.current?.abort();
      if (pendingFeedbackTimerRef.current !== null) clearTimeout(pendingFeedbackTimerRef.current);
    };
  }, []);

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
    if (!activeRef.current || operationAbortRef.current || operationPending) return;
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
    const controller = new AbortController();
    const action = current ? onClearSelection : () => onSelect(candidate, controller.signal);
    if (
      !activeRef.current ||
      !open ||
      !canSelect ||
      operationAbortRef.current ||
      operationPending ||
      !action ||
      (!current && !isSelectable(candidate))
    ) {
      return;
    }
    operationAbortRef.current = controller;
    beginCandidatePending(candidate.asset.id);
    setSelectionError(null);
    let succeeded = false;
    try {
      await action();
      succeeded = true;
    } catch (candidateError) {
      if (controller.signal.aborted) return;
      setSelectionError(
        storyApiErrorMessage(candidateError, t(current ? "clearError" : "selectError"))
      );
    } finally {
      if (!controller.signal.aborted && operationAbortRef.current === controller) {
        operationAbortRef.current = null;
        finishCandidatePending();
        if (succeeded) onOpenChange(false);
      }
    }
  };

  const uploadFile = async (file: File) => {
    if (
      !activeRef.current ||
      !open ||
      !onUpload ||
      !canSelect ||
      operationAbortRef.current ||
      operationPending
    )
      return;
    if (!fileMatchesAccept(file, acceptedFileTypes)) {
      setUploadError(t("upload.unsupported"));
      return;
    }
    if (isVideoUpload(file) && file.size > REFERENCE_VIDEO_MAX_BYTES) {
      setUploadError(t("upload.tooLarge"));
      return;
    }

    const controller = new AbortController();
    operationAbortRef.current = controller;
    setSelectionError(null);
    setUploadError(null);
    setUploadState({ stage: "uploading", progress: 0 });
    try {
      await onUpload(
        file,
        (state) => {
          if (controller.signal.aborted || operationAbortRef.current !== controller) return;
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
      if (!controller.signal.aborted) onOpenChange(false);
    } catch (error) {
      if (!controller.signal.aborted) {
        setUploadError(storyApiErrorMessage(error, t("upload.error")));
      }
    } finally {
      if (!controller.signal.aborted && operationAbortRef.current === controller) {
        operationAbortRef.current = null;
        setUploadState(null);
      }
    }
  };

  const handleDragEnter = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (
      !activeRef.current ||
      !open ||
      !onUpload ||
      !canSelect ||
      operationAbortRef.current ||
      operationPending
    )
      return;
    dragDepthRef.current += 1;
    setDragActive(true);
  };

  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (
      !activeRef.current ||
      !open ||
      !onUpload ||
      !canSelect ||
      operationAbortRef.current ||
      operationPending
    )
      return;
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
    if (
      !activeRef.current ||
      !open ||
      !onUpload ||
      !canSelect ||
      operationAbortRef.current ||
      operationPending
    )
      return;
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
                {t(projectId ? "sharedDescription" : "description")}
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
              <p className="mt-1 truncate text-[9px] text-white/30">
                {normalizedKinds.includes("video") ? t("upload.videoLimit") : t("upload.hint")}
              </p>
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
                    canClear={Boolean(onClearSelection)}
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
  canClear,
  pending,
  disabled,
  disabledReason,
  onSelect,
}: {
  candidate: StoryCandidateAsset;
  index: number;
  current: boolean;
  canClear: boolean;
  pending: boolean;
  disabled: boolean;
  disabledReason?: string;
  onSelect: () => void;
}) {
  const t = useTranslations("storyStudio.canvas.candidatePicker");
  const { asset } = candidate;
  const label = asset.fileName || t(`assetLabel.${asset.kind}`, { index: index + 1 });
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
      aria-label={
        current
          ? canClear && !disabled
            ? t("clearAsset", { label })
            : `${label} · ${t("current")}`
          : t("selectAsset", { label })
      }
      onClick={onSelect}
      className={cn(
        "group cursor-pointer overflow-hidden rounded-[18px] bg-white/[0.045] text-left transition focus-visible:ring-2 focus-visible:ring-white/35 focus-visible:outline-none",
        "enabled:hover:bg-white/[0.08] disabled:cursor-not-allowed"
      )}
    >
      <div className="relative aspect-video bg-black/28 group-disabled:opacity-60">
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
          <p title={label} className="truncate text-[10px] font-medium text-white/68">
            {label}
          </p>
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
        <p className="mt-1.5 flex min-h-4 items-start gap-1 text-[10px] leading-4 text-white/70">
          {disabled && disabledReason ? (
            <span>{disabledReason}</span>
          ) : current && canClear && !disabled ? (
            <>
              <span className="group-hover:hidden group-focus-visible:hidden">{t("current")}</span>
              <span className="hidden text-white/62 group-hover:inline group-focus-visible:inline">
                {t("clear")}
              </span>
            </>
          ) : current ? (
            <span>{t("current")}</span>
          ) : metadataIncomplete ? (
            <>
              <IconAlertTriangle className="size-2.5 shrink-0" stroke={1.8} />
              <span className="truncate">{t("metadataIncomplete")}</span>
            </>
          ) : !disabled ? (
            <span className="opacity-0 transition group-hover:opacity-100">{t("select")}</span>
          ) : null}
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
