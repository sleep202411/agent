// Mobile adapter based on the current official Web provider contract.
import { ContentGpsSearchRequestSchema } from "@repo/shared/content-gps";
import {
  loadGpsSdk,
  onGoogleMapAuthFailure,
  type GoogleSdk,
  type GaodeSdk,
} from "./content-gps-map-sdk";
import {
  GpsMapError,
  type GpsMapFactory,
  type GpsMapFeature,
  type GpsMapHandle,
  type GpsMapOptions,
  type GpsViewport,
} from "./content-gps-map-types";

function assertFeatures(features: GpsMapFeature[], system: GpsViewport["coordinateSystem"]) {
  if (
    features.some(
      (f) =>
        f.coordinateSystem !== system ||
        !Number.isFinite(f.latitude) ||
        !Number.isFinite(f.longitude) ||
        Math.abs(f.latitude) > 90 ||
        Math.abs(f.longitude) > 180
    )
  )
    throw new GpsMapError("coordinates");
}
function visual(feature: GpsMapFeature) {
  const node = document.createElement("span");
  node.textContent = `${feature.selected ? "◆" : feature.matched ? "✓" : "○"} ${feature.selected ? feature.label : feature.count}`;
  node.className =
    "inline-flex min-h-11 min-w-11 max-w-48 items-center justify-center gap-1 rounded-full px-3 text-xs font-semibold shadow-lg";
  Object.assign(node.style, {
    display: "inline-flex",
    minHeight: "44px",
    minWidth: "44px",
    maxWidth: "192px",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "8px",
    padding: "0 12px",
    font: "600 12px system-ui",
    background: feature.selected ? "#fff" : feature.matched ? "#E52227" : "#333",
    color: feature.selected ? "#111" : "#fff",
    border: feature.selected ? "3px solid #E52227" : "1px solid #aaa",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  });
  return node;
}
function viewport(
  raw: Omit<GpsViewport, "coordinateSystem">,
  coordinateSystem: GpsViewport["coordinateSystem"]
) {
  return ContentGpsSearchRequestSchema.shape.map.safeParse({ ...raw, coordinateSystem });
}
function ready(
  options: GpsMapOptions,
  handle: GpsMapHandle,
  subscribe: (success: () => void) => () => void,
  initialize: () => void
) {
  return new Promise<GpsMapHandle>((resolve, reject) => {
    let finished = false;
    const cleanup = () => {
      clearTimeout(timer);
      unsubscribe();
      options.signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      if (finished) return;
      finished = true;
      cleanup();
      handle.destroy();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      cleanup();
      handle.destroy();
      reject(new GpsMapError("load"));
    }, 20000);
    let unsubscribe = () => {};
    unsubscribe = subscribe(() => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve(handle);
    });
    if (finished) unsubscribe();
    if (!finished) options.signal.addEventListener("abort", abort, { once: true });
    if (options.signal.aborted) abort();
    if (!finished) {
      try {
        initialize();
      } catch {
        finished = true;
        cleanup();
        handle.destroy();
        reject(new GpsMapError("load"));
      }
    }
  });
}

export const createGpsMap: GpsMapFactory = async (options) => {
  if (options.signal.aborted) throw new DOMException("Aborted", "AbortError");
  const sdk = await loadGpsSdk(options.config);
  if (options.signal.aborted) throw new DOMException("Aborted", "AbortError");
  return options.config.provider === "google"
    ? createGoogleGpsMap(sdk as GoogleSdk, options)
    : createGaodeGpsMap(sdk as GaodeSdk, options);
};

