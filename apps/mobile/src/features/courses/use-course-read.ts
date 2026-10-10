import { useEffect, useRef, useState } from "react";
import { useScreenActive } from "@/hooks/use-app-active";

/** Caller keys the screen by account/locale/resource; retries abort the prior read. */
export function useCourseRead<T>(load: (signal: AbortSignal) => Promise<T>, pollMs = 0) {
  const active = useScreenActive();
  const [unauthorized, setUnauthorized] = useState(false);
  const current = useRef<AbortController | null>(null);
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    current.current = controller;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      void load(controller.signal)
        .then((value) => {
          if (!controller.signal.aborted) {
            setData(value);
            setError(undefined);
            setUnauthorized(false);
          }
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) {
            setError(cause instanceof Error ? cause.message : String(cause));
            setUnauthorized(
              !!cause && typeof cause === "object" && "status" in cause && cause.status === 401
            );
          }
        })
        .finally(() => {
          if (pollMs > 0 && !controller.signal.aborted) timer = setTimeout(run, pollMs);
        });
    };
    run();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [load, attempt, active, pollMs]);
  return {
    data,
    error,
    unauthorized,
    retry: () => {
      current.current?.abort();
      setData(undefined);
      setError(undefined);
      setAttempt((n) => n + 1);
    },
  };
}
