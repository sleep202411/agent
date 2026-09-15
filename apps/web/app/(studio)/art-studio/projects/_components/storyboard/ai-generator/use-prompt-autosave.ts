"use client";

import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

/** Trailing autosave. A pending edit retains the callback for its own cell. */
export function usePromptAutosave(save: (value: string) => void, delay = 800, scope = "") {
  const lifetime = useMemo(() => ({ scope, active: false }), [scope]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ value: string; save: (value: string) => void } | null>(null);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const edit = pending.current;
    pending.current = null;
    edit?.save(edit.value);
  }, []);

  const schedule = useCallback(
    (value: string) => {
      if (!lifetime.active) return;
      pending.current = { value, save };
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    [flush, delay, save, lifetime]
  );

  // Shot navigation flushes the departing cell before admitting the next one.
  useLayoutEffect(() => {
    lifetime.active = true;
    return () => {
      lifetime.active = false;
      flush();
    };
  }, [flush, lifetime]);

  return { schedule, flush };
}
