"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminOperation } from "../use-admin-operation";
import { mutateEnvelope, requestEnvelope, toErrorMessage } from "../billing/shared";

/** Crew and position moderation share the same cursor and mutation contract. */
export function useModerationQueue<T extends { id: string; moderationStatus: string }>(
  endpoint: string,
  query: string,
  status: string
) {
  const { begin, busy } = useAdminOperation();
  const [items, setItems] = useState<T[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const writing = useRef(false);
  const read = useRef<ReturnType<typeof begin>>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const queryKey = JSON.stringify([query, status]);
  const load = useCallback(
    async (cursor: string | null = null) => {
      const operation = begin("read");
      if (!operation) return;
      read.current = operation;
      setError(null);
      const params = new URLSearchParams({ limit: "30" });
      if (query) params.set("q", query);
      if (status) params.set("moderationStatus", status);
      if (cursor) params.set("cursor", cursor);
      try {
        const data = await requestEnvelope<{ items: T[]; nextCursor: string | null }>(
          `${endpoint}?${params}`,
          operation.signal
        );
        if (!operation.current()) return;
        setItems((previous) => [
          ...new Map(
            (cursor ? [...previous, ...data.items] : data.items).map((item) => [item.id, item])
          ).values(),
        ]);
        setNextCursor(data.nextCursor);
        setLoadedKey(queryKey);
      } catch (err) {
        if (operation.current()) setError(toErrorMessage(err));
      } finally {
        if (read.current === operation) read.current = null;
        operation.finish();
      }
    },
    [begin, endpoint, query, queryKey, status]
  );
  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) void load();
    });
    return () => {
      active = false;
      read.current?.cancel();
      read.current?.finish();
      read.current = null;
    };
  }, [load]);
  const moderate = async (item: T, nextStatus: "ok" | "taken_down", reason?: string) => {
    if (nextStatus === "taken_down" && !reason?.trim()) return false;
    const operation = begin("write");
    if (!operation) return false;
    writing.current = true;
    setActing(true);
    setError(null);
    try {
      const updated = await mutateEnvelope<T>(
        `${endpoint}/${encodeURIComponent(item.id)}/moderation`,
        { status: nextStatus, ...(reason ? { reason } : {}) },
        "POST",
        operation.signal
      );
      if (!operation.current()) return false;
      setItems((previous) =>
        previous.flatMap((row) =>
          row.id !== updated.id
            ? [row]
            : status && updated.moderationStatus !== status
              ? []
              : [updated]
        )
      );
      return true;
    } catch (err) {
      if (operation.current()) setError(toErrorMessage(err));
      return false;
    } finally {
      if (operation.current()) {
        writing.current = false;
        setActing(false);
      }
      operation.finish();
    }
  };
  return {
    items,
    nextCursor: loadedKey === queryKey ? nextCursor : null,
    loading: busy || (loadedKey === null && !error),
    error,
    acting,
    writing,
    load,
    moderate,
  };
}
