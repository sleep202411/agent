"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  IconAlertTriangle,
  IconChevronDown,
  IconChevronUp,
  IconCircleCheck,
  IconCloudUpload,
  IconExternalLink,
  IconFile,
  IconRefresh,
  IconX,
} from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { useTranslations } from "@/src/i18n/i18n";
import {
  isUploadAbort,
  type UploadFileCheckpoint,
  type UploadFileStage,
  uploadFileViaSignedUrl,
} from "@/src/lib/media-upload";
import { crewKeys } from "@/app/(site)/crews/_hooks/shared";
import {
  attachCrewAssetFile,
  discardPendingCrewAssetUpload,
  useCrewAssetContext,
} from "@/app/(site)/crews/[id]/workspace/_hooks/use-crew-assets";

const MAX_PARALLEL_TRANSFERS = 3;

type TransferStatus =
  | "queued"
  | UploadFileStage
  | "attaching"
  | "completed"
  | "failed"
  | "cancelled";

interface CrewTransferJob {
  id: string;
  file: File | null;
  fileName: string;
  sizeBytes: number;
  parentId: string | null;
  status: TransferStatus;
  progress: number;
  createdAt: number;
  checkpoint?: UploadFileCheckpoint;
  mediaAssetId?: string;
  nodeId?: string;
  error?: string;
}

interface CrewTransfersContextValue {
  enqueueAssetFiles: (files: File[], parentId: string | null) => void;
}

const CrewTransfersContext = createContext<CrewTransfersContextValue | null>(null);

export function useCrewTransfers(): CrewTransfersContextValue {
  const value = useContext(CrewTransfersContext);
  if (!value) {
    throw new Error("useCrewTransfers must be used within CrewTransfersProvider");
  }
  return value;
}

