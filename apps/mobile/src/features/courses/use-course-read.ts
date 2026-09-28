import { useEffect, useRef, useState } from "react";

/** Caller keys the screen by account/locale/resource; retries abort the prior read. */
export function useCourseRead<T>(load: (signal: AbortSignal) => Promise<T>) {
  const current = useRef<AbortController | null>(null);
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    current.current = controller;
    void load(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [load, attempt]);
  return {
    data,
    error,
    retry: () => {
      current.current?.abort();
      setData(undefined);
      setError(undefined);
      setAttempt((n) => n + 1);
    },
  };
}
