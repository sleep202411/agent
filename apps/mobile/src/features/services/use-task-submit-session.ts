import { useCallback, useRef, useState } from "react";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import type { CrewAsset } from "@/features/crew-assets/api";
import type { TaskDetail } from "./task-detail-api";
import type { DeliveryTemplate } from "./task-delivery-api";
import { submitTask, type DeliveryAnswers, type TaskSubmitInput } from "./task-submit-api";

export type TaskSubmissionUpload = {
  sequence: number;
  taskId: string;
  field?: string;
  templateKey: string;
  parentId: string | null;
  destination?: string;
};

/** Task-page ownership keeps input and pending writes alive during detail reloads. */
export function useTaskSubmitSession(taskId: string, generation: number, onRefresh: () => void) {
  const [upload, setUpload] = useState<TaskSubmissionUpload>();
  const uploadSequence = useRef(0);
  const [note, setNote] = useState("");
  const [assets, setAssets] = useState<Pick<CrewAsset, "id" | "name">[]>([]);
  const [deliveryLink, setDeliveryLink] = useState("");
  const [answersByTemplate, setAnswersByTemplate] = useState<Record<string, DeliveryAnswers>>({});
  const [attemptedAt, setAttemptedAt] = useState<TaskDetail>();
  const [error, setError] = useState<string>();
  const latestSnapshot = useRef<TaskDetail | undefined>(undefined);
  const observe = useCallback((task: TaskDetail) => {
    latestSnapshot.current = task;
  }, []);
  const op = useAuthFormOperation(taskId, true);
  const locked = (task: TaskDetail) => op.busy || attemptedAt === task || upload !== undefined;
  return {
    upload,
    setUpload,
    beginUpload(task: TaskDetail, templateKey: string, field?: string) {
      if (
        generation !== getAuthGeneration() ||
        task.id !== taskId ||
        locked(task) ||
        assets.length >= 100
      )
        return;
      setUpload({
        sequence: ++uploadSequence.current,
        taskId: task.id,
        field,
        templateKey,
        parentId: task.deliveryFolder?.id ?? null,
        destination: task.deliveryFolder?.name,
      });
    },
    note,
    setNote,
    assets,
    setAssets,
    deliveryLink,
    setDeliveryLink,
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
          setDeliveryLink("");
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
