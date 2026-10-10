import { useCallback, useState } from "react";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { appEnv } from "@/config";
import {
  updateTaskAssignments,
  assignmentInput,
  parseTaskReward,
  taskRewardText,
  type AssignmentSnapshot,
} from "./task-assignment-api";
type Row = { userId: string; currency: string; reward: string };
type Draft = {
  snapshot: AssignmentSnapshot;
  rows: Row[];
  attemptedAt?: AssignmentSnapshot;
  error?: string;
};
const initialDraft = (snapshot: AssignmentSnapshot): Draft => ({
  snapshot,
  rows: snapshot.assignees.map((a) => ({
    userId: a.userId,
    currency:
      a.rewardAmountMinor === null ? (appEnv.siteRegion === "cn" ? "CNY" : "USD") : a.currency,
    reward: taskRewardText(a.rewardAmountMinor),
  })),
});
export function parseAssignmentDraft(draft: Draft) {
  try {
    return assignmentInput.parse({
      expectedVersion: draft.snapshot.version,
      assignees: draft.rows.map((a) => ({
        userId: a.userId,
        currency: a.currency,
        rewardAmountMinor: parseTaskReward(a.reward),
      })),
    });
  } catch {
    return undefined;
  }
}
/** Task-page ownership keeps drafts and pending writes alive while details reload. */
export function useTaskAssignmentSession(
  taskId: string,
  generation: number,
  onRefresh: () => void
) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState<Draft>();
  const op = useAuthFormOperation(taskId, true);
  const current = () => generation === getAuthGeneration();
  const initialize = useCallback(
    (snapshot: AssignmentSnapshot) => {
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
    change(update: (rows: Row[]) => Row[]) {
      if (current() && !op.busy && !draft?.attemptedAt)
        setDraft((old) => old && { ...old, rows: update(old.rows) });
    },
    review(snapshot: AssignmentSnapshot) {
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
    save(snapshot: AssignmentSnapshot) {
      if (
        !current() ||
        !draft ||
        draft.attemptedAt ||
        op.busy ||
        snapshot.id !== draft.snapshot.id ||
        snapshot.crewId !== draft.snapshot.crewId ||
        snapshot.version !== draft.snapshot.version ||
        ["approved", "cancelled"].includes(snapshot.status)
      )
        return;
      const data = parseAssignmentDraft(draft);
      if (!data) return;
      void op.run(
        () => {
          setDraft({ ...draft, attemptedAt: snapshot, error: undefined });
          return updateTaskAssignments(draft.snapshot, data);
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
export type TaskAssignmentSession = ReturnType<typeof useTaskAssignmentSession>;
