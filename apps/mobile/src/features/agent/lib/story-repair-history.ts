import type { RepairContent } from "./story-repair-fields";
export type RepairHistory = {
  past: RepairContent[];
  future: RepairContent[];
  mergeKey?: string;
  capturedAt?: number;
};
export const emptyRepairHistory = (): RepairHistory => ({ past: [], future: [] });
/** Session-local, immutable history. Publish this state only after the draft write succeeds. */
export function captureRepairHistory(
  history: RepairHistory,
  before: RepairContent,
  mergeKey?: string,
  now = Date.now()
): RepairHistory {
  const merge =
    !!mergeKey &&
    mergeKey === history.mergeKey &&
    history.past.length > 0 &&
    history.capturedAt !== undefined &&
    now >= history.capturedAt &&
    now - history.capturedAt <= 700;
  return {
    past: merge ? history.past : [...history.past, before].slice(-100),
    future: [],
    mergeKey,
    capturedAt: now,
  };
}
export function stepRepairHistory(
  history: RepairHistory,
  current: RepairContent,
  direction: "undo" | "redo"
) {
  const source = direction === "undo" ? history.past : history.future;
  const content = source.at(-1);
  if (!content) return null;
  const next: RepairHistory =
    direction === "undo"
      ? { past: history.past.slice(0, -1), future: [...history.future, current] }
      : { past: [...history.past, current].slice(-100), future: history.future.slice(0, -1) };
  return { content, history: next };
}
