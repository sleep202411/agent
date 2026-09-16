import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { getAuthGeneration } from "./auth-store";
import { useAuthRequestScope } from "./use-auth-request-scope";

export function useOnboardingAction(identity: string) {
  const scope = useAuthRequestScope(identity);
  const generation = getAuthGeneration();
  const active = useRef<typeof scope | null>(scope);
  const pending = useRef<object | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [previousScope, setPreviousScope] = useState(scope);
  if (previousScope !== scope) {
    setPreviousScope(scope);
    setBusy(false);
    setError(undefined);
  }
  useLayoutEffect(() => {
    active.current = scope;
    return () => {
      active.current = null;
      pending.current = null;
    };
  }, [scope]);
  const run = useCallback(
    async (
      request: () => Promise<void>,
      onSuccess: (current: () => boolean) => void | Promise<void>,
      fallbackError: string
    ) => {
      if (
        active.current !== scope ||
        !scope.enabled ||
        pending.current ||
        getAuthGeneration() !== generation
      )
        return;
      const operation = {};
      pending.current = operation;
      const current = () =>
        active.current === scope &&
        pending.current === operation &&
        getAuthGeneration() === generation;
      setBusy(true);
      setError(undefined);
      try {
        await request();
        if (current()) await onSuccess(current);
      } catch (error) {
        if (current()) setError(error instanceof Error ? error.message : fallbackError);
      } finally {
        if (pending.current === operation) {
          pending.current = null;
          setBusy(false);
        }
      }
    },
    [scope, generation]
  );
  return {
    scope,
    busy,
    error,
    clearError: () => {
      if (active.current === scope) setError(undefined);
    },
    run,
  };
}
