/**
 * Cross-screen browse invalidation. A mutation that changes what the browse
 * lists should show (e.g. blocking an IP) bumps the version; list screens
 * subscribe via `useBrowseVersion` and refetch. Same useSyncExternalStore
 * idiom as locale-store / auth-store.
 */
import { useSyncExternalStore } from "react";

let version = 0;
const listeners = new Set<() => void>();

export function invalidateBrowse() {
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getVersion() {
  return version;
}

export function useBrowseVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}
