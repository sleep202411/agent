"use client";

import { useState } from "react";

/**
 * Retains the last defined value across renders where the source becomes
 * undefined.
 *
 * Projection queries key on the authority snapshot, so a rotated key starts
 * with no data: `keepPreviousData` covers its pending window, but a failed
 * fresh read drops `data` to undefined again. The canvas must never unmount
 * for a refetch — stale data may keep RENDERING (writes are latched separately
 * through the edit policy) until a fresh authoritative read replaces it. The
 * hook is scoped to its component instance; the Story canvas remounts per
 * workspace+project `scopeKey`, so retained data cannot leak across projects.
 */
export function useLastDefinedData<T>(value: T | undefined): T | undefined {
  const [lastDefined, setLastDefined] = useState<T | undefined>(value);
  // Render-phase state adjustment (the documented "storing information from
  // previous renders" pattern): React restarts this render immediately, so the
  // retained snapshot is committed together with the value that produced it.
  if (value !== undefined && value !== lastDefined) setLastDefined(value);
  return value ?? lastDefined;
}