export function CrewTransfersProvider({
  crewId,
  children,
}: {
  crewId: string;
  children: ReactNode;
}) {
  const t = useTranslations("crewTransfers");
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const contextQuery = useCrewAssetContext(crewId);
  const [jobs, setJobs] = useState<CrewTransferJob[]>([]);
  const [expanded, setExpanded] = useState(true);
  const jobsRef = useRef<CrewTransferJob[]>([]);
  const mountedRef = useRef(true);
  const controllersRef = useRef(new Map<string, AbortController>());
  const executeRef = useRef<(jobId: string, controller: AbortController) => Promise<void>>(
    async () => undefined
  );
  const pumpRef = useRef<() => void>(() => undefined);

  const replaceJobs = useCallback((updater: (current: CrewTransferJob[]) => CrewTransferJob[]) => {
    if (!mountedRef.current) return;
    const next = updater(jobsRef.current);
    jobsRef.current = next;
    setJobs(next);
  }, []);

  const updateJob = useCallback(
    (jobId: string, patch: Partial<CrewTransferJob>) => {
      replaceJobs((current) =>
        current.map((job) => (job.id === jobId ? { ...job, ...patch } : job))
      );
    },
    [replaceJobs]
  );

  const executeTransfer = useCallback(
    async (jobId: string, controller: AbortController) => {
      try {
        let job = jobsRef.current.find((candidate) => candidate.id === jobId);
        if (!job) return;

        let mediaAssetId = job.mediaAssetId;
        if (!mediaAssetId) {
          if (!job.file) throw new Error(t("fileUnavailable"));
          const uploaded = await uploadFileViaSignedUrl(job.file, {
            kind: "crew_asset_file",
            scope: { crewId },
            signal: controller.signal,
            resumeFrom: job.checkpoint,
            onStage: (status) =>
              updateJob(jobId, {
                status,
                ...(status === "confirming" ? { progress: 100 } : {}),
              }),
            onProgress: (progress) => updateJob(jobId, { progress }),
            onCheckpoint: (checkpoint) =>
              updateJob(jobId, {
                checkpoint,
                progress: 100,
              }),
          });
          mediaAssetId = uploaded.mediaAssetId;
          updateJob(jobId, { mediaAssetId, progress: 100 });
        }

        if (controller.signal.aborted) {
          throw new DOMException("Upload aborted", "AbortError");
        }
        updateJob(jobId, { status: "attaching", progress: 100 });
        job = jobsRef.current.find((candidate) => candidate.id === jobId);
        if (!job) return;
        const node = await attachCrewAssetFile(crewId, {
          name: job.fileName,
          parentId: job.parentId,
          mediaAssetId,
        });
        updateJob(jobId, {
          status: "completed",
          progress: 100,
          nodeId: node.id,
          error: undefined,
          file: null,
        });
        await queryClient.invalidateQueries({ queryKey: crewKeys.assets(crewId) });
      } catch (error) {
        if (isUploadAbort(error) || controller.signal.aborted) {
          updateJob(jobId, { status: "cancelled", error: undefined });
        } else {
          updateJob(jobId, {
            status: "failed",
            error: describeError(error, t("unknownError")),
          });
          setExpanded(true);
        }
      } finally {
        void queryClient.invalidateQueries({ queryKey: crewKeys.assetContext(crewId) });
        controllersRef.current.delete(jobId);
        queueMicrotask(() => pumpRef.current());
      }
    },
    [crewId, queryClient, t, updateJob]
  );

  useEffect(() => {
    executeRef.current = executeTransfer;
  }, [executeTransfer]);

  const pump = useCallback(() => {
    if (!mountedRef.current) return;
    const available = MAX_PARALLEL_TRANSFERS - controllersRef.current.size;
    if (available <= 0) return;
    const queued = jobsRef.current.filter((job) => job.status === "queued").slice(0, available);

    for (const job of queued) {
      const controller = new AbortController();
      controllersRef.current.set(job.id, controller);
      updateJob(job.id, {
        status: job.mediaAssetId ? "attaching" : job.checkpoint ? "confirming" : "signing",
      });
      void executeRef.current(job.id, controller);
    }
  }, [updateJob]);

  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  useEffect(() => {
    mountedRef.current = true;
    const controllers = controllersRef.current;
    return () => {
      mountedRef.current = false;
      for (const controller of controllers.values()) {
        controller.abort();
      }
      controllers.clear();
    };
  }, []);

  const enqueueAssetFiles = useCallback(
    (files: File[], parentId: string | null) => {
      if (files.length === 0) return;
      const context = contextQuery.data;
      if (!context?.capabilities.upload || !context.storageAvailable) {
        toast.error(t("storageUnavailable"));
        return;
      }

      const now = Date.now();
      const nextJobs = files.map<CrewTransferJob>((file, index) => {
        const oversized = file.size > context.maxUploadBytes;
        return {
          id: crypto.randomUUID(),
          file,
          fileName: file.name,
          sizeBytes: file.size,
          parentId,
          status: oversized ? "failed" : "queued",
          progress: 0,
          createdAt: now + index,
          ...(oversized
            ? {
                error: t("fileTooLarge", {
                  size: formatBytes(context.maxUploadBytes),
                }),
              }
            : {}),
        };
      });

      replaceJobs((current) => [...current, ...nextJobs]);
      setExpanded(true);
      queueMicrotask(() => pumpRef.current());
    },
    [contextQuery.data, replaceJobs, t]
  );

  const cancelJob = useCallback(
    (jobId: string) => {
      const job = jobsRef.current.find((candidate) => candidate.id === jobId);
      if (!job || !canCancel(job.status)) return;
      const controller = controllersRef.current.get(jobId);
      if (controller) {
        controller.abort();
      } else {
        updateJob(jobId, { status: "cancelled", error: undefined });
        queueMicrotask(() => pumpRef.current());
      }
    },
    [updateJob]
  );

  const retryJob = useCallback(
    (jobId: string) => {
      const job = jobsRef.current.find((candidate) => candidate.id === jobId);
      if (!job || (job.status !== "failed" && job.status !== "cancelled")) return;
      if (!job.file && !job.checkpoint && !job.mediaAssetId) {
        updateJob(jobId, { error: t("fileUnavailable") });
        return;
      }
      updateJob(jobId, {
        status: "queued",
        error: undefined,
        progress: job.mediaAssetId || job.checkpoint ? 100 : 0,
      });
      queueMicrotask(() => pumpRef.current());
    },
    [t, updateJob]
  );

  const discardIfPending = useCallback(
    async (job: CrewTransferJob) => {
      if (!job.mediaAssetId || job.nodeId) return;
      try {
        await discardPendingCrewAssetUpload(crewId, job.mediaAssetId);
      } catch (error) {
        // The server cleanup worker is the final safety net if the browser
        // disappears or this best-effort discard cannot reach it.
        console.warn("[crew-transfers] pending upload cleanup failed", error);
      }
    },
    [crewId]
  );

  const removeJob = useCallback(
    (jobId: string) => {
      const job = jobsRef.current.find((candidate) => candidate.id === jobId);
      if (!job || !isTerminal(job.status)) return;
      replaceJobs((current) => current.filter((candidate) => candidate.id !== jobId));
      void discardIfPending(job);
    },
    [discardIfPending, replaceJobs]
  );

  const clearFinished = useCallback(() => {
    const terminal = jobsRef.current.filter((job) => isTerminal(job.status));
    replaceJobs((current) => current.filter((job) => !isTerminal(job.status)));
    void Promise.allSettled(terminal.map(discardIfPending));
  }, [discardIfPending, replaceJobs]);

  const cancelAll = useCallback(() => {
    for (const job of jobsRef.current) {
      if (canCancel(job.status)) cancelJob(job.id);
    }
  }, [cancelJob]);

  const openAsset = useCallback(
    (nodeId: string) => {
      router.push(`${pathname}?tab=assets&asset=${encodeURIComponent(nodeId)}`);
    },
    [pathname, router]
  );

  const value = useMemo<CrewTransfersContextValue>(
    () => ({ enqueueAssetFiles }),
    [enqueueAssetFiles]
  );

  return (
    <CrewTransfersContext.Provider value={value}>
      {children}
      <CrewTransferPanel
        jobs={jobs}
        expanded={expanded}
        onExpandedChange={setExpanded}
        onCancel={cancelJob}
        onCancelAll={cancelAll}
        onRetry={retryJob}
        onRemove={removeJob}
        onClearFinished={clearFinished}
        onOpenAsset={openAsset}
      />
    </CrewTransfersContext.Provider>
  );
}

