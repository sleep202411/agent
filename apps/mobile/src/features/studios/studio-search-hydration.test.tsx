import { act, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { StudioSearchScreen } from "./studio-search-screen";
vi.mock("@/config", () => ({ isChinaRegion: false }));
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
      <button onClick={() => onSelect("creator")}>Select marker</button>
    </div>
  ),
}));
const h = vi.hoisted(() => ({
  maps: false,
  push: vi.fn(),
  params: {} as Record<string, string>,
  search: vi.fn(),
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ setParams: vi.fn(), push: h.push }),
  useLocalSearchParams: () => h.params,
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ status: "anonymous", generation: 1 }),
  useAuthGate: () => ({ requireAuth: vi.fn() }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => 1 }));
vi.mock("@/lib/api-client", () => ({ api: {} }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => true }));
vi.mock("@/i18n", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en-US",
}));
vi.mock("./use-studio-search", () => ({ useStudioSearch: h.search }));
vi.mock("../discovery-assistant/discovery-assistant-panel", () => ({
  DiscoveryAssistantPanel: () => null,
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
  h.maps = false;
  h.params = {};
  vi.resetAllMocks();
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
    const html = renderToString(<StudioSearchScreen />);
    expect(h.search).not.toHaveBeenCalled();
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    h.params = invalid ? { remote: "invalid" } : { remote: "1", text: "Film", selected: "studio" };
    const errors: unknown[] = [];
    let root!: ReturnType<typeof hydrateRoot>;
    try {
      await act(async () => {
        root = hydrateRoot(host, <StudioSearchScreen />, {
          onRecoverableError: (e) => errors.push(e),
        });
      });
      expect(errors).toEqual([]);
      expect(h.search).toHaveBeenCalled();
      expect(h.search.mock.calls.every((call) => call[3] === !invalid)).toBe(true);
      if (invalid) {
        expect(host.textContent).toContain("studioDiscovery.invalidLink");
        expect(host.textContent).not.toContain("studioDiscovery.empty");
      } else {
        expect(h.search.mock.lastCall?.[1]).toMatchObject({ remoteOnly: true, text: "Film" });
        expect(h.search.mock.lastCall?.[4]).toBe("studio");
      }
    } finally {
      await act(async () => root?.unmount());
      host.remove();
    }
  }
);

it("scopes Studio maps only when open and opens the selected creator", async () => {
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
    await act(async () => root.render(<StudioSearchScreen />));
    expect(h.search.mock.lastCall![5]).toBeNull();
    await click("discoveryMap.show");
    await click("Move map");
    expect(h.search.mock.lastCall![5]).toEqual({
      coordinateSystem: "WGS84",
      west: 100,
      east: 120,
      south: 0,
      north: 20,
    });
    await click("Select marker");
    expect(h.push).toHaveBeenCalledWith("/creator/creator");
    await click("discoveryMap.hide");
    expect(h.search.mock.lastCall![5]).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
