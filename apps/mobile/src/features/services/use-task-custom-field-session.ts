import { useCallback, useState } from "react";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { normalizeCustomValue, updateCustomField } from "./task-custom-field-edit-api";
import type { CustomField, CustomValue } from "./task-custom-fields-api";
import type { TaskDetail } from "./task-detail-api";

export type FieldSnapshot = { task: TaskDetail; field: CustomField; value: CustomValue };
type Draft = {
  snapshot: FieldSnapshot;
  value: CustomValue;
  attemptedAt?: FieldSnapshot;
  error?: string;
};
/** Owned by the task page, including while its detail panels reload. */
export function useTaskCustomFieldSession(
  taskId: string,
  generation: number,
  onRefresh: () => void
) {
  const [selected, setSelected] = useState<string>();
  const [draft, setDraft] = useState<Draft>();
  const op = useAuthFormOperation(taskId, true);
  const current = () => generation === getAuthGeneration();
  const initialize = useCallback(
    (snapshot: FieldSnapshot) => {
      if (generation === getAuthGeneration())
        setDraft((old) => old ?? { snapshot, value: snapshot.value });
    },
    [generation]
  );
  return {
    selected,
    draft,
    initialize,
    busy: op.busy,
    open(fieldId: string) {
      if (current() && !op.busy && !draft) setSelected(fieldId);
    },
    change(value: CustomValue) {
      if (current() && !op.busy && !draft?.attemptedAt) setDraft((old) => old && { ...old, value });
    },
    review(snapshot: FieldSnapshot) {
      if (
        !current() ||
        op.busy ||
        !draft ||
        snapshot === draft.attemptedAt ||
        snapshot.task.id !== draft.snapshot.task.id ||
        snapshot.task.crewId !== draft.snapshot.task.crewId ||
        snapshot.task.version < draft.snapshot.task.version ||
        snapshot.field.id !== draft.snapshot.field.id ||
        snapshot.field.type !== draft.snapshot.field.type
      )
        return;
      setDraft({ snapshot, value: draft.value });
    },
    cancel() {
      if (!current() || op.busy) return;
      setDraft(undefined);
      setSelected(undefined);
      if (draft?.attemptedAt) onRefresh();
    },
    save(snapshot: FieldSnapshot) {
      if (
        !current() ||
        op.busy ||
        !draft ||
        draft.attemptedAt ||
        snapshot.task.id !== draft.snapshot.task.id ||
        snapshot.task.crewId !== draft.snapshot.task.crewId ||
        snapshot.task.version !== draft.snapshot.task.version ||
        JSON.stringify(snapshot.field) !== JSON.stringify(draft.snapshot.field) ||
        ["approved", "cancelled"].includes(snapshot.task.status)
      )
        return;
      let value: CustomValue;
      try {
        value = normalizeCustomValue(snapshot.field, draft.value);
      } catch {
        return;
      }
      if (JSON.stringify(value) === JSON.stringify(snapshot.value)) return;
      void op.run(
        () => {
          setDraft({ ...draft, attemptedAt: snapshot, error: undefined });
          return updateCustomField(snapshot.task, snapshot.field, value);
        },
        () => {
          setDraft(undefined);
          setSelected(undefined);
          onRefresh();
        },
        (cause) => {
          setDraft(
            (old) =>
              old && { ...old, error: cause instanceof Error ? cause.message : String(cause) }
          );
        }
      );
    },
  };
}
export type TaskCustomFieldSession = ReturnType<typeof useTaskCustomFieldSession>;
