import * as SecureStore from "expo-secure-store";
import { durableRecordKey } from "@/lib/durable-record-key";
import { withdrawalSecureRecord } from "./withdrawal-secure-record";
export function withdrawalStorage(userId: string) {
  const key = durableRecordKey("withdrawal", userId, "pending");
  const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  return withdrawalSecureRecord(key, {
    get: (item) => SecureStore.getItem(item, options),
    set: (item, value) => SecureStore.setItem(item, value, options),
  });
}
