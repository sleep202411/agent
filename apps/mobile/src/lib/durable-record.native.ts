import { Directory, File, Paths } from "expo-file-system";
import { durableRecordKey, type DurableRecord } from "./durable-record-key";
export type { DurableRecord } from "./durable-record-key";
export function durableRecord(namespace: string, userId: string, identity: string): DurableRecord {
  const key = durableRecordKey(namespace, userId, identity);
  const directory = new Directory(Paths.document, "pending-operations");
  const file = new File(directory, `${key}.json`);
  return {
    read: () => (file.exists ? file.textSync() : null),
    write: (value) => {
      directory.create({ intermediates: true, idempotent: true });
      const pending = new File(directory, `${key}.pending`);
      pending.create({ overwrite: true });
      pending.write(value);
      pending.move(file, { overwrite: true });
    },
  };
}
