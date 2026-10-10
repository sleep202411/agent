import { useState } from "react";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import {
  taskScheduleInput,
  updateTaskSchedule,
  scheduleDateText,
  parseScheduleDate,
} from "./task-schedule-api";
import type { TaskDetail } from "./task-detail-api";

type Draft = {
  snapshot: TaskDetail;
  priority: TaskDetail["priority"];
  startAt: string;
  dueAt: string;
  attemptedAt?: TaskDetail;
  error?: string;
};

/** Lives with the task page so a detail refresh cannot discard a schedule or an in-flight save. */
export function useTaskScheduleSession(taskId: string, generation: number, onRefresh: () => void) {
  const [draft, setDraft] = useState<Draft>();
  const op = useAuthFormOperation(taskId, true);
  const current = () => generation === getAuthGeneration();
  return {
    draft,
    busy: op.busy,
    open(task: TaskDetail) {
      if (current() && !op.busy)
        setDraft({
          snapshot: task,
          priority: task.priority,
          startAt: scheduleDateText(task.startAt),
          dueAt: scheduleDateText(task.dueAt),
        });
    },
    change<K extends "priority" | "startAt" | "dueAt">(field: K, value: Draft[K]) {
      if (current() && !op.busy && !draft?.attemptedAt)
        setDraft((old) => old && { ...old, [field]: value });
    },
    review(task: TaskDetail) {
      if (
        !current() ||
        op.busy ||
        !draft ||
        task.id !== draft.snapshot.id ||
        task.crewId !== draft.snapshot.crewId ||
        task.version < draft.snapshot.version ||
        task === draft.attemptedAt
      )
        return;
      setDraft({
        snapshot: task,
        priority: draft.priority,
        startAt: draft.startAt,
        dueAt: draft.dueAt,
      });
    },
    cancel() {
      if (!current() || op.busy) return;
      setDraft(undefined);
      if (draft?.attemptedAt) onRefresh();
    },
    save(task: TaskDetail) {
      if (
        !current() ||
        !draft ||
        draft.attemptedAt ||
        op.busy ||
        task.id !== draft.snapshot.id ||
        task.crewId !== draft.snapshot.crewId ||
        ["approved", "cancelled"].includes(task.status) ||
        task.version !== draft.snapshot.version
      )
        return;
      let data;
      try {
        data = taskScheduleInput.parse({
          expectedVersion: draft.snapshot.version,
          priority: draft.priority,
          startAt: parseScheduleDate(draft.startAt, draft.snapshot.startAt),
          dueAt: parseScheduleDate(draft.dueAt, draft.snapshot.dueAt),
        });
      } catch {
        return;
      }
      void op.run(
        () => {
          setDraft({ ...draft, attemptedAt: task, error: undefined });
          return updateTaskSchedule(draft.snapshot, data);
        },
        () => {
          setDraft(undefined);
          onRefresh();
        },
        (cause) =>
          setDraft(
            (old) =>
              old && { ...old, error: cause instanceof Error ? cause.message : String(cause) }
          )
      );
    },
  };
}
export type TaskScheduleSession = ReturnType<typeof useTaskScheduleSession>;
