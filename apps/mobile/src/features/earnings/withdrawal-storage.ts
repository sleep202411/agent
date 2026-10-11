import { durableRecordKey, type DurableRecord } from "@/lib/durable-record-key";
/** Browser preview follows the web form's tab lifetime; never writes bank data to localStorage. */
export function withdrawalStorage(userId: string): DurableRecord {
  const key = durableRecordKey("withdrawal", userId, "pending");
  return {
    read: () => window.sessionStorage.getItem(key),
    write: (value) => window.sessionStorage.setItem(key, value),
  };
}
