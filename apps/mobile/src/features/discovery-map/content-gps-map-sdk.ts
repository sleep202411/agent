// Mobile adapter based on the current official Web provider contract.
import { GpsMapError, type GpsMapConfig } from "./content-gps-map-types";

// Minimal boundaries used by our adapter, rather than a second application-wide
// global SDK type. These APIs are documented in the provider references in the plan.
export type GoogleMap = {
  getBounds():
    | { toJSON(): { west: number; east: number; south: number; north: number } }
    | undefined;
  getZoom(): number | undefined;
  setZoom(value: number): void;
  setCenter(value: { lat: number; lng: number }): void;
  fitBounds(
    value: { west: number; east: number; south: number; north: number },
    padding?: number
  ): void;
  addListener(name: string, listener: () => void): { remove(): void };
};
export type GoogleMarker = HTMLElement & { map: GoogleMap | null };
export type GoogleSdk = {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => GoogleMap;
  marker: { AdvancedMarkerElement: new (options: Record<string, unknown>) => GoogleMarker };
  event: { clearInstanceListeners(target: object): void };
};
type GaodeLngLat = { getLng(): number; getLat(): number };
export type GaodeMap = {
  getBounds(): { getSouthWest(): GaodeLngLat; getNorthEast(): GaodeLngLat } | undefined;
  getZoom(): number;
  setZoom(value: number): void;
  setZoomAndCenter(zoom: number, center: [number, number]): void;
  setBounds(bounds: object, immediately?: boolean): void;
  on(name: string, handler: () => void): void;
  off(name: string, handler: () => void): void;
  destroy(): void;
};
export type GaodeMarker = { setMap(map: GaodeMap | null): void };
export type GaodeSdk = {
  Map: new (container: HTMLElement, options: Record<string, unknown>) => GaodeMap;
  Bounds: new (southWest: [number, number], northEast: [number, number]) => object;
  Marker: new (options: Record<string, unknown>) => GaodeMarker;
};
type ProviderWindow = Window & {
  google?: { maps: GoogleSdk };
  AMap?: GaodeSdk;
  _AMapSecurityConfig?: { serviceHost: string };
  gm_authFailure?: () => void;
};
const loads = new Map<string, { signature: string; promise: Promise<GoogleSdk | GaodeSdk> }>();
const failures = new Set<() => void>();
let googleAuthFailed = false;
let callbackSerial = 0;
export function onGoogleMapAuthFailure(callback: () => void) {
  failures.add(callback);
  if (googleAuthFailed) callback();
  return () => {
    failures.delete(callback);
  };
}

export function loadGpsSdk(config: GpsMapConfig): Promise<GoogleSdk | GaodeSdk> {
  const signature = JSON.stringify(config);
  const existing = loads.get(config.provider);
  if (existing)
    return existing.signature === signature
      ? existing.promise
      : Promise.reject(new GpsMapError("conflict"));
  const host = window as ProviderWindow;
  // Do not silently take over an SDK initialized elsewhere with different keys/config.
  if (
    (config.provider === "google" && host.google?.maps) ||
    (config.provider === "gaode" && host.AMap)
  )
    return Promise.reject(new GpsMapError("conflict"));
  const promise = new Promise<GoogleSdk | GaodeSdk>((resolve, reject) => {
    const script = document.createElement("script");
    const callback = `__fizzGpsReady${++callbackSerial}`;
    const callbacks = window as unknown as Record<string, unknown>;
    let settled = false;
    const finish = (error?: GpsMapError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // A late script callback is harmless after timeout/unmount; it cannot resolve a newer attempt.
      callbacks[callback] = () => {};
      script.onerror = null;
      if (error) {
        script.remove();
        reject(error);
        return;
      }
      const sdk = config.provider === "google" ? host.google?.maps : host.AMap;
      if (!sdk) reject(new GpsMapError("load"));
      else resolve(sdk);
    };
    const timer = setTimeout(() => finish(new GpsMapError("load")), 15000);
    callbacks[callback] = () => finish();
    const src = new URL(
      config.provider === "google"
        ? "https://maps.googleapis.com/maps/api/js"
        : "https://webapi.amap.com/maps"
    );
    src.searchParams.set("key", config.key);
    src.searchParams.set("callback", callback);
    if (config.provider === "google") {
      src.searchParams.set("v", "quarterly");
      src.searchParams.set("libraries", "marker");
      src.searchParams.set("loading", "async");
      const previous = host.gm_authFailure;
      host.gm_authFailure = () => {
        googleAuthFailed = true;
        finish(new GpsMapError("authentication"));
        for (const failure of failures) failure();
        previous?.();
      };
    } else {
      src.searchParams.set("v", "2.0");
      host._AMapSecurityConfig = {
        serviceHost: new URL(config.securityProxyPath, location.origin).href,
      };
    }
    script.async = true;
    script.src = src.href;
    script.nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce ?? "";
    script.onerror = () => finish(new GpsMapError("load"));
    document.head.append(script);
  });
  // A failed load stays failed for this document. Retrying the view reloads the
  // document, avoiding competing late SDK scripts and accidental key changes.
  loads.set(config.provider, { signature, promise });
  return promise;
}
