"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** Serialize edits and generation admission so a run uses its clicked input snapshot. */
export function useStoryProductionAutosave<T extends Record<string, string>>({
  initialValues,
  persist,
  onError,
}: {
  initialValues: T;
  persist: (values: T) => Promise<number>;
  onError: (error: unknown) => void;
}) {
  const [values, setValues] = useState(initialValues);
  const latest = useRef({ values: initialValues, persist, onError });
  const baseline = useRef(initialValues);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const pending = useRef<{ timer: ReturnType<typeof setTimeout>; save: () => void } | null>(null);

  useLayoutEffect(() => {
    latest.current.persist = persist;
    latest.current.onError = onError;
  }, [persist, onError]);

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
    latest.current.values = next;
    setValues(next);
    cancelPending();
    const save = () => {
      void enqueue(() => latest.current.persist(next)).catch((error) =>
        latest.current.onError(error)
      );
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
    cancelPending();
    const snapshot = latest.current.values;
    return enqueue(async () => operation(await latest.current.persist(snapshot)));
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