export function createGoogleGpsMap(sdk: GoogleSdk, options: GpsMapOptions): Promise<GpsMapHandle> {
  if (options.config.provider !== "google" || options.initialViewport.coordinateSystem !== "WGS84")
    throw new GpsMapError("coordinates");
  const { container, initialViewport } = options;
  const map = new sdk.Map(container, {
    mapId: options.config.mapId,
    colorScheme: "DARK",
    disableDefaultUI: false,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    zoomControl: false,
    gestureHandling: "cooperative",
  });
  let disposed = false;
  let removeMarkers: (() => void)[] = [];
  const clear = () => {
    removeMarkers.forEach((remove) => remove());
    removeMarkers = [];
  };
  const idle = map.addListener("idle", () => {
    const bounds = map.getBounds();
    if (disposed || !bounds) return;
    const value = viewport(bounds.toJSON(), "WGS84");
    if (value.success) options.onViewport(value.data);
  });
  let unsubscribeAuth = () => {};
  const handle: GpsMapHandle = {
    setFeatures(features) {
      clear();
      assertFeatures(features, "WGS84");
      if (disposed) return;
      for (const feature of features) {
        const marker = new sdk.marker.AdvancedMarkerElement({
          map,
          position: { lat: feature.latitude, lng: feature.longitude },
          title: feature.label,
          gmpClickable: true,
          zIndex: feature.selected ? 1000 : feature.matched ? 100 : 1,
        });
        marker.append(visual(feature));
        const activate = () => {
          if (!disposed) options.onActivate(feature);
        };
        marker.addEventListener("gmp-click", activate);
        removeMarkers.push(() => {
          marker.removeEventListener("gmp-click", activate);
          marker.map = null;
          marker.remove();
        });
      }
    },
    zoomBy(delta) {
      if (!disposed) map.setZoom(Math.max(0, Math.min(20, (map.getZoom() ?? 2) + delta)));
    },
    focus(latitude, longitude) {
      if (!disposed) {
        map.setCenter({ lat: latitude, lng: longitude });
        map.setZoom(Math.min(20, (map.getZoom() ?? 2) + 2));
      }
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      clear();
      idle.remove();
      unsubscribeAuth();
      sdk.event.clearInstanceListeners(map);
      container.replaceChildren();
    },
  };
  unsubscribeAuth = onGoogleMapAuthFailure(() => {
    handle.destroy();
    options.onError(new GpsMapError("authentication"));
  });
  if (disposed) {
    unsubscribeAuth();
    return Promise.reject(new GpsMapError("authentication"));
  }
  return ready(
    options,
    handle,
    (success) => {
      const listener = map.addListener("tilesloaded", success);
      return () => listener.remove();
    },
    () => map.fitBounds(initialViewport, 24)
  );
}

export function createGaodeGpsMap(sdk: GaodeSdk, options: GpsMapOptions): Promise<GpsMapHandle> {
  if (options.config.provider !== "gaode" || options.initialViewport.coordinateSystem !== "GCJ02")
    throw new GpsMapError("coordinates");
  const { container, initialViewport } = options;
  const map = new sdk.Map(container, {
    viewMode: "2D",
    resizeEnable: true,
    mapStyle: "amap://styles/dark",
    zoom: 4,
    center: [105, 35],
  });
  let disposed = false;
  let removeMarkers: (() => void)[] = [];
  const clear = () => {
    removeMarkers.forEach((remove) => remove());
    removeMarkers = [];
  };
  const changed = () => {
    const bounds = map.getBounds();
    if (disposed || !bounds) return;
    const sw = bounds.getSouthWest(),
      ne = bounds.getNorthEast();
    const value = viewport(
      { west: sw.getLng(), east: ne.getLng(), south: sw.getLat(), north: ne.getLat() },
      "GCJ02"
    );
    if (value.success) options.onViewport(value.data);
  };
  map.on("moveend", changed);
  map.on("zoomend", changed);
  map.on("complete", changed);
  const handle: GpsMapHandle = {
    setFeatures(features) {
      clear();
      assertFeatures(features, "GCJ02");
      if (disposed) return;
      for (const feature of features) {
        const button = document.createElement("button");
        button.type = "button";
        button.setAttribute("aria-label", feature.label);
        button.title = feature.label;
        button.className =
          "rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";
        button.append(visual(feature));
        const activate = (event: MouseEvent) => {
          event.stopPropagation();
          if (!disposed) options.onActivate(feature);
        };
        button.addEventListener("click", activate);
        const marker = new sdk.Marker({
          map,
          position: [feature.longitude, feature.latitude],
          content: button,
          anchor: "bottom-center",
          zIndex: feature.selected ? 1000 : feature.matched ? 100 : 1,
        });
        removeMarkers.push(() => {
          button.removeEventListener("click", activate);
          marker.setMap(null);
          button.remove();
        });
      }
    },
    zoomBy(delta) {
      if (!disposed) map.setZoom(Math.max(2, Math.min(20, map.getZoom() + delta)));
    },
    focus(latitude, longitude) {
      if (!disposed) map.setZoomAndCenter(Math.min(20, map.getZoom() + 2), [longitude, latitude]);
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      clear();
      map.off("moveend", changed);
      map.off("zoomend", changed);
      map.off("complete", changed);
      map.destroy();
      container.replaceChildren();
    },
  };
  return ready(
    options,
    handle,
    (success) => {
      map.on("complete", success);
      return () => map.off("complete", success);
    },
    () =>
      map.setBounds(
        new sdk.Bounds(
          [initialViewport.west, initialViewport.south],
          [initialViewport.east, initialViewport.north]
        ),
        true
      )
  );
}
