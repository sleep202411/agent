// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { createGoogleGpsMap, createGaodeGpsMap } from "./content-gps-map-provider";
import type { GpsMapOptions, GpsMapFeature, GpsViewport } from "./content-gps-map-types";
import type { GaodeSdk, GoogleSdk, GoogleMap } from "./content-gps-map-sdk";

const bounds: GpsViewport = {
  west: 100,
  east: 110,
  south: -5,
  north: 10,
  coordinateSystem: "WGS84",
};
let maps: FakeMap[] = [],
  markers: Array<{ node: HTMLElement; remove: () => void }> = [];
class FakeMap {
  listeners = new Map<string, Set<() => void>>();
  destroyed = false;
  zoom = 5;
  center: unknown;
  constructor(
    public container: HTMLElement,
    public options: Record<string, unknown>
  ) {
    maps.push(this);
  }
  on(event: string, cb: () => void) {
    const set = this.listeners.get(event) ?? new Set();
    set.add(cb);
    this.listeners.set(event, set);
  }
  off(event: string, cb: () => void) {
    this.listeners.get(event)?.delete(cb);
  }
  addListener(event: string, cb: () => void) {
    this.on(event, cb);
    return { remove: () => this.off(event, cb) };
  }
  emit(event: string) {
    for (const fn of this.listeners.get(event) ?? []) fn();
  }
  fitBounds() {
    queueMicrotask(() => {
      this.emit("idle");
      this.emit("tilesloaded");
    });
  }
  setBounds() {
    queueMicrotask(() => this.emit("complete"));
  }
  getBounds() {
    return {
      toJSON: () => ({ west: 100, east: 110, south: -5, north: 10 }),
      getSouthWest: () => ({ getLng: () => 100, getLat: () => -5 }),
      getNorthEast: () => ({ getLng: () => 110, getLat: () => 10 }),
    };
  }
  getZoom() {
    return this.zoom;
  }
  setZoom(value: number) {
    this.zoom = value;
  }
  setCenter(value: unknown) {
    this.center = value;
  }
  setZoomAndCenter(zoom: number, center: unknown) {
    this.zoom = zoom;
    this.center = center;
  }
  destroy() {
    this.destroyed = true;
  }
}
class GoogleMarker extends HTMLElement {
  map: GoogleMap | null;
  constructor(options: Record<string, unknown>) {
    super();
    this.map = options.map as GoogleMap;
    this.title = String(options.title);
    (options.map as FakeMap).container.append(this);
    markers.push({ node: this, remove: () => this.remove() });
  }
}
customElements.define("gps-test-marker", GoogleMarker);
const google: GoogleSdk = {
  Map: FakeMap,
  marker: { AdvancedMarkerElement: GoogleMarker },
  event: { clearInstanceListeners: (target) => (target as FakeMap).listeners.clear() },
};
const gaode: GaodeSdk = {
  Map: FakeMap,
  Bounds: class {},
  Marker: class {
    node: HTMLElement;
    constructor(options: Record<string, unknown>) {
      this.node = options.content as HTMLElement;
      (options.map as FakeMap).container.append(this.node);
      markers.push({ node: this.node, remove: () => this.node.remove() });
    }
    setMap(map: unknown) {
      if (!map) this.node.remove();
    }
  },
};
let options: GpsMapOptions, abort: AbortController;
const feature = (patch: Partial<GpsMapFeature> = {}): GpsMapFeature => ({
  id: "pin",
  label: '<img src=x onerror="alert(1)">',
  latitude: 1.3,
  longitude: 103.8,
  coordinateSystem: "WGS84",
  matched: true,
  selected: false,
  count: 1,
  entityId: "ip",
  ...patch,
});
beforeEach(() => {
  maps = [];
  markers = [];
  abort = new AbortController();
  const container = document.createElement("div");
  document.body.append(container);
  options = {
    container,
    config: { provider: "google", key: "fixture", mapId: "fixture" },
    initialViewport: bounds,
    signal: abort.signal,
    onViewport: vi.fn(),
    onActivate: vi.fn(),
    onError: vi.fn(),
  };
});
afterEach(() => {
  abort.abort();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
it("uses Google WGS84 bounds and literal marker labels with non-color match/selection cues", async () => {
  const handle = await createGoogleGpsMap(google, options);
  handle.setFeatures([
    feature(),
    feature({ id: "other", matched: false }),
    feature({ id: "selected", selected: true }),
  ]);
  expect(options.onViewport).toHaveBeenCalledWith(bounds);
  expect(options.container.querySelector("img")).toBeNull();
  expect(markers.map((m) => m.node.textContent)).toEqual([
    "✓ 1",
    "○ 1",
    '◆ <img src=x onerror="alert(1)">',
  ]);
  markers[0].node.dispatchEvent(new Event("gmp-click"));
  expect(options.onActivate).toHaveBeenCalledWith(feature());
  handle.setFeatures([]);
  expect(options.container.children).toHaveLength(0);
  handle.destroy();
  expect(maps[0].listeners.size).toBe(0);
});
it("never plots coordinates from another system or nonfinite coordinates", async () => {
  const handle = await createGoogleGpsMap(google, options);
  handle.setFeatures([feature()]);
  expect(() => handle.setFeatures([feature({ coordinateSystem: "GCJ02" })])).toThrow("coordinates");
  expect(options.container.children).toHaveLength(0);
  expect(() => handle.setFeatures([feature({ latitude: NaN })])).toThrow("coordinates");
  handle.destroy();
});
it("keeps Gaode bounds/markers in GCJ02, uses keyboard-capable buttons and disposes handlers", async () => {
  options.config = { provider: "gaode", key: "fixture", securityProxyPath: "/_AMapService" };
  options.initialViewport = { ...bounds, coordinateSystem: "GCJ02" };
  const handle = await createGaodeGpsMap(gaode, options);
  const pin = feature({ coordinateSystem: "GCJ02" });
  handle.setFeatures([pin]);
  expect(options.onViewport).toHaveBeenCalledWith(options.initialViewport);
  const button = options.container.querySelector("button")!;
  expect(button.getAttribute("aria-label")).toBe(pin.label);
  button.click();
  expect(options.onActivate).toHaveBeenCalledWith(pin);
  handle.focus(1, 103);
  expect(maps[0].center).toEqual([103, 1]);
  handle.zoomBy(100);
  expect(maps[0].zoom).toBe(20);
  handle.destroy();
  button.click();
  expect(options.onActivate).toHaveBeenCalledTimes(1);
  expect(maps[0].destroyed).toBe(true);
});
it("aborts an unready provider and cleans its map/listeners without rendering a success", async () => {
  vi.spyOn(FakeMap.prototype, "fitBounds").mockImplementation(() => {});
  const promise = createGoogleGpsMap(google, options);
  abort.abort();
  await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  expect(maps[0].listeners.size).toBe(0);
});
it("fails and cleans up when provider tiles never become ready", async () => {
  vi.useFakeTimers();
  vi.spyOn(FakeMap.prototype, "setBounds").mockImplementation(() => {});
  options.config = { provider: "gaode", key: "fixture", securityProxyPath: "/_AMapService" };
  options.initialViewport = { ...bounds, coordinateSystem: "GCJ02" };
  const promise = createGaodeGpsMap(gaode, options);
  const rejected = expect(promise).rejects.toThrow("load");
  await vi.advanceTimersByTimeAsync(20000);
  await rejected;
  expect(maps[0].destroyed).toBe(true);
});
it("rejects a provider/viewport coordinate mismatch before initializing an SDK map", () => {
  expect(() => createGaodeGpsMap(gaode, options)).toThrow("coordinates");
  expect(maps).toHaveLength(0);
});

it("cleans up synchronous viewport-initialization failures without leaving a readiness timer", async () => {
  vi.useFakeTimers();
  vi.spyOn(FakeMap.prototype, "fitBounds").mockImplementation(() => {
    throw new Error("SDK unavailable");
  });
  await expect(createGoogleGpsMap(google, options)).rejects.toThrow("load");
  expect(maps[0].listeners.size).toBe(0);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["google", "gaode"] as const)(
  "renders a labelled virtual destination on %s without a creator identity",
  async (provider) => {
    if (provider === "gaode") {
      options.config = { provider: "gaode", key: "fixture", securityProxyPath: "/_AMapService" };
      options.initialViewport = { ...bounds, coordinateSystem: "GCJ02" };
    }
    const handle =
      provider === "google"
        ? await createGoogleGpsMap(google, options)
        : await createGaodeGpsMap(gaode, options);
    const island = feature({
      id: "virtual:fizzdragon-island",
      latitude: -25,
      longitude: -140,
      coordinateSystem: options.initialViewport.coordinateSystem,
      label: "FizzDragon Island · Virtual community",
      count: 87,
      entityId: null,
      virtualDestination: "fizzdragon-island",
    });
    handle.setFeatures([island]);
    expect(markers[0].node.textContent).toBe("◇ FizzDragon Island · Virtual community");
    markers[0].node.dispatchEvent(new Event(provider === "google" ? "gmp-click" : "click"));
    expect(options.onActivate).toHaveBeenCalledWith(island);
    handle.destroy();
  }
);
