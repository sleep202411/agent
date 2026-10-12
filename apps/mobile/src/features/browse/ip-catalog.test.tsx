import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import AllIpsScreen from "@/app/ips";

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
vi.mock("@/features/ip-community/video-channel-picker", () => ({ VideoChannelPicker: () => null }));
vi.mock("expo-router", () => ({
  router: { push: vi.fn() },
  useLocalSearchParams: () => ({}),
  Stack: { Screen: () => null },
}));
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("@/auth", () => ({ useAuthGate: () => ({ isAuthenticated: true, openLogin: vi.fn() }) }));
vi.mock("@/data/browse-refresh", () => ({ useBrowseVersion: () => 0 }));
vi.mock("@/lib/navigation", () => ({ toHref: (v: string) => v }));
vi.mock("@/components/ip-grid", () => ({ IpGridCard: () => null }));
vi.mock("@/lib/avatar", () => ({ dicebearAvatarUrl: () => "" }));
vi.mock("expo-web-browser", () => ({ openBrowserAsync: vi.fn() }));
vi.mock("@/config", () => ({ webBaseUrl: "http://localhost" }));
vi.mock("@/data/browse-service", () => ({
  getIpCatalogPage: h.feed,
  getCrewFeedPage: h.feed,
  getCreators: h.feed,
  getNewsFeed: h.feed,
  getNewsTags: h.tags,
  NEWS_PAGE_SIZE: 2,
}));
vi.mock("@/i18n", () => ({ useLocale: () => h.locale, useTranslations: () => h.t }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock("react-native", () => ({
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
        {props.data.map((item) => (
          <span key={item.id}>{item.id}</span>
        ))}
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
    detail: string;
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
  const promise = new Promise<ReturnType<typeof page>>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
const click = (label: string) =>
  host.querySelectorAll("button").forEach((b) => {
    if (b.textContent === label) b.click();
  });

beforeEach(() => {
  h.feed.mockReset();
  h.feed.mockResolvedValue(page("a", "b"));
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
const render = () => act(async () => root.render(<AllIpsScreen />));
it("ignores old pagination after a filter replaces the catalog", async () => {
  await render();
  const old = deferred();
  h.feed.mockReturnValueOnce(old.promise);
  await act(async () => list.onEndReached());
  h.feed.mockResolvedValueOnce(page("new"));
  await act(async () => click("tag"));
  await act(async () => old.resolve(page("old")));
  expect(list.data.map((x) => x.id)).toEqual(["new"]);
});
it("does not fetch an old cursor during a refresh", async () => {
  await render();
  const refresh = deferred();
  h.feed.mockReturnValueOnce(refresh.promise);
  await act(async () => click("refresh"));
  await act(async () => list.onEndReached());
  expect(h.feed).toHaveBeenCalledTimes(2);
  await act(async () => refresh.resolve(page("new")));
});
it("deduplicates within a new page", async () => {
  await render();
  h.feed.mockResolvedValueOnce(page("c", "c"));
  await act(async () => list.onEndReached());
  expect(list.data.map((x) => x.id)).toEqual(["a", "b", "c"]);
});

it("does not combine a retained cursor with a failed replacement filter", async () => {
  await render();
  h.feed.mockRejectedValueOnce(new Error("offline"));
  await act(async () => click("tag"));
  await act(async () => list.onEndReached());
  expect(h.feed).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("offline");
  expect(host.querySelectorAll("span")).toHaveLength(0);
  h.feed.mockResolvedValueOnce(page("new"));
  await act(async () => click("common.retry"));
  h.feed.mockResolvedValueOnce(page("next"));
  await act(async () => list.onEndReached());
  expect(list.data.map((x) => x.id)).toEqual(["new", "next"]);
});

it("retries a failed page using the same filter and cursor", async () => {
  await render();
  h.feed.mockRejectedValueOnce(new Error("offline"));
  await act(async () => list.onEndReached());
  expect(list.data.map((x) => x.id)).toEqual(["a", "b"]);
  h.feed.mockResolvedValueOnce(page("next"));
  expect(host.textContent).toContain("offline");
  await act(async () => list.onEndReached());
  expect(h.feed).toHaveBeenCalledTimes(2);
  await act(async () => click("common.retry"));
  expect(h.feed.mock.calls[1]).toEqual(h.feed.mock.calls[2]);
  expect(list.data.map((x) => x.id)).toEqual(["a", "b", "next"]);
});

it("offers a retry after an initial failure", async () => {
  h.feed.mockRejectedValueOnce(new Error("Catalog unavailable"));
  await render();
  expect(host.textContent).toContain("Catalog unavailable");
  h.feed.mockResolvedValueOnce(page("recovered"));
  await act(async () => click("common.retry"));
  expect(list.data.map((x) => x.id)).toEqual(["recovered"]);
  expect(host.textContent).not.toContain("Catalog unavailable");
});

it("preserves current results on refresh failure and exposes a retry", async () => {
  await render();
  h.feed.mockRejectedValueOnce(new Error("Refresh unavailable"));
  await act(async () => click("refresh"));
  expect(list.data.map((x) => x.id)).toEqual(["a", "b"]);
  expect(host.textContent).toContain("Refresh unavailable");
  h.feed.mockResolvedValueOnce(page("fresh"));
  await act(async () => click("common.retry"));
  expect(list.data.map((x) => x.id)).toEqual(["fresh"]);
  expect(host.textContent).not.toContain("Refresh unavailable");
});

it("does not show a late pagination failure on a replacement filter", async () => {
  await render();
  let reject!: (error: Error) => void;
  h.feed.mockReturnValueOnce(
    new Promise((_, fail) => {
      reject = fail;
    })
  );
  await act(async () => list.onEndReached());
  h.feed.mockResolvedValueOnce(page("filtered"));
  await act(async () => click("tag"));
  await act(async () => reject(new Error("Stale failure")));
  expect(list.data.map((x) => x.id)).toEqual(["filtered"]);
  expect(host.textContent).not.toContain("Stale failure");
});

it("hides previous results while a replacement filter is loading", async () => {
  await render();
  const pending = deferred();
  h.feed.mockReturnValueOnce(pending.promise);
  await act(async () => click("tag"));
  expect(host.querySelectorAll("span")).toHaveLength(0);
  await act(async () => pending.resolve(page("filtered")));
  expect(list.data.map((x) => x.id)).toEqual(["filtered"]);
});
