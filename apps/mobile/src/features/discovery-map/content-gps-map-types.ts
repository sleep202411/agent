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
