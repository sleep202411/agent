"use client";
import { useEffect, useRef, useState } from "react";
import { CreatorGeocodeStateSchema, type CreatorGeocodeState } from "@repo/shared/creator-location";
import { api, ApiRequestError } from "@/src/lib/api";

export function useCreatorGeocoding(
  version: number,
  locale: string,
  onDenied: (error: unknown) => void
) {
  const [state, setState] = useState<CreatorGeocodeState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const operation = useRef<AbortController | null>(null);
  const path = "/aurora/creator-location/me/geocode";
  async function run(resolve: boolean) {
    if (operation.current) return;
    if (
      resolve &&
      (!state ||
        state.version !== version ||
        !["missing", "expired", "unresolved", "ambiguous", "resolved"].includes(state.state))
    )
      return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError(null);
    setState(null);
    try {
      const response = CreatorGeocodeStateSchema.parse(
        resolve
          ? await api.post(path, {
              data: { expectedVersion: version, locale },
              signal: controller.signal,
            })
          : await api.get(path, { signal: controller.signal })
      );
      if (!controller.signal.aborted) setState(response);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : String(cause));
        if (cause instanceof ApiRequestError && [401, 403].includes(cause.status)) onDenied(cause);
      }
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }
  useEffect(() => () => operation.current?.abort(), []);
  return { state, busy, error, check: () => run(false), resolve: () => run(true) };
}
