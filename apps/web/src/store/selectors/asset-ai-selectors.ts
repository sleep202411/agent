import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "@/src/store";
import type { Task } from "@/src/store/slices/taskSlice";
import { ROLE_RECORD_COLUMN_ID } from "@/src/lib/asset-paths";

/**
 * Selectors for AI image generation tasks scoped to a world asset
 * (character / scene / prop) + its record column. Centralized so the
 * in-dialog gallery and any out-of-dialog loading indicator share the
 * same source of truth.
 *
 * `selectAssetAiTasks(shotId, columnKey)` is the general form.
 * `selectCharacterAiTasks(characterId)` is a convenience wrapper
 * because character portrait is the one place where the column ID is
 * essentially fixed (ROLE_RECORD_COLUMN_ID).
 */

const ROLE_COLUMN_KEY = String(ROLE_RECORD_COLUMN_ID);

const selectAllTasks = (state: RootState) => state.task.tasks;

/**
 * All AI image tasks for (shotId, columnKey). Ordered newest-first.
 * `columnKey` is the string form of the column ID (e.g. "-3" for
 * scenes, "-2" for props).
 */
export const selectAssetAiTasks = createSelector(
  [
    selectAllTasks,
    (_: RootState, shotId: string) => shotId,
    (_: RootState, _s: string, columnKey: string) => columnKey,
  ],
  (tasks, shotId, columnKey): Task[] => {
    if (!shotId || !columnKey) return [];
    return Object.values(tasks)
      .filter(
        (task) => task.type === "image" && task.shotId === shotId && task.shotColumnId === columnKey
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  }
);

/**
 * True while any AI image generation is pending/running for this
 * (shotId, columnKey). Non-memoized — cheap linear scan, safe for
 * list-item subscribers.
 */
export const selectAssetHasActiveAiTask = (
  state: RootState,
  shotId: string,
  columnKey: string
): boolean => {
  if (!shotId || !columnKey) return false;
  for (const task of Object.values(state.task.tasks)) {
    if (task.type !== "image") continue;
    if (task.shotId !== shotId) continue;
    if (task.shotColumnId !== columnKey) continue;
    if (task.status === "pending" || task.status === "running") return true;
  }
  return false;
};

/** All AI portrait tasks scoped to `characterId`. Ordered newest-first. */
export const selectCharacterAiTasks = (state: RootState, characterId: string): Task[] =>
  selectAssetAiTasks(state, characterId, ROLE_COLUMN_KEY);

/** True while any portrait generation is pending/running for this character. */
export const selectCharacterHasActiveAiTask = (state: RootState, characterId: string): boolean =>
  selectAssetHasActiveAiTask(state, characterId, ROLE_COLUMN_KEY);
