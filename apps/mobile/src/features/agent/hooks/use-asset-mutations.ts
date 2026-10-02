import { useEffect, useMemo, useState } from "react";
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
  const op = useAuthFormOperation(`${scope.projectId}:${scope.chapterId}`, active);
  const [pending, setPending] = useState<AssetCommand | null>(null);
  const [error, setError] = useState<string>();
  const [loaded, setLoaded] = useState<object>();
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
    if (!canEdit || loaded !== store) return;
    void op.run(
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
    );
  };
  const clear = () => {
    if (!pending || op.busy) return;
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
