"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/src/lib/api";
import { GpsMapError, readGpsMapConfig, type GpsMapConfig } from "../_data/content-gps-map-types";

export function parseRuntimeMapConfig(value: unknown): GpsMapConfig {
  if (!value || typeof value !== "object") throw new GpsMapError("configuration");
  const config = value as Record<string, unknown>;
  const region = process.env.NEXT_PUBLIC_SITE_REGION;
  if (region !== "cn" && region !== "global") throw new GpsMapError("configuration");
  const cn = region === "cn";
  if (typeof config.key !== "string" || !config.key.trim()) throw new GpsMapError("configuration");
  if (
    !cn &&
    config.provider === "google" &&
    typeof config.mapId === "string" &&
    config.mapId.trim()
  )
    return { provider: "google", key: config.key, mapId: config.mapId };
  if (
    cn &&
    config.provider === "gaode" &&
    config.securityProxyPath === "/aurora/ip-commerce/content-gps-map/_AMapService"
  )
    return { provider: "gaode", key: config.key, securityProxyPath: config.securityProxyPath };
  throw new GpsMapError("configuration");
}

/** Existing explicitly configured builds remain valid. Otherwise obtain the
 * regional browser configuration from Server, without rebuilding Web for keys. */
export function useContentGpsMapConfig() {
  let built: GpsMapConfig | null = null;
  let buildError = false;
  try {
    built = readGpsMapConfig();
  } catch {
    buildError = true;
  }
  const result = useQuery({
    queryKey: ["content-gps-map-config", process.env.NEXT_PUBLIC_SITE_REGION],
    enabled: !built && !buildError,
    queryFn: async ({ signal }) =>
      parseRuntimeMapConfig(
        await api.get("/aurora/ip-commerce/content-gps-map/config", {
          signal,
          credentials: "omit",
          timeout: 10000,
        })
      ),
    staleTime: 60_000,
    retry: false,
  });
  return {
    config: built ?? result.data ?? null,
    error: buildError || result.isError,
    loading: !built && !buildError && result.isPending,
  };
}
