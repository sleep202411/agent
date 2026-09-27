"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { crewApi, CrewApiError } from "./api";

type Request = { path: string; body: Record<string, unknown> };
/** Mount inside an account/record-keyed session. Recovery lasts only while mounted. */
export function usePrivateCaseWrite<T>(onSaved: (value: T) => Promise<unknown>, fallback: string) {
  const alive = useRef(true);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState<Request | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<T | null>(null);
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function send(request: Request, recovery = false) {
    if (!alive.current || pending.current || saved || (retry && !recovery)) return;
    pending.current = true;
    setBusy(true);
    setError("");
    let result: T;
    try {
      result = await crewApi.post<T>(request.path, { body: request.body });
    } catch (err) {
      if (alive.current) {
        setError(err instanceof Error ? err.message : fallback);
        setRetry(
          err instanceof CrewApiError && [400, 401, 403, 404, 409, 422].includes(err.status)
            ? null
            : request
        );
        setBusy(false);
      }
      pending.current = false;
      return;
    }
    if (alive.current) {
      setRetry(null);
      setSaved(result);
      // A failed refresh must never turn a confirmed mutation into a failed write.
      await Promise.allSettled([onSaved(result)]);
    }
    pending.current = false;
    if (alive.current) setBusy(false);
  }
  return { busy, retry, error, saved, send };
}
