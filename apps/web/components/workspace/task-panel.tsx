"use client";

import { useMemo } from "react";
import {
  IconLoader2,
  IconCircleCheck,
  IconAlertTriangle,
  IconClock,
  IconX,
  IconPhoto,
  IconVideo,
  IconMicrophone,
  IconWand,
} from "@tabler/icons-react";
import { useTranslations } from "@/src/i18n/i18n";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/src/store";
import type { Task, TaskStatus, TaskType } from "@/src/store/slices/taskSlice";
import { useTaskFetch } from "@/src/hooks/use-task-subscription";

// ─── Config ────────────────────────────────────────────

const STATUS_CONFIG: Record<
  TaskStatus,
  { icon: React.ComponentType<{ className?: string }>; labelKey: string; color: string }
> = {
  waiting: { icon: IconClock, labelKey: "taskWaiting", color: "text-muted-foreground" },
  pending: { icon: IconClock, labelKey: "taskPending", color: "text-muted-foreground" },
  running: { icon: IconLoader2, labelKey: "taskRunning", color: "text-blue-400" },
  completed: { icon: IconCircleCheck, labelKey: "taskCompleted", color: "text-green-400" },
  failed: { icon: IconAlertTriangle, labelKey: "taskFailed", color: "text-red-400" },
  cancelled: { icon: IconX, labelKey: "taskCancelled", color: "text-muted-foreground" },
};

const TYPE_CONFIG: Record<
  TaskType,
  { icon: React.ComponentType<{ className?: string }>; labelKey: string }
> = {
  agent: { icon: IconWand, labelKey: "taskAgent" },
  production: { icon: IconWand, labelKey: "taskProduction" },
  image: { icon: IconPhoto, labelKey: "taskImage" },
  video: { icon: IconVideo, labelKey: "taskVideo" },
  audio: { icon: IconMicrophone, labelKey: "taskAudio" },
  fusion: { icon: IconWand, labelKey: "taskFusion" },
  lip_sync: { icon: IconVideo, labelKey: "taskLipSync" },
};

// ─── Task Item ─────────────────────────────────────────

function TaskItem({ task, onSelect }: { task: Task; onSelect?: (task: Task) => void }) {
  const t = useTranslations("workspace");
  const status = STATUS_CONFIG[task.status];
  const type = TYPE_CONFIG[task.type];
  const StatusIcon = status.icon;
  const TypeIcon = type.icon;
  const isRunning = task.status === "running";
  const timeAgo = formatTimeAgo(task.createdAt, t);

  return (
    <div
      onClick={() => onSelect?.(task)}
      className={cn(
        "flex items-center gap-3 rounded-lg border border-border bg-card/50 px-3 py-2.5",
        "transition-colors hover:bg-card/80",
        onSelect && "cursor-pointer"
      )}
    >
      <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted">
        <TypeIcon className="size-4 text-muted-foreground" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{t(type.labelKey)}</span>
          {typeof task.input?.title === "string" && (
            <span className="truncate text-xs text-muted-foreground">{task.input.title}</span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span className={cn("text-xs", status.color)}>{t(status.labelKey)}</span>
          <span className="text-xs text-muted-foreground">{timeAgo}</span>
        </div>
      </div>

      <StatusIcon className={cn("size-4 shrink-0", status.color, isRunning && "animate-spin")} />
    </div>
  );
}

// ─── Task Panel ────────────────────────────────────────

interface TaskPanelProps {
  userId: string | undefined;
  className?: string;
  onSelectTask?: (task: Task) => void;
}

export function TaskPanel({ userId, className, onSelectTask }: TaskPanelProps) {
  const t = useTranslations("workspace");
  const { error, retry } = useTaskFetch(userId);

  const tasks = useAppSelector((s) => s.task.tasks);

  const { activeTasks, tasksToShow } = useMemo(() => {
    const all = Object.values(tasks).sort((a, b) => b.createdAt - a.createdAt);
    const active = all.filter(
      (t) => t.status === "pending" || t.status === "running" || t.status === "waiting"
    );
    const toShow =
      active.length > 0
        ? active
        : all.filter((t) => t.status === "completed" || t.status === "failed").slice(0, 5);
    return { activeTasks: active, tasksToShow: toShow };
  }, [tasks]);

  if (tasksToShow.length === 0 && error === null) {
    return null;
  }

  return (
    <div className={cn("space-y-3", className)}>
      {error !== null && (
        <div role="status" className="text-sm text-muted-foreground">
          {t("taskLoadError")}{" "}
          <button type="button" className="underline" onClick={retry}>
            {t("taskRetry")}
          </button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {activeTasks.length > 0
            ? t("activeTasks", { count: activeTasks.length })
            : t("recentTasks")}
        </h2>
      </div>

      <div className="space-y-2">
        {tasksToShow.map((task) => (
          <TaskItem key={task.id} task={task} onSelect={onSelectTask} />
        ))}
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────

function formatTimeAgo(timestamp: number, t: ReturnType<typeof useTranslations>): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return t("justNow");
  if (seconds < 3600) return t("minutesAgo", { count: Math.floor(seconds / 60) });
  if (seconds < 86400) return t("hoursAgo", { count: Math.floor(seconds / 3600) });
  return t("daysAgo", { count: Math.floor(seconds / 86400) });
}
