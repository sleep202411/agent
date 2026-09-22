"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export function mediaAccessPath(
  src: string,
  assetId?: string,
  documentId?: string | null
): string | null {
  let url: URL;
  try {
    url = new URL(src, "https://local.invalid");
  } catch {
    return null;
  }
  const match = url.pathname.match(/^\/aurora\/media\/assets\/([^/]+)\/(?:content|access)$/);
  const signed = ["X-Amz-Signature", "Signature", "sig", "OSSAccessKeyId"].some((key) =>
    url.searchParams.has(key)
  );
  // Older canvas repairs persisted the R2 S3 API endpoint in the generation
  // payload. It is a storage API URL, not a browser playback URL, but the
  // durable asset ID still gives the server enough information to issue the
  // correct CDN/signed URL.
  const internalR2 = url.hostname.endsWith(".r2.cloudflarestorage.com");
  const id = assetId ?? match?.[1];
  if (!id || (!match && !signed && !internalR2)) return null;
  const params = match ? url.searchParams : new URLSearchParams();
  if (documentId) params.set("documentId", documentId);
  return `/aurora/media/assets/${encodeURIComponent(id)}/access${params.size ? `?${params}` : ""}`;
}

type Access = { url: string; expiresAt: string | null };
export function useMediaPlaybackSource(
  src: string,
  enabled: boolean,
  assetId?: string,
  documentId?: string | null
) {
  const accessPath = mediaAccessPath(src, assetId, documentId);
  const access = useQuery({
    queryKey: ["media-playback", accessPath],
    queryFn: () => api.get<Access>(accessPath!, { requestScope: "user", timeout: 15_000 }),
    enabled: enabled && !!accessPath,
    staleTime: (query) =>
      query.state.data?.expiresAt
        ? Math.max(0, Date.parse(query.state.data.expiresAt) - query.state.dataUpdatedAt - 30_000)
        : Infinity,
    refetchInterval: (query) =>
      query.state.data?.expiresAt
        ? Math.max(1_000, Date.parse(query.state.data.expiresAt) - Date.now() - 30_000)
        : false,
    retry: 1,
  });
  return {
    src: accessPath ? access.data?.url : src,
    error: access.error,
    refresh: async () => (accessPath ? (await access.refetch()).data?.url : src),
  };
}
