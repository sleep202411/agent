import { durableRecordKey, type DurableRecord } from "./durable-record-key";
export type { DurableRecord } from "./durable-record-key";
export function durableRecord(namespace: string, userId: string, identity: string): DurableRecord {
  const key = durableRecordKey(namespace, userId, identity);
  return {
    read: () => window.localStorage.getItem(key),
    write: (value) => window.localStorage.setItem(key, value),
  };
}
