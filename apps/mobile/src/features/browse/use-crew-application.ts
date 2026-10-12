import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getAuthGeneration } from "@/auth/auth-store";
import { applyToCrewPosition } from "@/data/browse-service";

/** Keep native confirmation callbacks and request completions on their original Crew page. */
export function useCrewApplication(crewId: string) {
  const scope = useMemo(() => ({ crewId }), [crewId]);
  const active = useRef<typeof scope | null>(null);
  const pending = useRef<object | null>(null);
  const [displayed, setDisplayed] = useState<typeof scope | null>(null);
  useLayoutEffect(() => {
    active.current = scope;
    return () => {
      active.current = null;
      pending.current = null;
    };
  }, [scope]);

  const submit = useCallback(
    async (positionId: string, onSuccess: () => void, onError: (error: unknown) => void) => {
      if (active.current !== scope || pending.current) return;
      const operation = {};
      const generation = getAuthGeneration();
      pending.current = operation;
      setDisplayed(scope);
      const current = () =>
        active.current === scope &&
        pending.current === operation &&
        generation === getAuthGeneration();
      try {
        await applyToCrewPosition(crewId, positionId);
        if (current()) onSuccess();
      } catch (error) {
        if (current()) onError(error);
      } finally {
        if (pending.current === operation) {
          pending.current = null;
          if (active.current === scope) setDisplayed(null);
        }
      }
    },
    [crewId, scope]
  );

  return { applying: displayed === scope, submit };
}
