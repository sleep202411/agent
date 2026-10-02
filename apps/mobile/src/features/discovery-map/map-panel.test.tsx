import { act, useImperativeHandle, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MapPanel } from "./map-panel";
import type { MapFrameProps } from "./frame-types";
const h = vi.hoisted(() => ({ send: vi.fn(), props: null as MapFrameProps | null, serial: 0 }));
vi.mock("./map-frame", () => ({
  MapFrame: (props: MapFrameProps) => {
    h.props = props;
    useImperativeHandle(props.ref, () => ({ send: h.send }), []);
    return <div data-testid="map" />;
  },
}));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => `map-panel-fixture-token-${++h.serial}` },
}));
vi.mock("@/i18n", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress(): void;
    disabled: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const config = {
  documentUrl: "https://maps.example.test/map.html",
  provider: { provider: "google" as const, key: "fixture", mapId: "fixture" },
};
const viewport = { coordinateSystem: "WGS84" as const, west: 100, east: 120, south: 0, north: 20 };
const feature = {
  id: "pin",
  latitude: 1,
  longitude: 110,
  coordinateSystem: "WGS84" as const,
  label: "IP",
  count: 1,
  selected: false,
  matched: true,
  entityId: "ip",
};
const onSelect = vi.fn(),
  onViewport = vi.fn();
const render = (features = [feature]) =>
  act(async () =>
    root.render(
      <MapPanel
        config={config}
        viewport={viewport}
        features={features}
        onSelect={onSelect}
        onViewport={onViewport}
      />
    )
  );
const emit = (value: object, props = h.props!) =>
  act(async () => props.onMessage({ version: 1, channel: props.channel, ...value }));
beforeEach(() => {
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
it("waits for the map, enables controls and ignores obsolete markers", async () => {
  await render();
  expect(host.querySelector("button")!.disabled).toBe(true);
  await emit({ type: "ready" });
  await emit({ type: "loaded" });
  expect(host.textContent).not.toContain("loading");
  expect(host.querySelector("button")!.disabled).toBe(false);
  const command = JSON.parse(h.send.mock.lastCall![0]);
  await emit({ type: "activate", id: "pin", sequence: command.sequence });
  expect(onSelect).toHaveBeenCalledWith("ip");
  onSelect.mockClear();
  await render([]);
  await emit({ type: "activate", id: "pin", sequence: command.sequence });
  expect(onSelect).not.toHaveBeenCalled();
});
it("shows failure and retries with a fresh channel; old messages cannot affect the new map", async () => {
  await render();
  const old = h.props!;
  await act(async () => old.onError());
  expect(host.textContent).toContain("discoveryMap.error");
  expect(host.querySelector('[data-testid="map"]')).toBeNull();
  await act(async () => host.querySelector("button")!.click());
  expect(h.props!.channel).not.toBe(old.channel);
  await emit({ type: "error", reason: "authentication" }, old);
  expect(host.textContent).not.toContain("discoveryMap.error");
  await emit({ type: "ready" });
  await emit({ type: "loaded" });
  expect(host.textContent).not.toContain("loading");
});
it("bounds an unresponsive document load and does not automatically retry", async () => {
  vi.useFakeTimers();
  await render();
  const old = h.props;
  await act(async () => vi.advanceTimersByTime(45000));
  expect(host.textContent).toContain("discoveryMap.error");
  expect(h.send).not.toHaveBeenCalled();
  expect(h.props).toBe(old);
});
