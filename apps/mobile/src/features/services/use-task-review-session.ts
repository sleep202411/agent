import { useCallback, useRef, useState } from "react";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import type { TaskDetail } from "./task-detail-api";
import { primaryVideo, reviewTask, type TaskReviewInput } from "./task-review-api";

type Draft = {
  submissionId: string;
  note: string;
  deadline: string;
  selected?: string;
};

/** Keep review input and pending writes owned by the task page during detail retries. */
export function useTaskReviewSession(taskId: string, generation: number, onRefresh: () => void) {
  const latestSnapshot = useRef<TaskDetail | undefined>(undefined);
  const observe = useCallback((task: TaskDetail) => {
    latestSnapshot.current = task;
  }, []);
  const [draft, setDraft] = useState<Draft>();
  const [attemptedAt, setAttemptedAt] = useState<TaskDetail>();
  const [error, setError] = useState<string>();
  const op = useAuthFormOperation(taskId, true);
  const values = (task: TaskDetail): Draft => {
    const submissionId = task.submissions[0]?.id ?? "";
    return draft?.submissionId === submissionId
      ? {
          ...draft,
          selected: task.submissions[0]?.assets.some(
            (a) => a.id === draft.selected && a.contentType?.startsWith("video/")
          )
            ? draft.selected
            : primaryVideo(task),
        }
      : { submissionId, note: "", deadline: "", selected: primaryVideo(task) };
  };
  const locked = (task: TaskDetail) => op.busy || attemptedAt === task;
  return {
    values,
    observe,
    locked,
    error,
    change(task: TaskDetail, field: "note" | "deadline" | "selected", value: string) {
      if (generation !== getAuthGeneration() || task.id !== taskId || locked(task)) return;
      setDraft({ ...values(task), [field]: value });
    },
    save(task: TaskDetail, input: TaskReviewInput) {
      if (
        generation !== getAuthGeneration() ||
        task.id !== taskId ||
        locked(task) ||
        task.status !== "submitted" ||
        task.submissions[0]?.id !== input.expectedSubmissionId
      )
        return;
      void op.run(
        () => {
          setAttemptedAt(task);
          setError(undefined);
          return reviewTask(task.id, task.crewId, input);
        },
        () => {
          setDraft(undefined);
          onRefresh();
        },
        (cause) => {
          setAttemptedAt(latestSnapshot.current ?? task);
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      );
    },
  };
}
export type TaskReviewSession = ReturnType<typeof useTaskReviewSession>;
