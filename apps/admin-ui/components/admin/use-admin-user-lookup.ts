"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { requestEnvelope, toErrorMessage } from "./billing/shared";
import type { UserLookupResult } from "./growth/referrals-types";
import { useAdminOperation } from "./use-admin-operation";

export function useAdminUserLookup(enabled = true) {
  const { begin, busy: searching } = useAdminOperation();
  const pending = useRef<ReturnType<typeof begin>>(null);
  const active = useRef(enabled);
  const [query, setQueryValue] = useState("");
  const [results, setResults] = useState<UserLookupResult[]>([]);
  const [lookupError, setLookupError] = useState<string | null>(null);
  useLayoutEffect(() => {
    active.current = enabled;
    if (!enabled) {
      pending.current?.cancel();
      pending.current?.finish();
      pending.current = null;
    }
    return () => {
      active.current = false;
    };
  }, [enabled]);

  function cancel() {
    pending.current?.cancel();
    pending.current?.finish();
    pending.current = null;
  }
  function setQuery(value: string) {
    cancel();
    setQueryValue(value);
    setResults([]);
    setLookupError(null);
  }
  async function runLookup() {
    const q = query.trim();
    if (!active.current || !q) return;
    const operation = begin();
    if (!operation) return;
    pending.current = operation;
    setLookupError(null);
    try {
      const data = await requestEnvelope<UserLookupResult[]>(
        `/api/admin/referrals/user-lookup?q=${encodeURIComponent(q)}`,
        operation.signal
      );
      if (!operation.current()) return;
      setResults(data);
      if (data.length === 0) setLookupError("No matching users.");
    } catch (error) {
      if (operation.current()) setLookupError(toErrorMessage(error));
    } finally {
      if (pending.current === operation) pending.current = null;
      operation.finish();
    }
  }
  return { query, setQuery, results, searching, lookupError, runLookup, cancel };
}
