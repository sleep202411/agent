"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

/** Serialize edits and generation admission so a run uses its clicked input snapshot. */
export function useStoryProductionAutosave<T extends Record<string, string>>({
  initialValues,
  persist,
  onError,
  canPersist = () => true,
  scopeKey = "production-prompt",
}: {
  initialValues: T;
  persist: (values: T) => Promise<number>;
  onError: (error: unknown) => void;
  canPersist?: () => boolean;
  scopeKey?: string;
}) {
  const scope = useMemo(() => ({ key: scopeKey }), [scopeKey]);
  const activeScope = useRef<typeof scope | null>(null);
  useLayoutEffect(() => {
    activeScope.current = scope;
    return () => {
      if (activeScope.current === scope) activeScope.current = null;
    };
  }, [scope]);
  const [values, setValues] = useState(initialValues);
  const latest = useRef({ values: initialValues });
  const baseline = useRef(initialValues);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; save: () => void } | null>(null);

  useEffect(() => {
    if (!sameValues(baseline.current, initialValues)) {
      if (sameValues(latest.current.values, baseline.current)) {
        latest.current.values = initialValues;
        setValues(initialValues);
      }
      baseline.current = initialValues;
    }
  }, [initialValues]);

  const enqueue = <R>(operation: () => Promise<R>): Promise<R> => {
    const result = queue.current.catch(() => undefined).then(operation);
    queue.current = result;
    return result;
  };

  const cancelPending = () => {
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = null;
  };

  const changeValues = (next: T) => {
    if (activeScope.current !== scope || !canPersist()) return;
    latest.current.values = next;
    setValues(next);
    cancelPending();
    const save = () => {
      void enqueue(() => {
        if (!canPersist()) throw new DOMException("Autosave account changed", "AbortError");
        return persist(next);
      }).catch((error) => {
        if (canPersist()) onError(error);
      });
    };
    pending.current = {
      save,
      timer: setTimeout(() => {
        pending.current = null;
        save();
      }, 400),
    };
  };

  const runWithSavedValues = <R>(operation: (version: number) => Promise<R>): Promise<R> => {
    if (activeScope.current !== scope || !canPersist())
      return Promise.reject(new DOMException("Autosave view abandoned", "AbortError"));
    cancelPending();
    const snapshot = latest.current.values;
    return enqueue(async () => {
      if (activeScope.current !== scope || !canPersist())
        throw new DOMException("Autosave view abandoned", "AbortError");
      const version = await persist(snapshot);
      if (activeScope.current !== scope || !canPersist())
        throw new DOMException("Autosave view abandoned", "AbortError");
      return operation(version);
    });
  };

  useEffect(
    () => () => {
      const remaining = pending.current;
      if (remaining) {
        clearTimeout(remaining.timer);
        pending.current = null;
        remaining.save();
      }
    },
    []
  );

  return { values, changeValues, runWithSavedValues };
}

function sameValues(left: Record<string, string>, right: Record<string, string>) {
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.entries(left).every(([key, value]) => right[key] === value)
  );
}
