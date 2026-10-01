// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { ContentGpsMap } from "./content-gps-map";
import {
  GpsMapError,
  type GpsMapOptions,
  type GpsMapHandle,
  type GpsMapConfig,
  type GpsMapFeature,
} from "../_data/content-gps-map-types";
vi.mock("@/src/i18n/i18n", () => ({ useTranslations: () => (key: string) => key }));
let root: Root, host: HTMLDivElement, options: GpsMapOptions, handle: GpsMapHandle;
const factory = vi.fn();
const select = vi.fn(),
  viewport = vi.fn();
const config: GpsMapConfig = { provider: "google", key: "fixture", mapId: "fixture" };
const initialViewport = {
  west: 100,
  east: 110,
  south: -5,
  north: 10,
  coordinateSystem: "WGS84" as const,
};
const pin: GpsMapFeature = {
  id: "selected",
  label: "Selected story location",
  latitude: 1.3,
  longitude: 103.8,
  coordinateSystem: "WGS84",
  selected: true,
  matched: true,
  count: 1,
  entityId: "ip",
};
async function render(loading = false, features = [pin], provider: GpsMapConfig | null = config) {
  await act(async () =>
    root.render(
      <>
        <ContentGpsMap
          config={provider}
          features={features}
          initialViewport={initialViewport}
          loading={loading}
          onSelect={select}
          onViewport={viewport}
          factory={factory}
        />
        <p>Authorized list remains usable</p>
      </>
    )
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.resetAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  handle = { setFeatures: vi.fn(), destroy: vi.fn(), focus: vi.fn(), zoomBy: vi.fn() };
  factory.mockImplementation(async (value: GpsMapOptions) => {
    options = value;
    return handle;
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("does not load a provider when maps are disabled and leaves the list available", async () => {
  await render(false, [], null);
  expect(factory).not.toHaveBeenCalled();
  expect(host.textContent).toContain("unavailable");
  expect(host.textContent).toContain("Authorized list remains usable");
});
it("clears old markers while a query loads and only activates current result features", async () => {
  await render();
  expect(handle.setFeatures).toHaveBeenLastCalledWith([pin]);
  options.onActivate(pin);
  expect(select).toHaveBeenCalledWith("ip");
  await render(true);
  expect(handle.setFeatures).toHaveBeenLastCalledWith([]);
  options.onActivate(pin);
  expect(select).toHaveBeenCalledTimes(1);
  await render(false, []);
  options.onActivate(pin);
  expect(select).toHaveBeenCalledTimes(1);
});
it("reports display-only viewport changes once and zooms clusters without selecting an IP", async () => {
  const cluster = { ...pin, entityId: null, count: 5 };
  await render(false, [cluster]);
  options.onViewport(initialViewport);
  options.onViewport(initialViewport);
  expect(viewport).toHaveBeenCalledTimes(1);
  options.onActivate(cluster);
  expect(select).not.toHaveBeenCalled();
  expect(handle.focus).toHaveBeenCalledWith(1.3, 103.8);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="zoomIn"]')!.click());
  expect(handle.zoomBy).toHaveBeenCalledWith(1);
});
it("destroys a late provider result after unmount and ignores its events", async () => {
  let finish!: (value: GpsMapHandle) => void;
  factory.mockImplementation((value: GpsMapOptions) => {
    options = value;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await render();
  await act(async () => root.render(null));
  expect(options.signal.aborted).toBe(true);
  await act(async () => finish(handle));
  expect(handle.destroy).toHaveBeenCalledTimes(1);
  options.onActivate(pin);
  expect(select).not.toHaveBeenCalled();
});
it("clears the map on authentication failure while retaining independent list content", async () => {
  await render();
  await act(async () => options.onError(new GpsMapError("authentication")));
  expect(options.signal.aborted).toBe(true);
  expect(handle.destroy).toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toBe("authentication");
  expect(host.textContent).toContain("Authorized list remains usable");
});
it("disposes a prior provider when configuration changes", async () => {
  await render();
  const original = options;
  await render(false, [], { ...config, key: "new-key" });
  expect(original.signal.aborted).toBe(true);
  expect(handle.destroy).toHaveBeenCalled();
  expect(factory).toHaveBeenCalledTimes(2);
});
