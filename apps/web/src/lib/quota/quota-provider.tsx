"use client";

/**
 * QuotaProvider — single source of truth for per-user quota state.
 *
 *   - On mount: GET /aurora/quota → seeds the snapshot.
 *   - Opens one WS to `/aurora/quota/subscribe`; merges `quota_updated`
 *     frames into state by dimension key. Survives reconnects (the
 *     gateway re-pushes a fresh snapshot on the next event).
 *   - Logs out: closes WS; quota state resets to null.
 *
 * Components consume via `useQuota(dimension)` — never read context
 * directly. The hook normalises wire `"Infinity"` strings back to
 * `Number.POSITIVE_INFINITY` so render logic doesn't care about the
 * JSON quirk.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { QuotaDimension, QuotaPeekWire, QuotaSnapshotWire } from "@repo/shared";
import { openQuotaClient, type QuotaClient } from "./quota-client";

interface QuotaState {
  loading: boolean;
  /** null = not yet fetched (loading or auth missing). */
  peek: QuotaPeekWire | null;
  /** Increments on each WS reconnect — useful for retry UI. */
  reconnectAttempts: number;
  /** Last WS terminate reason, if any (e.g. "unauthorized"). */
  terminated: { reason: string; code: number } | null;
  refresh: () => Promise<void>;
}

const QuotaContext = createContext<QuotaState | null>(null);

export function useQuotaContext(): QuotaState {
  const ctx = useContext(QuotaContext);
  if (!ctx) {
    // Allow components to render outside provider in storybook /
    // tests — return a no-op default rather than throwing.
    return {
      loading: false,
      peek: null,
      reconnectAttempts: 0,
      terminated: null,
      refresh: async () => {},
    };
  }
  return ctx;
}

export interface QuotaProviderProps {
  /** Pass false when user is logged out — provider becomes a no-op. */
  enabled?: boolean;
  children: ReactNode;
}

export function QuotaProvider({ enabled = true, children }: QuotaProviderProps) {
  const [peek, setPeek] = useState<QuotaPeekWire | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [reconnectAttempts, setReconnectAttempts] = useState<number>(0);
  const [terminated, setTerminated] = useState<{ reason: string; code: number } | null>(null);
  const clientRef = useRef<QuotaClient | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    try {
      const res = await fetch("/aurora/quota", { credentials: "include" });
      if (!res.ok) throw new Error(`GET /aurora/quota → ${res.status}`);
      const json = (await res.json()) as { code: number; data: QuotaPeekWire };
      if (json?.code === 200 && json.data) setPeek(json.data);
    } catch (err) {
      // Quota fetch failing is non-fatal — UI just doesn't render
      // the badge. Don't pop a toast; the user didn't do anything.
      console.warn("[quota] GET /aurora/quota failed:", err);
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setPeek(null);
      setLoading(false);
      return;
    }
    void refresh();

    const client = openQuotaClient({
      onUpdate: (snap: QuotaSnapshotWire) => {
        // Merge — replace this dimension's snapshot only. Other
        // dimensions stay client-cached; the gateway only pushes
        // the one that changed.
        setPeek((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            dimensions: { ...prev.dimensions, [snap.dimension]: snap },
          };
        });
      },
      onReconnected: () => {
        setReconnectAttempts((n) => n + 1);
        // After a reconnect, refetch so we don't miss any quota_updated
        // event that fired while we were offline.
        void refresh();
      },
      onTerminate: (reason, code) => {
        setTerminated({ reason, code });
      },
    });
    clientRef.current = client;
    return () => {
      client.close();
      clientRef.current = null;
    };
  }, [enabled, refresh]);

  const value: QuotaState = useMemo(
    () => ({ loading, peek, reconnectAttempts, terminated, refresh }),
    [loading, peek, reconnectAttempts, terminated, refresh]
  );
  return <QuotaContext.Provider value={value}>{children}</QuotaContext.Provider>;
}

// Re-export for convenience.
export type { QuotaDimension, QuotaPeekWire };
