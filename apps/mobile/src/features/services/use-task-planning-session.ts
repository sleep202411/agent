import { useCallback, useState } from "react";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { compensationText, parseCompensation } from "./task-compensation";
import { parsePlanningNumber } from "./task-planning-number";
import {
  planningChanges,
  planningDraft,
  updateTaskPlanning,
  type PlanningSnapshot,
} from "./task-planning-edit-api";

type Draft = ReturnType<typeof initialDraft> & { attemptedAt?: PlanningSnapshot; error?: string };
function initialDraft(snapshot: PlanningSnapshot) {
  return {
    snapshot,
    reward: compensationText(snapshot.rewardUsdMinor),
    share: compensationText(snapshot.profitShareBps),
    estimate: snapshot.estimatePoints == null ? "" : String(snapshot.estimatePoints),
    revisionLimit: snapshot.revisionLimit == null ? "" : String(snapshot.revisionLimit),
    taskKind: snapshot.taskKind,
    fields: planningDraft(snapshot),
  };
}
export function parsePlanningDraft(draft: Draft) {
  try {
    return planningChanges(draft.snapshot, draft.fields, draft.taskKind, {
      estimatePoints: parsePlanningNumber(draft.estimate, 1_000_000),
      revisionLimit: parsePlanningNumber(draft.revisionLimit, 100),
      rewardUsdMinor: parseCompensation(draft.reward, 100_000_000_000),
      profitShareBps: parseCompensation(draft.share, 10_000),
    });
  } catch {
    return undefined;
  }
}
/** Task-page ownership keeps drafts and pending writes alive while details reload. */
export function useTaskPlanningSession(taskId: string, generation: number, onRefresh: () => void) {
  const [editing, setEditing] = useState(false),
    [draft, setDraft] = useState<Draft>();
  const op = useAuthFormOperation(taskId, true);
  const current = () => generation === getAuthGeneration();
  const initialize = useCallback(
    (snapshot: PlanningSnapshot) => {
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
    change<K extends "reward" | "share" | "estimate" | "revisionLimit" | "taskKind" | "fields">(
      field: K,
      value: Draft[K] | ((previous: Draft[K]) => Draft[K])
    ) {
      if (current() && !op.busy && !draft?.attemptedAt)
        setDraft(
          (old) =>
            old && { ...old, [field]: typeof value === "function" ? value(old[field]) : value }
        );
    },
    review(snapshot: PlanningSnapshot) {
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
    save(snapshot: PlanningSnapshot) {
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
      const parsed = parsePlanningDraft(draft);
      if (!parsed?.success) return;
      void op.run(
        () => {
          setDraft({ ...draft, attemptedAt: snapshot, error: undefined });
          return updateTaskPlanning(draft.snapshot, parsed.data);
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
export type TaskPlanningSession = ReturnType<typeof useTaskPlanningSession>;
