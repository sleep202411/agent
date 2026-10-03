import { useState } from "react";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { updateTaskRelationships } from "./task-relationship-api";
import type { TaskOption } from "./task-options";
import type { TaskDetail } from "./task-detail-api";

type Draft = {
  snapshot: TaskDetail;
  parent: TaskOption | null;
  blockers: TaskOption[];
  attemptedAt?: TaskDetail;
  error?: string;
};

/** Lives with the task page so a detail refresh cannot discard a relationship draft or an in-flight save. */
export function useTaskRelationshipSession(
  taskId: string,
  generation: number,
  onRefresh: () => void
) {
  const [draft, setDraft] = useState<Draft>();
  const op = useAuthFormOperation(taskId, true);
  const current = () => generation === getAuthGeneration();
  return {
    draft,
    busy: op.busy,
    open(task: TaskDetail) {
      if (current() && !op.busy)
        setDraft({ snapshot: task, parent: task.parent, blockers: task.blockedBy });
    },
    change(update: (draft: Draft) => Pick<Draft, "parent" | "blockers">) {
      if (current() && !op.busy && !draft?.attemptedAt)
        setDraft((old) => old && { ...old, ...update(old) });
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
      setDraft({ snapshot: task, parent: draft.parent, blockers: draft.blockers });
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
      void op.run(
        () => {
          setDraft({ ...draft, attemptedAt: task, error: undefined });
          return updateTaskRelationships(draft.snapshot, {
            expectedVersion: draft.snapshot.version,
            parentId: draft.parent?.id ?? null,
            blockedByTaskIds: draft.blockers.map((item) => item.id),
          });
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
export type TaskRelationshipSession = ReturnType<typeof useTaskRelationshipSession>;
