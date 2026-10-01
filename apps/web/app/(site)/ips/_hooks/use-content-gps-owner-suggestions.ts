"use client";
import { useEffect, useRef, useState } from "react";
import {
  ContentGpsOwnerSuggestionsSchema,
  type ContentGpsOwnerSuggestions,
} from "@repo/shared/content-gps";
import { api, ApiRequestError } from "@/src/lib/api";

export function useContentGpsOwnerSuggestions(
  ipId: string,
  locale: string,
  onDenied: (error: unknown) => void
) {
  const [data, setData] = useState<ContentGpsOwnerSuggestions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  async function load() {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setData(null);
    setError(null);
    try {
      const result = ContentGpsOwnerSuggestionsSchema.parse(
        await api.get(
          `/aurora/ip-commerce/me/ips/${encodeURIComponent(ipId)}/content-gps/suggestions`,
          { params: { locale }, signal: controller.signal }
        )
      );
      if (!controller.signal.aborted) setData(result);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : String(cause));
        if (cause instanceof ApiRequestError && [401, 403, 404].includes(cause.status))
          onDenied(cause);
      }
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }
  return { data, error, busy, load };
}
