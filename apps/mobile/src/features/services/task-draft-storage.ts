import { taskDraftStorageKey, type TaskDraftStorage } from "./task-draft-storage-key";
export type { TaskDraftStorage } from "./task-draft-storage-key";
/** Strict reads/writes: unavailable storage must never look like an empty queue. */
export function taskDraftStorage(crewId: string, userId: string): TaskDraftStorage {
  const key = taskDraftStorageKey(crewId, userId);
  return {
    read: () => window.localStorage.getItem(key),
    write: (value) => window.localStorage.setItem(key, value),
  };
}
