"use client";
import { useEffect, useState } from "react";
import { useAdminSessionRequests } from "../admin-session-boundary";
import { requestEnvelope, toErrorMessage } from "./shared";
import type { AdminIpsData } from "./types";
export function useDiscoveryIpSearch(search: string, open = true) {
  const scope = useAdminSessionRequests();
  const [items, setItems] = useState<AdminIpsData["items"]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!open) return;
    const lease = scope.begin();
    if (!lease) return;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ limit: "20" });
      if (search.trim()) params.set("q", search.trim());
      void requestEnvelope<AdminIpsData>(`/api/admin/ip-commerce/ips?${params}`, {
        signal: lease.signal,
      })
        .then((data) => {
          if (lease.current()) setItems(data.items);
        })
        .catch((err: unknown) => {
          if (lease.current()) setError(toErrorMessage(err));
        })
        .finally(() => {
          if (lease.current()) setLoading(false);
          lease.release();
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      lease.cancel();
    };
  }, [scope, search, revision, open]);
  return { items, error, loading, retry: () => setRevision((current) => current + 1) };
}
