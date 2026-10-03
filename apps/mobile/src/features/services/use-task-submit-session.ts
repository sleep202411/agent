import { useCallback, useRef, useState } from "react";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import type { CrewAsset } from "@/features/crew-assets/api";
import type { TaskDetail } from "./task-detail-api";
import type { DeliveryTemplate } from "./task-delivery-api";
import {
  submitTask,
  type DeliveryAnswers,
  type DeliveryFolder,
  type TaskSubmitInput,
} from "./task-submit-api";

/** Task-page ownership keeps input and pending writes alive during detail reloads. */
export function useTaskSubmitSession(taskId: string, generation: number, onRefresh: () => void) {
  const [note, setNote] = useState("");
  const [assets, setAssets] = useState<Pick<CrewAsset, "id" | "name">[]>([]);
  const [folder, setFolder] = useState<DeliveryFolder>();
  const [answersByTemplate, setAnswersByTemplate] = useState<Record<string, DeliveryAnswers>>({});
  const [attemptedAt, setAttemptedAt] = useState<TaskDetail>();
  const [error, setError] = useState<string>();
  const latestSnapshot = useRef<TaskDetail | undefined>(undefined);
  const observe = useCallback((task: TaskDetail) => {
    latestSnapshot.current = task;
  }, []);
  const op = useAuthFormOperation(taskId, true);
  const locked = (task: TaskDetail) => op.busy || attemptedAt === task;
  return {
    note,
    setNote,
    assets,
    setAssets,
    folder,
    setFolder,
    answersByTemplate,
    setAnswersByTemplate,
    observe,
    locked,
    error,
    busy: op.busy,
    save(
      task: TaskDetail,
      userId: string,
      input: TaskSubmitInput,
      template: DeliveryTemplate | null
    ) {
      if (
        generation !== getAuthGeneration() ||
        task.id !== taskId ||
        locked(task) ||
        !["open", "in_progress", "revision_requested"].includes(task.status) ||
        task.blockedBy.some((d) => !d.resolved)
      )
        return;
      void op.run(
        () => {
          setAttemptedAt(task);
          setError(undefined);
          return submitTask(task, userId, input, template);
        },
        () => {
          setNote("");
          setAssets([]);
          setFolder(undefined);
          setAnswersByTemplate({});
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
export type TaskSubmitSession = ReturnType<typeof useTaskSubmitSession>;
