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
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import { useAppSelector } from "@/src/store";
import type { Task, TaskStatus, TaskType } from "@/src/store/slices/taskSlice";
import { useTaskFetch } from "@/src/hooks/use-task-subscription";

// ─── Config ────────────────────────────────────────────

const STATUS_CONFIG: Record<
  TaskStatus,
  { icon: React.ComponentType<{ className?: string }>; label: string; color: string }
> = {
  pending: { icon: IconClock, label: "排队中", color: "text-muted-foreground" },
  running: { icon: IconLoader2, label: "执行中", color: "text-blue-400" },
  completed: { icon: IconCircleCheck, label: "已完成", color: "text-green-400" },
  failed: { icon: IconAlertTriangle, label: "失败", color: "text-red-400" },
  cancelled: { icon: IconX, label: "已取消", color: "text-muted-foreground" },
};

const TYPE_CONFIG: Record<
  TaskType,
  { icon: React.ComponentType<{ className?: string }>; label: string }
> = {
  image: { icon: IconPhoto, label: "生成图片" },
  video: { icon: IconVideo, label: "生成视频" },
};

// ─── Task Item ─────────────────────────────────────────

function TaskItem({ task, onSelect }: { task: Task; onSelect?: (task: Task) => void }) {
  const status = STATUS_CONFIG[task.status];
  const type = TYPE_CONFIG[task.type];
  const StatusIcon = status.icon;
  const TypeIcon = type.icon;
  const isRunning = task.status === "running";
  const timeAgo = formatTimeAgo(task.createdAt);

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
          <span className="truncate text-sm font-medium">{type.label}</span>
          {typeof task.input?.title === "string" && (
            <span className="truncate text-xs text-muted-foreground">{task.input.title}</span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <span className={cn("text-xs", status.color)}>{status.label}</span>
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
  useTaskFetch(userId);

  const tasks = useAppSelector((s) => s.task.tasks);

  const { activeTasks, tasksToShow } = useMemo(() => {
    const all = Object.values(tasks).sort((a, b) => b.createdAt - a.createdAt);
    const active = all.filter((t) => t.status === "pending" || t.status === "running");
    const toShow =
      active.length > 0
        ? active
        : all.filter((t) => t.status === "completed" || t.status === "failed").slice(0, 5);
    return { activeTasks: active, tasksToShow: toShow };
  }, [tasks]);

  if (tasksToShow.length === 0) {
    return null;
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {activeTasks.length > 0 ? `进行中的任务 (${activeTasks.length})` : "最近任务"}
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

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}
