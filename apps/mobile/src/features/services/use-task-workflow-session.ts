import { useCallback, useState } from "react";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { moveTaskWorkflow, type WorkflowSnapshot } from "./task-workflow-edit-api";
import type { TaskWorkflow } from "./task-workflow-api";
type Draft = {
  snapshot: WorkflowSnapshot;
  target: TaskWorkflow | null;
  attemptedAt?: WorkflowSnapshot;
  error?: string;
};
const initialDraft = (snapshot: WorkflowSnapshot): Draft => ({
  snapshot,
  target: snapshot.workflowState,
});
/** Task-page ownership keeps drafts and pending writes alive while details reload. */
export function useTaskWorkflowSession(taskId: string, generation: number, onRefresh: () => void) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState<Draft>();
  const op = useAuthFormOperation(taskId, true);
  const current = () => generation === getAuthGeneration();
  const initialize = useCallback(
    (snapshot: WorkflowSnapshot) => {
      if (generation === getAuthGeneration()) setDraft((old) => old ?? initialDraft(snapshot));
    },
    [generation]
  );
  return {
    editing,
    draft,
    busy: op.busy,
    open() {
      if (current() && !op.busy) setEditing(true);
    },
    initialize,
    change(target: TaskWorkflow | null) {
      if (current() && !op.busy && !draft?.attemptedAt)
        setDraft((old) => old && { ...old, target });
    },
    review(snapshot: WorkflowSnapshot) {
      if (
        !current() ||
        op.busy ||
        !draft ||
        snapshot.id !== draft.snapshot.id ||
        snapshot.crewId !== draft.snapshot.crewId ||
        snapshot.version < draft.snapshot.version ||
        snapshot === draft.attemptedAt
      )
        return;
      setDraft({ ...draft, snapshot, attemptedAt: undefined, error: undefined });
    },
    cancel() {
      if (!current() || op.busy) return;
      setEditing(false);
      setDraft(undefined);
      if (draft?.attemptedAt) onRefresh();
    },
    save(snapshot: WorkflowSnapshot) {
      if (
        !current() ||
        !draft ||
        draft.attemptedAt ||
        op.busy ||
        snapshot.id !== draft.snapshot.id ||
        snapshot.crewId !== draft.snapshot.crewId ||
        snapshot.version !== draft.snapshot.version ||
        !["open", "in_progress", "revision_requested"].includes(snapshot.status)
      )
        return;
      if (!draft.target || draft.target.id === snapshot.workflowStateId) return;
      const target = draft.target;
      void op.run(
        () => {
          setDraft({ ...draft, attemptedAt: snapshot, error: undefined });
          return moveTaskWorkflow(draft.snapshot, target);
        },
        () => {
          setDraft(undefined);
          setEditing(false);
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
export type TaskWorkflowSession = ReturnType<typeof useTaskWorkflowSession>;
