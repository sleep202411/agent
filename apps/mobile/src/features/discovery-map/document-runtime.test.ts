import { expect, it, vi } from "vitest";
import { mountMapDocument } from "./document-runtime";
import { readMapCommand } from "./protocol";
import { GpsMapError, type GpsMapOptions, type GpsMapHandle } from "./content-gps-map-types";
const channel = "mobile-test-channel-123456";
const viewport = { coordinateSystem: "WGS84", west: 170, east: -170, south: -20, north: 20 };
const config = { provider: "google", key: "fixture-public-key", mapId: "fixture-map" };
const initial = { type: "initialize", viewport, config };
const feature = {
  id: "cluster:1",
  latitude: 1,
  longitude: 175,
  coordinateSystem: "WGS84",
  label: "<b>Safe label</b>",
  count: 2,
  matched: true,
  selected: false,
  entityId: null,
};
const message = (body: object, sequence = 0) => ({ version: 1, channel, sequence, ...body });
const setup = () => {
  const send = vi.fn();
  const handle = { setFeatures: vi.fn(), zoomBy: vi.fn(), focus: vi.fn(), destroy: vi.fn() };
  const factory = vi
    .fn<(options: GpsMapOptions) => Promise<GpsMapHandle>>()
    .mockResolvedValue(handle);
  const runtime = mountMapDocument(document.createElement("div"), channel, factory, send);
  return { send, handle, factory, runtime };
};
it("validates channel, provider coordinates, bounded features and same-origin proxy paths", () => {
  expect(readMapCommand(message(initial), channel)).toMatchObject(initial);
  for (const raw of [
    "not json",
    message(initial, -1),
    { ...message(initial), channel: "other-session-token-1234" },
    message({ ...initial, viewport: { ...viewport, coordinateSystem: "GCJ02" } }),
    message({ ...initial, viewport: { ...viewport, north: -21 } }),
    message({
      ...initial,
      config: { provider: "gaode", key: "fixture", securityProxyPath: "//evil.test" },
      viewport: { ...viewport, coordinateSystem: "GCJ02" },
    }),
    message({ type: "features", features: [{ ...feature, latitude: Infinity }] }),
    message({ type: "features", features: Array(501).fill(feature) }),
    message({ type: "zoom", delta: 100 }),
    message({ type: "focus", latitude: 0, longitude: 181 }),
    message({ ...initial, authToken: "not-allowed" }),
  ])
    expect(readMapCommand(raw, channel)).toBeNull();
});
it("accepts initialization once and updates markers without recreating or reloading the provider", async () => {
  const { runtime, factory, handle, send } = setup();
  expect(send).toHaveBeenCalledWith({ type: "ready" });
  await runtime.receive(message({ type: "zoom", delta: 1 }, 99));
  await runtime.receive(message(initial));
  expect(send).toHaveBeenCalledWith({ type: "loaded" });
  await runtime.receive(message({ type: "features", features: [feature] }, 1));
  await runtime.receive(message({ type: "features", features: [] }, 0));
  await runtime.receive(message(initial, 100));
  expect(factory).toHaveBeenCalledTimes(1);
  expect(handle.setFeatures).toHaveBeenCalledExactlyOnceWith([feature]);
  await runtime.receive(message({ type: "zoom", delta: 1 }, 2));
  await runtime.receive(message({ type: "focus", latitude: 1, longitude: 175 }, 3));
  expect(handle.zoomBy).toHaveBeenCalledWith(1);
  expect(handle.focus).toHaveBeenCalledWith(1, 175);
  const options = factory.mock.calls[0][0];
  options.onActivate(feature as never);
  expect(send).toHaveBeenCalledWith({ type: "activate", id: feature.id, sequence: 1 });
  options.onViewport(viewport as never);
  expect(send).toHaveBeenCalledWith({ type: "viewport", viewport });
  runtime.destroy();
  expect(options.signal.aborted).toBe(true);
  send.mockClear();
  options.onActivate(feature as never);
  options.onViewport(viewport as never);
  await runtime.receive(message({ type: "zoom", delta: 1 }, 4));
  expect(send).not.toHaveBeenCalled();
  expect(handle.zoomBy).toHaveBeenCalledTimes(1);
});
it("destroys a late provider after unmount without sending a loaded event", async () => {
  const { runtime, factory, handle, send } = setup();
  let finish!: (value: GpsMapHandle) => void;
  factory.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const pending = runtime.receive(message(initial));
  runtime.destroy();
  finish(handle);
  await pending;
  expect(handle.destroy).toHaveBeenCalledTimes(1);
  expect(send).not.toHaveBeenCalledWith({ type: "loaded" });
});
it("fails closed on coordinate mismatch or duplicate marker IDs", async () => {
  for (const features of [[{ ...feature, coordinateSystem: "GCJ02" }], [feature, feature]]) {
    const { runtime, handle, send } = setup();
    await runtime.receive(message(initial));
    await runtime.receive(message({ type: "features", features }, 1));
    expect(handle.setFeatures).not.toHaveBeenCalled();
    expect(handle.destroy).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ type: "error", reason: "coordinates" });
    await runtime.receive(message(initial, 2));
    expect(send.mock.calls.filter(([event]) => event.type === "loaded")).toHaveLength(1);
  }
});
it("reports provider errors without leaking arbitrary error details or retrying", async () => {
  const { runtime, factory, send } = setup();
  factory.mockRejectedValueOnce(new GpsMapError("authentication"));
  await runtime.receive(message(initial));
  await runtime.receive(message(initial, 1));
  expect(send).toHaveBeenCalledWith({ type: "error", reason: "authentication" });
  expect(factory).toHaveBeenCalledTimes(1);
});
