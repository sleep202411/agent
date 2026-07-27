"use client";

import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from "react";

/**
 * Owns the lifetime of one project-scoped chat session.
 *
 * React StrictMode intentionally replays passive effects in development, so
 * setup must always reactivate the scope after its rehearsal cleanup.
 */
export function useCopilotScopeLifecycle(
  dispose: () => void | Promise<void>
): MutableRefObject<boolean> {
  const activeRef = useRef(true);
  const disposeRef = useRef(dispose);

  useLayoutEffect(() => {
    disposeRef.current = dispose;
  }, [dispose]);

  // Layout cleanup closes the scope in the same commit as unmount/navigation,
  // before a queued stream microtask can enter a stale tool callback.
  useLayoutEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
    };
  }, []);

  useEffect(
    () => () => {
      void disposeRef.current();
    },
    []
  );

  return activeRef;
}
