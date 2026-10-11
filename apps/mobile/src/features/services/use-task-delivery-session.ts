import { useEffect, useRef, useState } from "react";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { setDeliveryTemplate, type DeliveryCategory } from "./task-delivery-management-api";
import type { TaskDetail } from "./task-detail-api";

type Draft = {
  snapshot: TaskDetail;
  choice?: DeliveryCategory | null;
  attemptedAt?: TaskDetail;
  error?: string;
};

/** Lives with the task page so a detail refresh cannot discard a delivery choice or an in-flight save. */
export function useTaskDeliverySession(taskId: string, generation: number, onRefresh: () => void) {
  const [draft, setDraft] = useState<Draft>();
  const op = useAuthFormOperation(taskId, true);
  const active = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      active.current?.abort();
      active.current = null;
    },
    [taskId, generation]
  );
  const current = () => generation === getAuthGeneration();
  return {
    draft,
    busy: op.busy,
    open(task: TaskDetail) {
      if (current() && !op.busy) setDraft({ snapshot: task, choice: undefined });
    },
    change(choice: DeliveryCategory | null) {
      if (current() && !op.busy && !draft?.attemptedAt)
        setDraft((old) => old && { ...old, choice });
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
      setDraft({ snapshot: task, choice: draft.choice });
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
        draft.choice === undefined ||
        draft.attemptedAt ||
        op.busy ||
        task.id !== draft.snapshot.id ||
        task.crewId !== draft.snapshot.crewId ||
        task.status !== "open" ||
        task.submissions.length > 0 ||
        task.version !== draft.snapshot.version
      )
        return;
      const choice = draft.choice;
      void op.run(
        () => {
          setDraft({ ...draft, attemptedAt: task, error: undefined });
          const controller = new AbortController();
          active.current = controller;
          return setDeliveryTemplate(
            task.id,
            draft.snapshot.version,
            choice ? { id: choice.id, version: choice.version } : null,
            generation,
            controller.signal
          );
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
export type TaskDeliverySession = ReturnType<typeof useTaskDeliverySession>;
