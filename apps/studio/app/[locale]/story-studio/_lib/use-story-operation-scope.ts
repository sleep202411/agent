"use client";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";

/** Capture this predicate when admitting a mutation; later renders cannot revive it. */
export function useStoryOperationScope(key: string) {
  const scope = useMemo(() => ({ key }), [key]);
  const activeScope = useRef<typeof scope | null>(null);
  useLayoutEffect(() => {
    activeScope.current = scope;
    return () => {
      if (activeScope.current === scope) activeScope.current = null;
    };
  }, [scope]);
  return useCallback(() => activeScope.current === scope, [scope]);
}
