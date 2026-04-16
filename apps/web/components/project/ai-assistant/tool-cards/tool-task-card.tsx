import { useEffect, useRef, useState } from "react";
import { IconAlertTriangle, IconCheck, IconLoader2, IconX } from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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

// Phase → i18n key mapping
const PHASE_I18N_KEY: Record<string, string> = {
  queued: "taskPhaseQueued",
  analyzing: "taskPhaseAnalyzing",
  chunking: "taskPhaseChunking",
  merging: "taskPhaseMerging",
  deduping: "taskPhaseDeduping",
  generating: "taskPhaseGenerating",
  processing: "taskPhaseProcessing",
};

// ─── Smooth progress hook ─────────────────────────────

function useSmoothProgress(realPct: number, isTerminal: boolean) {
  const [display, setDisplay] = useState(realPct);
  const realRef = useRef(realPct);
  const displayRef = useRef(realPct);
  const rafRef = useRef<number | null>(null);

  // Update real target when it changes
  useEffect(() => {
    realRef.current = realPct;
    // If real jumped ahead, snap display to real immediately
    if (realPct > displayRef.current + 5) {
      displayRef.current = realPct;
      setDisplay(realPct);
    }
  }, [realPct]);

  // Terminal → snap to 100
  useEffect(() => {
    if (isTerminal) {
      displayRef.current = 100;
      setDisplay(100);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    }
  }, [isTerminal]);

  // Slow creep between polls (~0.3%/s, never exceeding real + 8%)
  useEffect(() => {
    if (isTerminal) return;

    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      const real = realRef.current;
      const cur = displayRef.current;
      const ceiling = Math.min(real + 8, 99); // never hit 100 on fake progress

      if (cur < ceiling) {
        const next = Math.min(cur + dt * 0.3, ceiling);
        displayRef.current = next;
        setDisplay(Math.round(next));
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isTerminal]);

  return display;
}

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

  // ─── Derived state ─────────────────────────────────────

  const isTerminal =
    progress?.status === "done" ||
    progress?.status === "failed" ||
    progress?.status === "cancelled";

  // Cap at 99% while still processing — only show 100% when truly done
  const rawPct =
    progress && progress.chunksTotal > 0
      ? Math.round((progress.chunksCompleted / progress.chunksTotal) * 100)
      : (progress?.progress ?? 0);
  const realPct = !isTerminal ? Math.min(rawPct, 99) : rawPct;

  const smoothPct = useSmoothProgress(realPct, !!isTerminal);
  const filledBars = Math.round((smoothPct / 100) * BAR_COUNT);

  // Phase title
  const phaseTitle = progress
    ? PHASE_I18N_KEY[progress.phase]
      ? t(PHASE_I18N_KEY[progress.phase])
      : t("taskPhaseProcessing")
    : "";

  // ─── Render ────────────────────────────────────────────

  if (!progress) {
    return (
      <div className="flex items-center gap-2 px-4 py-5">
        <IconLoader2 className="size-4 animate-spin text-muted-foreground" />
        <span className="text-[13px] text-muted-foreground">{t("taskConnecting")}</span>
      </div>
    );
  }

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
              {t("toolFailed")}
            </span>
          ) : (
            <span className="flex items-center gap-1.5">
              <IconLoader2 className="size-4 animate-spin text-primary" />
              {phaseTitle}
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
            {smoothPct}%
          </span>

          {/* Cancel button */}
          {!isTerminal &&
            (confirmCancel ? (
              <Button
                variant="ghost"
                color="destructive"
                size="xs"
                onClick={() => void handleCancel()}
              >
                {t("taskCancelConfirm")}
              </Button>
            ) : (
              <Button
                variant="ghost"
                color="muted"
                size="icon-xs"
                onClick={() => void handleCancel()}
                title={t("taskCancelTooltip")}
              >
                <IconX className="size-3.5" />
              </Button>
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

      {/* Row 3: Segmented bar progress */}
      <div className="mt-3 flex items-end gap-0.75">
        {Array.from({ length: BAR_COUNT }, (_, i) => {
          const filled = i < filledBars;
          const ratio = i / BAR_COUNT;

          let bg: string;
          if (!filled) {
            bg = "rgb(255 255 255 / 0.08)";
          } else if (progress.status === "done") {
            bg = "rgb(34 197 94 / 0.7)";
          } else if (ratio < 0.5) {
            const t2 = ratio / 0.5;
            const r = Math.round(255 * (1 - t2 * 0.1));
            const g = Math.round(60 + t2 * 100);
            const b = Math.round(50 * (1 - t2));
            bg = `rgb(${r} ${g} ${b} / 0.85)`;
          } else {
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
        <div className="mt-6">
          <Button variant="solid" color="primary" className="w-full" onClick={handleContinue}>
            {t("taskContinue")}
          </Button>
        </div>
      )}

      {progress.status === "done" && continued && (
        <div className="mt-2 text-[11px] text-muted-foreground/50">{t("taskContinued")}</div>
      )}

      {/* Error + dismiss */}
      {(progress.status === "failed" || progress.status === "cancelled") && !continued && (
        <div className="mt-3 space-y-2">
          {progress.error && (
            <div className="rounded-lg bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              {progress.error}
            </div>
          )}
          <Button
            variant="outline"
            color="muted"
            className="w-full"
            onClick={() => setContinued(true)}
          >
            {t("usageInfoClose")}
          </Button>
        </div>
      )}
    </div>
  );
}
