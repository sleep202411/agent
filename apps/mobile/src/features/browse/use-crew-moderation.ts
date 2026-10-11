import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getAuthGeneration } from "@/auth/auth-store";
import { blockCrew, reportCrew, type IpReportReason } from "@/data/browse-service";

/** Native confirmations can outlive their screen or authenticated account. */
export function useCrewModeration(crewId: string, generation: number, active: boolean) {
  const scope = useMemo(() => ({ crewId, generation }), [crewId, generation]);
  const mounted = useRef<typeof scope | null>(null);
  const pending = useRef<object | null>(null);
  const visible = useRef(active);
  useLayoutEffect(() => {
    visible.current = active;
  }, [active]);
  const [displayed, setDisplayed] = useState<typeof scope>();
  useLayoutEffect(() => {
    mounted.current = scope;
    return () => {
      mounted.current = null;
      pending.current = null;
    };
  }, [scope]);
  const isCurrent = useCallback(
    () => visible.current && mounted.current === scope && generation === getAuthGeneration(),
    [scope, generation]
  );
  const submit = useCallback(
    async (
      reason: IpReportReason | undefined,
      success: () => void,
      failure: (error: unknown) => void
    ) => {
      if (!isCurrent() || pending.current) return;
      const operation = {};
      pending.current = operation;
      setDisplayed(scope);
      try {
        if (reason) await reportCrew(crewId, reason);
        else await blockCrew(crewId);
        if (isCurrent() && pending.current === operation) success();
      } catch (error) {
        if (isCurrent() && pending.current === operation) failure(error);
      } finally {
        if (pending.current === operation) {
          pending.current = null;
          if (mounted.current === scope) setDisplayed(undefined);
        }
      }
    },
    [crewId, scope, isCurrent]
  );
  return { scope, submitting: displayed === scope, isCurrent, submit };
}
