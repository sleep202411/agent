"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Trailing-debounced autosave for dialog prompt fields.
 *
 * The AI image/video generator dialogs used to persist their prompt only
 * when the user pressed Generate — anything typed and then closed (without
 * generating) was lost. This hook debounces a `save` call on every change
 * and guarantees a final flush when the dialog closes / unmounts, so the
 * latest prompt always reaches the backend.
 *
 * `save` is kept in a ref so callers can pass an inline closure without
 * resetting the debounce timer on every render.
 */
export function usePromptAutosave(save: (value: string) => void, delay = 800) {
  const saveRef = useRef(save);
  saveRef.current = save;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (pending.current != null) {
      const value = pending.current;
      pending.current = null;
      saveRef.current(value);
    }
  }, []);

  const schedule = useCallback(
    (value: string) => {
      pending.current = value;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, delay);
    },
    [flush, delay]
  );

  // Flush any pending edit on unmount (dialog closed / navigated away).
  useEffect(() => () => flush(), [flush]);

  return { schedule, flush };
}
