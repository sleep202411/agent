import type { ContentGpsSearchRequest } from "@repo/shared/content-gps";

export type GpsViewport = ContentGpsSearchRequest["map"];
export type GpsMapFeature = {
  id: string;
  latitude: number;
  longitude: number;
  coordinateSystem: GpsViewport["coordinateSystem"];
  label: string;
  matched: boolean;
  selected: boolean;
  count: number;
  entityId: string | null;
  /** A fictional community anchor, never an entity location or geographic cluster. */
  virtualDestination?: string;
};
export type GpsMapConfig =
  | { provider: "google"; key: string; mapId: string }
  | { provider: "gaode"; key: string; securityProxyPath: string };
export class GpsMapError extends Error {
  constructor(
    public readonly reason: "configuration" | "load" | "authentication" | "coordinates" | "conflict"
  ) {
    super(reason);
  }
}
export type GpsMapHandle = {
  setFeatures(features: GpsMapFeature[]): void;
  zoomBy(delta: number): void;
  focus(latitude: number, longitude: number): void;
  destroy(): void;
};
export type GpsMapOptions = {
  container: HTMLElement;
  config: GpsMapConfig;
  initialViewport: GpsViewport;
  signal: AbortSignal;
  onViewport: (viewport: GpsViewport) => void;
  onActivate: (feature: GpsMapFeature) => void;
  onError: (error: GpsMapError) => void;
};
export type GpsMapFactory = (options: GpsMapOptions) => Promise<GpsMapHandle>;

export function readGpsMapConfig(): GpsMapConfig | null {
  const enabled = process.env.NEXT_PUBLIC_CONTENT_GPS_MAP_ENABLED;
  if (!enabled || enabled === "false") return null;
  if (enabled !== "true") throw new GpsMapError("configuration");
  const region = process.env.NEXT_PUBLIC_SITE_REGION;
  if (region === "global") {
    const key = process.env.NEXT_PUBLIC_CONTENT_GPS_GOOGLE_KEY?.trim();
    const mapId = process.env.NEXT_PUBLIC_CONTENT_GPS_GOOGLE_MAP_ID?.trim();
    if (!key || !mapId) throw new GpsMapError("configuration");
    return { provider: "google", key, mapId };
  }
  if (region === "cn") {
    const key = process.env.NEXT_PUBLIC_CONTENT_GPS_GAODE_KEY?.trim();
    const securityProxyPath = process.env.NEXT_PUBLIC_CONTENT_GPS_GAODE_PROXY_PATH?.trim();
    // Same-origin proxy only. The server-side security code never enters this bundle.
    if (
      !key ||
      !securityProxyPath ||
      !/^\/[A-Za-z0-9/_-]+$/.test(securityProxyPath) ||
      securityProxyPath.startsWith("//")
    )
      throw new GpsMapError("configuration");
    return { provider: "gaode", key, securityProxyPath };
  }
  throw new GpsMapError("configuration");
}
