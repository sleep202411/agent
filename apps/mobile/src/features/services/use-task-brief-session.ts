import { useState } from "react";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { taskBriefInput, updateTaskBrief } from "./task-brief-api";
import type { TaskDetail } from "./task-detail-api";

type Draft = {
  snapshot: TaskDetail;
  title: string;
  description: string;
  attemptedAt?: TaskDetail;
  error?: string;
};

/** Lives with the task page so a detail refresh cannot discard a brief or an in-flight save. */
export function useTaskBriefSession(taskId: string, generation: number, onRefresh: () => void) {
  const [draft, setDraft] = useState<Draft>();
  const op = useAuthFormOperation(taskId, true);
  const current = () => generation === getAuthGeneration();
  return {
    draft,
    busy: op.busy,
    open(task: TaskDetail) {
      if (current() && !op.busy)
        setDraft({ snapshot: task, title: task.title, description: task.description });
    },
    change(field: "title" | "description", value: string) {
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
      setDraft({ snapshot: task, title: draft.title, description: draft.description });
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
      const parsed = taskBriefInput.safeParse({
        expectedVersion: draft.snapshot.version,
        title: draft.title,
        description: draft.description,
      });
      if (!parsed.success) return;
      void op.run(
        () => {
          setDraft({ ...draft, attemptedAt: task, error: undefined });
          return updateTaskBrief(draft.snapshot, parsed.data);
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
export type TaskBriefSession = ReturnType<typeof useTaskBriefSession>;
