"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { acquireVideoPoster } from "./video-poster";

type VideoPoster =
  | { status: "ready"; url: string; expiresAt: string | null }
  | { status: "pending" }
  | { status: "failed"; message: string };

export function videoPosterPath(src: string, assetId?: string, documentId?: string | null) {
  let url: URL;
  try {
    url = new URL(src, "https://local.invalid");
  } catch {
    return null;
  }
  // A pending local upload has no stored original to process yet.
  if (url.protocol === "blob:") return null;
  const match = url.pathname.match(/^\/aurora\/media\/assets\/([^/]+)\/(?:content|access)$/);
  const id = assetId ?? match?.[1];
  if (!id) return null;
  const params = new URLSearchParams();
  const context = documentId ?? (match ? url.searchParams.get("documentId") : null);
  if (context) params.set("documentId", context);
  return `/aurora/media/assets/${encodeURIComponent(id)}/poster${params.size ? `?${params}` : ""}`;
}

export function useVideoPoster(
  src: string,
  assetId: string | undefined,
  documentId: string | null | undefined,
  visible: boolean
) {
  const path = videoPosterPath(src, assetId, documentId);
  return useQuery({
    queryKey: ["video-poster", path ?? src],
    enabled: visible && !!src,
    queryFn: async ({ signal }): Promise<VideoPoster> => {
      if (path) return api.get<VideoPoster>(path, { requestScope: "user", signal });
      // Unsaved/local media cannot have a durable server poster yet. This
      // bounded extraction keeps working while the user starts playback.
      const request = acquireVideoPoster(src);
      const release = () => request.release();
      signal.addEventListener("abort", release, { once: true });
      try {
        const poster = await request.promise;
        return { status: "ready", url: poster.url, expiresAt: null };
      } finally {
        signal.removeEventListener("abort", release);
        release();
      }
    },
    staleTime: (query) => {
      const data = query.state.data;
      if (data?.status !== "ready") return 0;
      return data.expiresAt
        ? Math.max(0, Date.parse(data.expiresAt) - query.state.dataUpdatedAt - 30_000)
        : Infinity;
    },
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === "pending") return 3_000;
      // A failed fetch (e.g. a flaky route to the storage endpoint) must not
      // pin "preview unavailable" until remount — retry on a slow cadence.
      if (query.state.isError) return 30_000;
      return data?.status === "ready" && data.expiresAt
        ? Math.max(1_000, Date.parse(data.expiresAt) - Date.now() - 30_000)
        : false;
    },
    retry: 1,
    gcTime: 10 * 60_000,
  });
}
