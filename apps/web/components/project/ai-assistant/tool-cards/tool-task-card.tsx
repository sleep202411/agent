import { useEffect, useRef, useState } from "react";
import {
  IconAlertTriangle,
  IconCheck,
  IconLoader2,
  IconPlayerPlay,
  IconX,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { backendApi } from "@/src/lib/api";

// ─── Types ─────────────────────────────────────────────

interface TaskProgress {
  taskId: string;
  status: "queued" | "processing" | "done" | "failed" | "cancelled";
  phase: string;
  progress: number;
  chunksTotal: number;
  chunksCompleted: number;
  message: string;
  queuePosition?: number;
  result?: unknown;
  error?: string;
}

interface TaskCardProps {
  taskId: string;
  onContinue: (result: unknown) => void;
  onError: (error: string) => void;
}

const BAR_COUNT = 24;

// ─── Component ─────────────────────────────────────────

export function AssistantTaskCard({ taskId, onContinue, onError }: TaskCardProps) {
  const t = useTranslations("ai");
  const [progress, setProgress] = useState<TaskProgress | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [continued, setContinued] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const completedRef = useRef(false);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // ─── Polling ─────────────────────────────────────────

  useEffect(() => {
    if (completedRef.current) return;

    const poll = async () => {
      if (completedRef.current) return;
      try {
        const data = await backendApi.get<TaskProgress>(`/aurora/task/status/${taskId}`);
        if (!data || completedRef.current) return;

        setProgress(data);

        if (data.status === "done") {
          completedRef.current = true;
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        }

        if (data.status === "failed" || data.status === "cancelled") {
          completedRef.current = true;
          if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          onErrorRef.current(data.error || data.message || "Task failed");
        }
      } catch {
        // Keep polling
      }
    };

    void poll();
    pollTimerRef.current = setInterval(() => void poll(), 2000);

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [taskId]);

  // ─── Cancel ────────────────────────────────────────────

  const handleCancel = async () => {
    if (!confirmCancel) {
      setConfirmCancel(true);
      setTimeout(() => setConfirmCancel(false), 3000);
      return;
    }
    setConfirmCancel(false);
    try {
      await backendApi.post(`/aurora/task/cancel/${taskId}`);
    } catch {
      // ignore
    }
  };

  const handleContinue = () => {
    setContinued(true);
    onContinue(progress?.result);
  };

  // ─── Render ────────────────────────────────────────────

  if (!progress) {
    return (
      <div className="flex items-center gap-2 px-4 py-5">
        <IconLoader2 className="size-4 animate-spin text-muted-foreground" />
        <span className="text-[13px] text-muted-foreground">{t("taskConnecting")}</span>
      </div>
    );
  }

  const isTerminal =
    progress.status === "done" || progress.status === "failed" || progress.status === "cancelled";

  const pct =
    progress.chunksTotal > 0
      ? Math.round((progress.chunksCompleted / progress.chunksTotal) * 100)
      : progress.progress;

  const filledBars = Math.round((pct / 100) * BAR_COUNT);

  return (
    <div>
      {/* Row 1: Title + badge */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-bold leading-snug">
          {progress.status === "done" ? (
            <span className="flex items-center gap-1.5">
              <IconCheck className="size-4 text-green-500" />
              {t("completed")}
            </span>
          ) : progress.status === "failed" || progress.status === "cancelled" ? (
            <span className="flex items-center gap-1.5">
              <IconAlertTriangle className="size-4 text-destructive" />
              {progress.status === "failed" ? t("toolFailed") : t("taskCancelConfirm")}
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <IconLoader2 className="size-4 animate-spin text-primary" />
              {t("generatingText")}
            </span>
          )}
        </h3>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Progress badge */}
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[12px] font-semibold tabular-nums",
              isTerminal
                ? progress.status === "done"
                  ? "bg-green-500/15 text-green-500"
                  : "bg-destructive/15 text-destructive"
                : "bg-primary/15 text-primary"
            )}
          >
            {pct}%
          </span>

          {/* Cancel button */}
          {!isTerminal &&
            (confirmCancel ? (
              <button
                type="button"
                onClick={() => void handleCancel()}
                className="rounded-md px-2 py-0.5 text-[11px] font-medium text-destructive transition-colors hover:bg-white/8"
              >
                {t("taskCancelConfirm")}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleCancel()}
                title={t("taskCancelTooltip")}
                className="flex size-6 items-center justify-center rounded-md text-muted-foreground/50 transition-colors hover:bg-white/8 hover:text-foreground"
              >
                <IconX className="size-3.5" />
              </button>
            ))}
        </div>
      </div>

      {/* Row 2: Message */}
      <div className="relative mt-1 h-5 overflow-hidden">
        <div
          key={progress.message}
          className="animate-in slide-in-from-bottom-2 fade-in duration-300 text-[12px] leading-5 text-muted-foreground/70 truncate"
        >
          {progress.message}
        </div>
      </div>

      {/* Queue position */}
      {progress.status === "queued" &&
        progress.queuePosition != null &&
        progress.queuePosition > 0 && (
          <div className="mt-0.5 text-[11px] text-muted-foreground/50">
            {t("taskQueuePosition", { position: progress.queuePosition })}
          </div>
        )}

      {/* Row 3: Segmented bar progress (vertical bars with gradient) */}
      <div className="mt-3 flex items-end gap-0.75">
        {Array.from({ length: BAR_COUNT }, (_, i) => {
          const filled = i < filledBars;
          const ratio = i / BAR_COUNT;

          // Gradient: primary → orange → muted
          let bg: string;
          if (!filled) {
            bg = "rgb(255 255 255 / 0.08)";
          } else if (progress.status === "done") {
            bg = "rgb(34 197 94 / 0.7)"; // green
          } else if (ratio < 0.5) {
            // primary (red) → orange
            const t2 = ratio / 0.5;
            const r = Math.round(255 * (1 - t2 * 0.1));
            const g = Math.round(60 + t2 * 100);
            const b = Math.round(50 * (1 - t2));
            bg = `rgb(${r} ${g} ${b} / 0.85)`;
          } else {
            // orange → yellow-ish
            const t2 = (ratio - 0.5) / 0.5;
            const r = Math.round(240 - t2 * 30);
            const g = Math.round(160 + t2 * 40);
            const b = Math.round(30 + t2 * 20);
            bg = `rgb(${r} ${g} ${b} / 0.85)`;
          }

          return (
            <div
              key={i}
              className={cn(
                "flex-1 rounded-sm transition-all duration-500",
                filled ? "h-3" : "h-2.5"
              )}
              style={{ backgroundColor: bg }}
            />
          );
        })}
      </div>

      {/* Row 4: Action */}
      {progress.status === "done" && !continued && (
        <button
          type="button"
          onClick={handleContinue}
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-[13px] font-medium text-foreground transition-colors hover:bg-white/10"
        >
          <IconPlayerPlay className="size-3.5" />
          {t("taskContinue")}
        </button>
      )}

      {progress.status === "done" && continued && (
        <div className="mt-2 text-[11px] text-muted-foreground/50">{t("taskContinued")}</div>
      )}

      {/* Error */}
      {(progress.status === "failed" || progress.status === "cancelled") && progress.error && (
        <div className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
          {progress.error}
        </div>
      )}
    </div>
  );
}
