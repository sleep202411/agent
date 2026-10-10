import { act, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { GpsSearchScreen } from "./search-screen";
vi.mock("../discovery-map/environment", () => ({
  readDiscoveryMapConfig: () =>
    h.maps
      ? {
          documentUrl: "https://maps.example.test/map.html",
          provider: { provider: "google", key: "fixture", mapId: "fixture" },
        }
      : null,
}));
vi.mock("../discovery-map/map-panel", () => ({
  MapPanel: ({
    onViewport,
    onSelect,
  }: {
    onViewport(value: object): void;
    onSelect(id: string): void;
  }) => (
    <div>
      <button
        onClick={() =>
          onViewport({ coordinateSystem: "WGS84", west: 100, east: 120, south: 0, north: 20 })
        }
      >
        Move map
      </button>
      <button onClick={() => onSelect("ip")}>Select marker</button>
    </div>
  ),
}));
const h = vi.hoisted(() => ({
  maps: false,
  params: {} as Record<string, string>,
  search: vi.fn(),
  get: vi.fn(),
  gate: vi.fn(),
  push: vi.fn(),
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ setParams: vi.fn(), push: h.push }),
  useLocalSearchParams: () => h.params,
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ status: "anonymous", generation: 1 }),
  useAuthGate: () => ({ requireAuth: h.gate }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => 1 }));
vi.mock("@/lib/api-client", () => ({ api: { get: h.get } }));
vi.mock("@/config", () => ({ isChinaRegion: false }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => true }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("./use-gps-search", () => ({ useGpsSearch: h.search }));
vi.mock("expo-modules-core", () => ({
  uuid: { v4: () => "11111111-1111-4111-8111-111111111111" },
}));
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({
    children,
    accessibilityRole,
  }: {
    children: ReactNode;
    accessibilityRole?: string;
  }) => <span role={accessibilityRole}>{children}</span>,
}));
vi.mock("react-native", () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  FlatList: ({
    ListHeaderComponent,
    ListEmptyComponent,
    ListFooterComponent,
  }: {
    ListHeaderComponent: ReactNode;
    ListEmptyComponent: ReactNode;
    ListFooterComponent: ReactNode;
  }) => (
    <div>
      {ListHeaderComponent}
      {ListEmptyComponent}
      {ListFooterComponent}
    </div>
  ),
  Pressable: ({
    children,
    onPress,
    disabled,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  TextInput: ({ value, onChangeText }: { value: string; onChangeText: (s: string) => void }) => (
    <input value={value} onChange={(e) => onChangeText(e.target.value)} />
  ),
  Switch: ({ value, onValueChange }: { value: boolean; onValueChange: (v: boolean) => void }) => (
    <input type="checkbox" checked={value} onChange={(e) => onValueChange(e.target.checked)} />
  ),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => {
  h.params = {};
  h.maps = false;
  vi.resetAllMocks();
  h.get.mockResolvedValue({ items: [] });
  h.search.mockReturnValue({
    items: [],
    loading: false,
    hasMore: false,
    refresh: vi.fn(),
    retry: vi.fn(),
  });
});
it.each([false, true])(
  "hydrates static markup before applying incoming filters (invalid=%s)",
  async (invalid) => {
    const html = renderToString(<GpsSearchScreen />);
    expect(h.search).not.toHaveBeenCalled();
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    h.params = invalid
      ? { selected: "invalid" }
      : { from: "-100", to: "0", selected: "11111111-1111-4111-8111-111111111111" };
    const errors: unknown[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    try {
      await act(async () => {
        root = hydrateRoot(host, <GpsSearchScreen />, {
          onRecoverableError: (e) => errors.push(e),
        });
      });
      expect(errors).toEqual([]);
      expect(h.search).toHaveBeenCalled();
      expect(h.search.mock.calls.every((call) => call[3] === !invalid)).toBe(true);
      if (invalid) {
        expect(host.textContent).toContain("contentGpsDiscovery.invalidLink");
        expect(host.textContent).not.toContain("contentGpsDiscovery.empty");
      } else {
        expect(h.search.mock.lastCall?.[1]).toMatchObject({ era: { startYear: -100, endYear: 0 } });
        expect(h.search.mock.lastCall?.[4].selectedIpId).toBe(
          "11111111-1111-4111-8111-111111111111"
        );
        expect(h.get).not.toHaveBeenCalled();
        await act(async () =>
          Array.from(host.querySelectorAll("button"))
            .find((b) => b.textContent === "contentGpsDiscovery.conditions")!
            .click()
        );
        expect(h.get).toHaveBeenCalledWith(
          "/ip-commerce/taxonomy",
          expect.objectContaining({
            credentials: "omit",
            retry: false,
            params: { type: "genre", locale: "en-US" },
          })
        );
      }
    } finally {
      await act(async () => root?.unmount());
      host.remove();
    }
  }
);

it("selected IP bookmark opens the auth sheet for guests without a collection write", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  h.params = { selected: id, from: "0", to: "100" };
  h.search.mockReturnValue({
    items: [],
    page: {
      selected: {
        id,
        title: "Story",
        summary: "",
        matched: true,
        locations: [],
        eras: [],
        episode: null,
      },
      places: [],
      matchedCount: 1,
      accessibleCount: 1,
    },
    loading: false,
    hasMore: false,
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<GpsSearchScreen />));
    const button = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent === "contentGpsDiscovery.bookmark"
    )!;
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
    expect(h.gate).toHaveBeenCalledTimes(1);
    const play = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent === "contentGpsDiscovery.play"
    )!;
    await act(async () => play.click());
    expect(h.push).toHaveBeenCalledWith(`/ip/${id}?watch=1`);
    expect(h.get).not.toHaveBeenCalled();
    expect(h.params).toEqual({ selected: id, from: "0", to: "100" });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("loads public genre labels through filters while the assistant remains deferred", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<GpsSearchScreen />));
    expect(h.get).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("discoveryAssistant.title");
    await act(async () =>
      Array.from(host.querySelectorAll("button"))
        .find((b) => b.textContent === "contentGpsDiscovery.conditions")!
        .click()
    );
    expect(h.get).toHaveBeenCalledWith(
      "/ip-commerce/taxonomy",
      expect.objectContaining({ params: { type: "genre", locale: "en-US" }, credentials: "omit" })
    );
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("keeps the map collapsed, scopes search on movement and opens selected IPs", async () => {
  h.maps = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const click = (label: string) =>
    act(async () =>
      Array.from(host.querySelectorAll("button"))
        .find((b) => b.textContent === label)!
        .click()
    );
  try {
    await act(async () => root.render(<GpsSearchScreen />));
    expect(host.textContent).not.toContain("Move map");
    expect(h.search.mock.lastCall![4].viewport).toBeUndefined();
    await click("discoveryMap.show");
    await click("Move map");
    expect(h.search.mock.lastCall![4].viewport).toEqual({
      coordinateSystem: "WGS84",
      west: 100,
      east: 120,
      south: 0,
      north: 20,
    });
    await click("Select marker");
    expect(h.push).toHaveBeenCalledWith("/ip/ip");
    await click("discoveryMap.hide");
    expect(h.search.mock.lastCall![4].viewport).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
