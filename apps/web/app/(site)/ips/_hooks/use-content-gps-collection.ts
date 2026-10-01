"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/src/lib/api";

type Collection = {
  items: {
    targetType: string;
    status: string;
    ipId?: string;
    ip?: { id: string };
    episodeId?: string | null;
  }[];
};

export function useContentGpsCollection(
  viewerId: string | null,
  locale: string,
  selectedIpId: string | null
) {
  const client = useQueryClient();
  const key = ["content-gps-collection", viewerId, locale];
  const controllers = useRef(new Set<AbortController>());
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ ipId: string; cause: Error } | null>(null);
  useEffect(() => {
    const active = controllers.current;
    return () => {
      for (const controller of active) controller.abort();
      active.clear();
    };
  }, []);
  const query = useQuery({
    queryKey: key,
    enabled: Boolean(viewerId),
    retry: false,
    gcTime: 0,
    staleTime: 0,
    queryFn: ({ signal }) =>
      api.get<Collection>("/aurora/ip-commerce/me/collection", { params: { locale }, signal }),
  });
  const saved = (ipId: string) =>
    Boolean(
      !query.isError &&
      query.data?.items.some(
        (item) =>
          item.targetType === "ip" &&
          item.status === "active" &&
          !item.episodeId &&
          (item.ipId ?? item.ip?.id) === ipId
      )
    );
  async function toggle(ipId: string) {
    if (!viewerId || busyRef.current || query.isPending || query.isFetching || query.isError)
      return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      await api.post(
        saved(ipId)
          ? "/aurora/ip-commerce/me/collection/remove"
          : "/aurora/ip-commerce/me/collection",
        {
          data: { targetType: "ip", ipId },
          signal: controller.signal,
        }
      );
    } catch (cause) {
      if (!controller.signal.aborted)
        setError({ ipId, cause: cause instanceof Error ? cause : new Error(String(cause)) });
    } finally {
      // A lost write reply is uncertain. Re-read before enabling another action;
      // if the read fails, the button stays disabled until explicit read retry.
      if (!controller.signal.aborted) {
        await client.invalidateQueries({ queryKey: key, exact: true });
        if (!controller.signal.aborted) {
          setBusy(false);
          busyRef.current = false;
        }
      }
      controllers.current.delete(controller);
    }
  }
  return { query, saved, toggle, busy, error: error?.ipId === selectedIpId ? error.cause : null };
}
