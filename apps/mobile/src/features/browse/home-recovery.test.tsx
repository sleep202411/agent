import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import IpDiscoveryScreen from "@/app/(tabs)/index";

const h = vi.hoisted(() => ({
  feed: vi.fn(),
  tags: vi.fn(),
  locale: "en-US",
  t: (key: string) => key,
}));
type ListProps = {
  data: { id: string }[];
  onEndReached: () => void;
  ListHeaderComponent: ReactNode;
  refreshControl: ReactNode;
  ListFooterComponent: ReactNode;
};
let list: ListProps;
vi.mock("expo-router", () => ({
  router: { push: vi.fn() },
  useLocalSearchParams: () => ({}),
  Stack: { Screen: () => null },
}));
vi.mock("expo-symbols", () => ({ SymbolView: () => null }));
vi.mock("react-native-reanimated-carousel", () => ({ default: () => null }));
vi.mock("@/data/interactive-film-api", () => ({
  listPublishedInteractiveFilms: () => Promise.resolve([]),
}));
vi.mock("@/features/experience-player", () => ({ navigateToPlay: vi.fn() }));
// Checkout recovery has its own lifecycle tests; these tests exercise feed requests.
vi.mock("@/features/experience-player/hooks/use-story-top-up-recovery", () => ({
  useStoryTopUpRecovery: () => null,
}));
vi.mock("@/hooks/use-agent-header-action", () => ({ useAgentHeaderAction: () => null }));
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("@/auth", () => ({ useAuthGate: () => ({ isAuthenticated: true, openLogin: vi.fn() }) }));
vi.mock("@/data/browse-refresh", () => ({ useBrowseVersion: () => 0 }));
vi.mock("@/lib/navigation", () => ({ toHref: (v: string) => v }));
vi.mock("@/components/ip-grid", () => ({ IpGridCard: () => null }));
vi.mock("@/lib/avatar", () => ({ dicebearAvatarUrl: () => "" }));
vi.mock("expo-web-browser", () => ({ openBrowserAsync: vi.fn() }));
vi.mock("@/config", () => ({ webBaseUrl: "http://localhost" }));
vi.mock("@/data/browse-service", () => ({
  getIpDiscovery: () =>
    Promise.resolve({ genres: [{ code: "genre", label: "Genre" }], featured: [], trending: [] }),
  getIpCatalogPage: h.feed,
  getCrewFeedPage: h.feed,
  getCreators: h.feed,
  getNewsFeed: h.feed,
  getNewsTags: h.tags,
  NEWS_PAGE_SIZE: 2,
}));
vi.mock("@/i18n", () => ({
  getLocale: () => h.locale,
  useLocale: () => h.locale,
  useTranslations: () => h.t,
}));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("react-native", () => ({
  ScrollView: () => null,
  useWindowDimensions: () => ({ width: 400 }),
  StyleSheet: { create: (v: unknown) => v },
  Platform: { OS: "web", select: (v: Record<string, unknown>) => v.web ?? v.default },
  View: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Pressable: () => null,
  RefreshControl: ({ onRefresh, refreshing }: { onRefresh: () => void; refreshing: boolean }) => (
    <button onClick={onRefresh} data-refresh={refreshing}>
      refresh
    </button>
  ),
  FlatList: (props: ListProps) => {
    list = props;
    return (
      <div>
        {props.ListHeaderComponent}
        {props.refreshControl}
        {props.ListFooterComponent}
      </div>
    );
  },
}));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/themed-view", () => ({
  ThemedView: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui", () => ({
  ChipRail: ({ onChange }: { onChange: (index: number) => void }) => (
    <button onClick={() => onChange(1)}>tag</button>
  ),
  EmptyState: ({
    detail,
    action,
  }: {
    detail?: string;
    action?: { label: string; onPress: () => void };
  }) => (
    <div>
      {detail}
      {action ? <button onClick={action.onPress}>{action.label}</button> : null}
    </div>
  ),
  ListFooter: () => <span>paging</span>,
  PosterImage: () => null,
  ScreenHeader: () => null,
  SectionHeader: () => null,
  Skeleton: () => null,
  Tag: () => null,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const page = (...ids: string[]) => ({
  items: ids.map((id) => ({ id })),
  nextCursor: "next",
  genres: [{ code: "genre", label: "Genre" }],
  regions: [],
  typeTags: [],
});
function deferred() {
  let resolve!: (value: ReturnType<typeof page>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ReturnType<typeof page>>((r, fail) => {
    resolve = r;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const click = (label: string) =>
  host.querySelectorAll("button").forEach((b) => {
    if (b.textContent === label) b.click();
  });

beforeEach(() => {
  h.feed.mockReset();
  h.feed.mockResolvedValue(page("a", "b"));
  h.locale = h.locale === "en-US" ? "zh-CN" : "en-US";
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
const render = () => act(async () => root.render(<IpDiscoveryScreen />));
it("keeps a selected genre when an older full refresh finishes", async () => {
  await render();
  const refresh = deferred();
  h.feed.mockReturnValueOnce(refresh.promise);
  await act(async () => click("refresh"));
  h.feed.mockResolvedValueOnce(page("genre"));
  await act(async () => click("tag"));
  await act(async () => refresh.resolve(page("old")));
  expect(list.data.map((x) => x.id)).toEqual(["genre"]);
});
it("ignores pagination belonging to the previous genre", async () => {
  await render();
  const old = deferred();
  h.feed.mockReturnValueOnce(old.promise);
  await act(async () => list.onEndReached());
  h.feed.mockResolvedValueOnce(page("genre"));
  await act(async () => click("tag"));
  await act(async () => old.resolve(page("old")));
  expect(list.data.map((x) => x.id)).toEqual(["genre"]);
});
it("blocks pagination while the full refresh is pending", async () => {
  await render();
  const refresh = deferred();
  h.feed.mockReturnValueOnce(refresh.promise);
  await act(async () => click("refresh"));
  await act(async () => list.onEndReached());
  expect(h.feed).toHaveBeenCalledTimes(2);
  await act(async () => refresh.resolve(page("new")));
});

it("does not replace the restorable snapshot after the screen leaves", async () => {
  await render();
  const old = deferred();
  h.feed.mockReturnValueOnce(old.promise);
  await act(async () => click("refresh"));
  await act(async () => root.render(null));
  await act(async () => old.resolve(page("abandoned")));
  const pending = deferred();
  h.feed.mockReturnValueOnce(pending.promise);
  await render();
  expect(list.data.map((x) => x.id)).toEqual(["a", "b"]);
  await act(async () => pending.resolve(page("fresh")));
});

it("keeps failed pagination retryable and deduplicates incoming rows", async () => {
  await render();
  h.feed.mockRejectedValueOnce(new Error("offline"));
  await act(async () => list.onEndReached());
  expect(list.data.map((x) => x.id)).toEqual(["a", "b"]);
  expect(host.textContent).toContain("offline");
  await act(async () => list.onEndReached());
  expect(h.feed).toHaveBeenCalledTimes(2);
  h.feed.mockResolvedValueOnce(page("c", "c"));
  await act(async () => click("common.retry"));
  expect(h.feed.mock.calls[1]).toEqual(h.feed.mock.calls[2]);
  expect(list.data.map((x) => x.id)).toEqual(["a", "b", "c"]);
});

it("does not page a retained grid under a failed replacement genre", async () => {
  await render();
  h.feed.mockRejectedValueOnce(new Error("offline"));
  await act(async () => click("tag"));
  await act(async () => list.onEndReached());
  expect(h.feed).toHaveBeenCalledTimes(2);
  expect(list.data.map((x) => x.id)).toEqual(["a", "b"]);
  expect(host.textContent).toContain("offline");
  h.feed.mockResolvedValueOnce(page("genre"));
  await act(async () => click("common.retry"));
  expect(host.textContent).not.toContain("offline");
  h.feed.mockResolvedValueOnce(page("next"));
  await act(async () => list.onEndReached());
  expect(list.data.map((x) => x.id)).toEqual(["genre", "next"]);
});

it("shows a failed refresh without hiding loaded results and retries the selected catalog", async () => {
  await render();
  h.feed.mockRejectedValueOnce(new Error("refresh unavailable"));
  await act(async () => click("refresh"));
  expect(host.textContent).toContain("refresh unavailable");
  expect(list.data.map((x) => x.id)).toEqual(["a", "b"]);
  h.feed.mockResolvedValueOnce(page("fresh"));
  await act(async () => click("common.retry"));
  expect(host.textContent).not.toContain("refresh unavailable");
  expect(list.data.map((x) => x.id)).toEqual(["fresh"]);
});

it("ignores a failed old refresh after a successful genre selection", async () => {
  await render();
  const old = deferred();
  h.feed.mockReturnValueOnce(old.promise);
  await act(async () => click("refresh"));
  h.feed.mockResolvedValueOnce(page("genre"));
  await act(async () => click("tag"));
  await act(async () => old.reject(new Error("obsolete failure")));
  expect(host.textContent).not.toContain("obsolete failure");
  expect(list.data.map((x) => x.id)).toEqual(["genre"]);
});
