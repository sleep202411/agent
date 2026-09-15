import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getAuthGeneration } from "./auth-store";

type Operation = { generation: number; scope: object };
/** Login changes its own auth generation; later foreign changes still abandon its UI callbacks. */
export function useAuthFormOperation(identity: string, focused: boolean) {
  const scope = useMemo(() => ({ identity, focused }), [identity, focused]);
  const generation = getAuthGeneration();
  const active = useRef<object | null>(null);
  const pending = useRef<Operation | null>(null);
  const [displayed, setDisplayed] = useState<Operation | null>(null);
  useLayoutEffect(() => {
    active.current = focused ? scope : null;
    return () => {
      active.current = null;
      pending.current = null;
    };
  }, [scope, focused]);
  const run = useCallback(
    async <T>(
      request: () => Promise<T>,
      onSuccess: (value: T) => void,
      onFailure: (error: unknown) => void
    ) => {
      if (!focused || active.current !== scope || generation !== getAuthGeneration()) return;
      if (pending.current?.generation === generation) return;
      const operation = { generation, scope };
      pending.current = operation;
      const current = () =>
        active.current === scope &&
        pending.current === operation &&
        getAuthGeneration() === operation.generation;
      try {
        const response = request();
        // Auth-store admission increments synchronously before its first await.
        operation.generation = getAuthGeneration();
        setDisplayed({ ...operation });
        const value = await response;
        if (current()) onSuccess(value);
      } catch (error) {
        if (current()) onFailure(error);
      } finally {
        if (pending.current === operation) {
          pending.current = null;
          if (active.current === scope) setDisplayed(null);
        }
      }
    },
    [scope, focused, generation]
  );
  return {
    busy: focused && displayed?.scope === scope && displayed.generation === generation,
    run,
  };
}
