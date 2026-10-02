import { expect, it, vi } from "vitest";
import { createMapSession } from "./session";
import { parseDiscoveryMapConfig } from "./config";
import { injection, safeMapAttributionUrl } from "./frame-types";
const channel = "parent-map-session-123456";
const viewport = { coordinateSystem: "WGS84" as const, west: 100, east: 120, south: 0, north: 20 };
const feature = {
  id: "pin",
  latitude: 1,
  longitude: 110,
  coordinateSystem: "WGS84" as const,
  label: "IP",
  matched: true,
  selected: false,
  count: 1,
  entityId: "ip",
};
const config = {
  documentUrl: "https://maps.example.test/discovery-map/index.html",
  provider: { provider: "google" as const, key: "fixture", mapId: "fixture" },
};
const event = (data: object) => JSON.stringify({ version: 1, channel, ...data });
function setup() {
  const options = {
    channel,
    config,
    initialViewport: viewport,
    send: vi.fn(),
    onLoaded: vi.fn(),
    onError: vi.fn(),
    onViewport: vi.fn(),
    onActivate: vi.fn(),
  };
  return {
    ...options,
    session: createMapSession(options),
    commands: () => options.send.mock.calls.map(([raw]) => JSON.parse(raw)),
  };
}
it("queues the latest features until loaded and accepts only current marker taps", () => {
  const s = setup();
  s.session.setFeatures([feature]);
  s.session.receive(event({ type: "loaded" }));
  expect(s.send).not.toHaveBeenCalled();
  s.session.receive(event({ type: "ready" }));
  s.session.receive(event({ type: "ready" }));
  expect(s.commands()).toHaveLength(1);
  expect(s.commands()[0]).toMatchObject({ type: "initialize", sequence: 0 });
  s.session.receive(event({ type: "loaded" }));
  expect(s.commands()[1]).toMatchObject({ type: "features", features: [feature], sequence: 1 });
  s.session.receive(event({ type: "activate", id: "pin", sequence: 1 }));
  expect(s.onActivate).toHaveBeenCalledWith(feature);
  s.onActivate.mockClear();
  s.session.setFeatures([{ ...feature, entityId: "new-ip" }]);
  for (const data of [
    { type: "activate", id: "pin", sequence: 1 },
    { type: "activate", id: "wrong", sequence: 2 },
    { type: "activate", id: "pin", sequence: 2, channel: "wrong-channel-123456789" },
  ])
    s.session.receive(event(data));
  expect(s.onActivate).not.toHaveBeenCalled();
  s.session.receive(event({ type: "activate", id: "pin", sequence: 2 }));
  expect(s.onActivate).toHaveBeenCalledWith({ ...feature, entityId: "new-ip" });
});
it("deduplicates viewport changes and rejects wrong-region geometry", () => {
  const s = setup();
  s.session.receive(event({ type: "ready" }));
  for (const value of [
    viewport,
    { ...viewport, coordinateSystem: "GCJ02" },
    { ...viewport, north: -1 },
  ])
    s.session.receive(event({ type: "viewport", viewport: value }));
  expect(s.onViewport).not.toHaveBeenCalled();
  const next = { ...viewport, east: 130 };
  s.session.receive(event({ type: "viewport", viewport: next }));
  s.session.receive(event({ type: "viewport", viewport: next }));
  expect(s.onViewport).toHaveBeenCalledExactlyOnceWith(next);
});
it("stops commands and callbacks after error or disposal", () => {
  for (const error of [false, true]) {
    const s = setup();
    s.session.receive(event({ type: "ready" }));
    s.session.receive(event({ type: "loaded" }));
    if (error) s.session.receive(event({ type: "error", reason: "authentication" }));
    else s.session.destroy();
    s.send.mockClear();
    s.onLoaded.mockClear();
    s.session.zoom(1);
    s.session.focus(feature);
    s.session.setFeatures([feature]);
    s.session.receive(event({ type: "loaded" }));
    s.session.receive(event({ type: "viewport", viewport: { ...viewport, east: 125 } }));
    expect(s.send).not.toHaveBeenCalled();
    expect(s.onLoaded).not.toHaveBeenCalled();
    expect(s.onViewport).not.toHaveBeenCalled();
    expect(s.onError).toHaveBeenCalledTimes(error ? 1 : 0);
  }
});
it("validates hosted configuration without enabling missing or wrong-region providers", () => {
  expect(parseDiscoveryMapConfig(undefined, "global", true)).toBeNull();
  expect(parseDiscoveryMapConfig({ enabled: "false" }, "cn", true)).toBeNull();
  const raw = { enabled: "true", documentUrl: config.documentUrl, ...config.provider };
  expect(parseDiscoveryMapConfig(raw, "global", true)).toEqual(config);
  for (const patch of [
    { enabled: "TRUE" },
    { key: "" },
    { documentUrl: "file:///map.html" },
    { documentUrl: "https://user:pass@maps.example.test" },
    { documentUrl: "https://maps.example.test/?token=bad" },
    { documentUrl: "http://127.0.0.1:8080/map.html" },
  ])
    expect(() => parseDiscoveryMapConfig({ ...raw, ...patch }, "global", true)).toThrow();
  expect(() => parseDiscoveryMapConfig(raw, "cn", true)).toThrow();
  expect(
    parseDiscoveryMapConfig(
      { ...raw, documentUrl: "http://localhost:8080/map.html" },
      "global",
      false
    )
  ).not.toBeNull();
  expect(() =>
    parseDiscoveryMapConfig(
      {
        enabled: "true",
        documentUrl: config.documentUrl,
        provider: "gaode",
        key: "fixture",
        securityProxyPath: "//remote.test",
      },
      "cn",
      true
    )
  ).toThrow();
});
it("serializes native injection as data and limits attribution links to HTTPS provider hosts", () => {
  const raw = '</script><script>alert(1)</script>\u2028";alert(2);//';
  let received: unknown;
  new Function("window", injection(raw))({
    fizzDiscoveryMapReceive: (value: unknown) => {
      received = value;
    },
  });
  expect(received).toBe(raw);
  expect(injection(raw)).not.toContain("</script>");
  expect(safeMapAttributionUrl("https://maps.google.com/maps?q=Singapore")).toBe(true);
  for (const url of [
    "javascript:alert(1)",
    "https://maps.google.com.evil.test",
    "https://user@maps.google.com",
    "https://maps.google.com:8080",
    "fizzdragon://mine",
  ])
    expect(safeMapAttributionUrl(url)).toBe(false);
});
