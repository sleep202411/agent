import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { getAuthGeneration } from "./auth-store";

export function useAuthFormLifetime(identity: string, focused: boolean) {
  const scope = useMemo(() => ({ identity }), [identity]);
  const edited = useRef(false);
  const active = useRef<{ scope: object } | null>(null);
  useLayoutEffect(() => {
    edited.current = false;
  }, [scope]);
  useLayoutEffect(() => {
    active.current = focused ? { scope } : null;
    return () => {
      active.current = null;
    };
  }, [scope, focused]);
  const capture = useCallback(
    (pristine = false) => {
      const lease = active.current;
      const generation = getAuthGeneration();
      return () =>
        lease !== null &&
        active.current === lease &&
        lease.scope === scope &&
        getAuthGeneration() === generation &&
        (!pristine || !edited.current);
    },
    [scope]
  );
  const markEdited = useCallback(() => {
    if (active.current?.scope === scope) edited.current = true;
  }, [scope]);
  return { capture, markEdited };
}

export function useDelayedAuthFocus(
  target: RefObject<{ focus(): void } | null>,
  enabled: boolean,
  identity: string
) {
  const generation = getAuthGeneration();
  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => {
      if (getAuthGeneration() === generation) target.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [target, enabled, identity, generation]);
}
