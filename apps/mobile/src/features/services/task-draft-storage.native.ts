import { Directory, File, Paths } from "expo-file-system";
import { taskDraftStorageKey, type TaskDraftStorage } from "./task-draft-storage-key";
export type { TaskDraftStorage } from "./task-draft-storage-key";

export function taskDraftStorage(crewId: string, userId: string): TaskDraftStorage {
  const directory = new Directory(Paths.document, "task-drafts");
  const key = taskDraftStorageKey(crewId, userId);
  const file = new File(directory, `${key}.json`);
  return {
    read: () => (file.exists ? file.textSync() : null),
    write: (value) => {
      directory.create({ intermediates: true, idempotent: true });
      // Commit a complete snapshot before issuing any non-idempotent task POST.
      const temporary = new File(directory, `${key}.pending`);
      temporary.create({ overwrite: true });
      temporary.write(value);
      temporary.move(file, { overwrite: true });
    },
  };
}