function CrewTransferPanel({
  jobs,
  expanded,
  onExpandedChange,
  onCancel,
  onCancelAll,
  onRetry,
  onRemove,
  onClearFinished,
  onOpenAsset,
}: {
  jobs: CrewTransferJob[];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onCancel: (jobId: string) => void;
  onCancelAll: () => void;
  onRetry: (jobId: string) => void;
  onRemove: (jobId: string) => void;
  onClearFinished: () => void;
  onOpenAsset: (nodeId: string) => void;
}) {
  const t = useTranslations("crewTransfers");
  if (jobs.length === 0) return null;

  const activeCount = jobs.filter((job) => !isTerminal(job.status)).length;
  const failedCount = jobs.filter((job) => job.status === "failed").length;
  const completedCount = jobs.filter((job) => job.status === "completed").length;
  const terminalCount = jobs.length - activeCount;
  const overallProgress = weightedProgress(jobs);
  const summary =
    activeCount > 0
      ? t("transferring", { count: activeCount })
      : failedCount > 0
        ? t("needsAttention", { count: failedCount })
        : t("allComplete", { count: completedCount });

  return (
    <section
      aria-label={t("title")}
      className={cn(
        "fixed bottom-16 right-4 z-[70] w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-background shadow-2xl shadow-black/45",
        expanded && "ring-1 ring-white/[0.025]"
      )}
    >
      <button
        type="button"
        onClick={() => onExpandedChange(!expanded)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-secondary/35"
      >
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-secondary text-foreground">
          {failedCount > 0 && activeCount === 0 ? (
            <IconAlertTriangle className="size-4 text-destructive" />
          ) : activeCount === 0 ? (
            <IconCircleCheck className="size-4 text-emerald-400" />
          ) : (
            <IconCloudUpload className="size-4 text-primary" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-foreground">{t("title")}</span>
          <span className="block truncate text-[11px] text-muted-foreground" aria-live="polite">
            {summary}
          </span>
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">{overallProgress}%</span>
        {expanded ? (
          <IconChevronDown className="size-4 text-muted-foreground" />
        ) : (
          <IconChevronUp className="size-4 text-muted-foreground" />
        )}
      </button>

      <div
        className="h-0.5 bg-secondary"
        role="progressbar"
        aria-label={t("overallProgress")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={overallProgress}
      >
        <div
          className={cn(
            "h-full transition-[width] duration-300",
            failedCount > 0 && activeCount === 0 ? "bg-destructive" : "bg-primary"
          )}
          style={{ width: `${overallProgress}%` }}
        />
      </div>

      {expanded ? (
        <>
          <div className="max-h-[min(25rem,calc(100dvh-13rem))] overflow-y-auto">
            {jobs.map((job) => (
              <TransferRow
                key={job.id}
                job={job}
                onCancel={() => onCancel(job.id)}
                onRetry={() => onRetry(job.id)}
                onRemove={() => onRemove(job.id)}
                onOpen={job.nodeId ? () => onOpenAsset(job.nodeId!) : undefined}
              />
            ))}
          </div>
          <footer className="flex min-h-10 items-center justify-end gap-2 border-t border-border/70 px-3 py-2">
            {activeCount > 0 ? (
              <button
                type="button"
                onClick={onCancelAll}
                className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                {t("cancelAll")}
              </button>
            ) : null}
            {terminalCount > 0 ? (
              <button
                type="button"
                onClick={onClearFinished}
                className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                {t("clearFinished")}
              </button>
            ) : null}
          </footer>
        </>
      ) : null}
    </section>
  );
}

function TransferRow({
  job,
  onCancel,
  onRetry,
  onRemove,
  onOpen,
}: {
  job: CrewTransferJob;
  onCancel: () => void;
  onRetry: () => void;
  onRemove: () => void;
  onOpen?: () => void;
}) {
  const t = useTranslations("crewTransfers");
  const active = !isTerminal(job.status);
  const cancellable = canCancel(job.status);
  return (
    <article className="border-b border-border/60 px-3.5 py-3 last:border-b-0">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-secondary/70">
          <IconFile className="size-4 text-muted-foreground" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium text-foreground" title={job.fileName}>
                {job.fileName}
              </p>
              <p
                className={cn(
                  "mt-0.5 truncate text-[11px] text-muted-foreground",
                  job.status === "failed" && "text-destructive",
                  job.status === "completed" && "text-emerald-400"
                )}
                title={job.error}
                aria-live={job.status === "failed" ? "assertive" : "polite"}
              >
                {job.error ?? `${t(`status.${job.status}`)} · ${formatBytes(job.sizeBytes)}`}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {cancellable ? (
                <IconAction label={t("cancel")} onClick={onCancel}>
                  <IconX />
                </IconAction>
              ) : null}
              {job.status === "failed" || job.status === "cancelled" ? (
                <IconAction label={t("retry")} onClick={onRetry}>
                  <IconRefresh />
                </IconAction>
              ) : null}
              {job.status === "completed" && onOpen ? (
                <IconAction label={t("openAsset")} onClick={onOpen}>
                  <IconExternalLink />
                </IconAction>
              ) : null}
              {isTerminal(job.status) ? (
                <IconAction label={t("remove")} onClick={onRemove}>
                  <IconX />
                </IconAction>
              ) : null}
            </div>
          </div>

          {(active || job.status === "failed") && job.status !== "signing" ? (
            <div
              className="mt-2 h-1 overflow-hidden rounded-full bg-secondary"
              role="progressbar"
              aria-label={t("fileProgress", { name: job.fileName })}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={job.progress}
            >
              <div
                className={cn(
                  "h-full transition-[width] duration-200",
                  job.status === "failed" ? "bg-destructive" : "bg-primary"
                )}
                style={{ width: `${job.progress}%` }}
              />
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground [&_svg]:size-3.5"
    >
      {children}
    </button>
  );
}

function isTerminal(status: TransferStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function canCancel(status: TransferStatus): boolean {
  return (
    status === "queued" || status === "signing" || status === "uploading" || status === "confirming"
  );
}

function weightedProgress(jobs: CrewTransferJob[]): number {
  const totalBytes = jobs.reduce((sum, job) => sum + Math.max(1, job.sizeBytes), 0);
  if (totalBytes === 0) return 0;
  const transferred = jobs.reduce((sum, job) => {
    const progress = job.status === "completed" ? 100 : job.progress;
    return sum + Math.max(1, job.sizeBytes) * progress;
  }, 0);
  return Math.max(0, Math.min(100, Math.round(transferred / totalBytes)));
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unit;
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
