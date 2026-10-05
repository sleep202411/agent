import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getAuthGeneration } from "@/auth/auth-store";
import { useAuthFormOperation } from "@/auth/use-auth-form-operation";
import { assetMutationPending, type AssetCommand } from "../api/story-asset-mutations";
import type { TimelineScope } from "../api/story-timeline-api";
export function useAssetMutations(
  scope: TimelineScope,
  userId: string,
  active: boolean,
  canEdit: boolean,
  onSaved: () => void
) {
  const store = useMemo(() => assetMutationPending(scope, userId), [scope, userId]);
  const visit = useMemo(() => ({ store, active, canEdit }), [store, active, canEdit]);
  const currentVisit = useRef<object | null>(null);
  useLayoutEffect(() => {
    currentVisit.current = active ? visit : null;
    return () => {
      currentVisit.current = null;
    };
  }, [visit, active]);
  const current = () => currentVisit.current === visit && scope.generation === getAuthGeneration();
  const inFlight = useRef<{ store: typeof store } | null>(null);
  const op = useAuthFormOperation(`${scope.projectId}:${scope.chapterId}`, active);
  const [pending, setPending] = useState<AssetCommand | null>(null);
  const [error, setError] = useState<string>();
  const [loaded, setLoaded] = useState<object>();
  const [previousStore, setPreviousStore] = useState(store);
  if (previousStore !== store) {
    setPreviousStore(store);
    setPending(null);
    setError(undefined);
    setLoaded(undefined);
  }
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      try {
        setPending(store.read() ?? null);
        setLoaded(store);
        setError(undefined);
      } catch (e) {
        setLoaded(undefined);
        setError(e instanceof Error ? e.message : String(e));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [store, active]);
  const submit = (command: AssetCommand) => {
    if (!current() || !canEdit || loaded !== store || inFlight.current?.store === store) return;
    const operation = { store };
    inFlight.current = operation;
    void op
      .run(
        async () => {
          store.save(command);
          setPending(command);
          setError(undefined);
          return store.submit(command);
        },
        () => {
          setPending(null);
          onSaved();
        },
        (e) => setError(e instanceof Error ? e.message : String(e))
      )
      .finally(() => {
        if (inFlight.current === operation) inFlight.current = null;
      });
  };
  const clear = () => {
    if (!current() || loaded !== store || !pending || op.busy || inFlight.current?.store === store)
      return;
    try {
      store.clear(pending.clientKey);
      setPending(null);
      setError(undefined);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return {
    pending: loaded === store ? pending : null,
    error,
    submit,
    clear,
    busy: op.busy,
    recoveryLocked: !active || loaded !== store || !!pending || op.busy,
    locked: !active || !canEdit || loaded !== store || !!pending || op.busy,
  };
}
