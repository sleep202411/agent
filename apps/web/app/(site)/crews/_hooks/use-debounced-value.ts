"use client";

import { useEffect, useState } from "react";

/**
 * Returns `value` after it has stopped changing for `delayMs`.
 * Standard debounce pattern — used by the add-member dialog to
 * avoid hitting the lookup endpoint on every keystroke.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
