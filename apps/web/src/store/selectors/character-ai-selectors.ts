import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "@/src/store";
import type { Task } from "@/src/store/slices/taskSlice";
import { ROLE_RECORD_COLUMN_ID } from "@/src/lib/asset-paths";

/**
 * Tasks related to a character's AI portrait generation
 * (shotColumnId = ROLE_RECORD_COLUMN_ID, shotId = characterId).
 *
 * Centralized here so both the in-dialog gallery and out-of-dialog
 * loading indicators (character list tile, panel badges, etc.) read
 * from the same source of truth.
 */

const ROLE_COLUMN_KEY = String(ROLE_RECORD_COLUMN_ID);

const selectAllTasks = (state: RootState) => state.task.tasks;

/** All AI image tasks scoped to `characterId`. Ordered newest-first. */
export const selectCharacterAiTasks = createSelector(
  [selectAllTasks, (_: RootState, characterId: string) => characterId],
  (tasks, characterId): Task[] => {
    if (!characterId) return [];
    return Object.values(tasks)
      .filter(
        (task) =>
          task.type === "image" &&
          task.shotId === characterId &&
          task.shotColumnId === ROLE_COLUMN_KEY
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  }
);

/**
 * True while any portrait generation is pending/running for this
 * character. Cheap to subscribe to from list-item components.
 */
export const selectCharacterHasActiveAiTask = (state: RootState, characterId: string): boolean => {
  if (!characterId) return false;
  for (const task of Object.values(state.task.tasks)) {
    if (task.type !== "image") continue;
    if (task.shotId !== characterId) continue;
    if (task.shotColumnId !== ROLE_COLUMN_KEY) continue;
    if (task.status === "pending" || task.status === "running") return true;
  }
  return false;
};
