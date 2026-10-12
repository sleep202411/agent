import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchCreators, searchCreators } from "@/data/creator-api";
import CreatorsScreen from "@/app/(tabs)/creators";

const h = vi.hoisted(() => ({
  feed: vi.fn(),
  search: vi.fn(),
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
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("@/auth", () => ({ useAuthGate: () => ({ isAuthenticated: true, openLogin: vi.fn() }) }));
vi.mock("@/data/browse-refresh", () => ({ useBrowseVersion: () => 0 }));
vi.mock("@/lib/navigation", () => ({ toHref: (v: string) => v }));
vi.mock("@/lib/avatar", () => ({ dicebearAvatarUrl: () => "" }));
vi.mock("expo-web-browser", () => ({ openBrowserAsync: vi.fn() }));
vi.mock("@/config", () => ({
  webBaseUrl: "http://localhost",
  appEnv: {
    assets: {
      staticBaseUrl: "https://example.com",
      userBaseUrl: "https://example.com",
      bannerBaseUrl: "https://example.com",
    },
  },
  resolveAssetUrl: (p: string) => p,
}));
vi.mock("@/lib/api-client", () => ({ api: { get: h.feed, post: h.search } }));
vi.mock("@/data/browse-service", () => ({
  getCrewFeedPage: h.feed,
  getCreators: (limit?: number, offset?: number, query?: string) =>
    query ? searchCreators(query, limit, offset) : fetchCreators(limit, offset),
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
  TextInput: ({
    value,
    onChangeText,
    onSubmitEditing,
  }: {
    value: string;
    onChangeText: (v: string) => void;
    onSubmitEditing: () => void;
  }) => (
    <input
      value={value}
      onChange={(e) => onChangeText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSubmitEditing();
      }}
    />
  ),
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => (
    <button onClick={onPress}>{children}</button>
  ),
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
vi.mock("@/components/themed-view", () => ({ ThemedView: () => null }));
vi.mock("@/components/ui", () => ({
  ChipRail: ({ onChange }: { onChange: (index: number) => void }) => (
    <button onClick={() => onChange(1)}>tag</button>
  ),
  EmptyState: () => null,
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
  creators: ids.map((id) => ({ id })),
  nextCursor: "next",
  total: 10,
  requiresLogin: false,
});
const click = (label: string) =>
  host.querySelectorAll("button").forEach((b) => {
    if (b.textContent === label) b.click();
  });

beforeEach(() => {
  h.feed.mockReset();
  h.search.mockReset();
  h.search.mockResolvedValue({ data: [{ id: "artist", nickName: "Artist" }], sum: 51 });
  h.feed.mockResolvedValue(page("a", "b"));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
it("retains the loaded directory when the transport rejects a refresh", async () => {
  await act(async () => root.render(<CreatorsScreen />));
  h.feed.mockRejectedValueOnce(new Error("offline"));
  await act(async () => click("refresh"));
  expect(list.data.map((x) => x.id)).toEqual(["a", "b"]);
});
it("retries the same offset after a transport page failure", async () => {
  await act(async () => root.render(<CreatorsScreen />));
  h.feed.mockRejectedValueOnce(new Error("offline"));
  await act(async () => list.onEndReached());
  h.feed.mockResolvedValueOnce(page("c"));
  await act(async () => list.onEndReached());
  expect(h.feed).toHaveBeenCalledTimes(3);
  expect(h.feed.mock.calls[1]).toEqual(h.feed.mock.calls[2]);
  expect(list.data.map((x) => x.id)).toEqual(["a", "b", "c"]);
});
it("still treats a successful empty page as the end of the directory", async () => {
  await act(async () => root.render(<CreatorsScreen />));
  h.feed.mockResolvedValueOnce(page());
  await act(async () => list.onEndReached());
  await act(async () => list.onEndReached());
  expect(h.feed).toHaveBeenCalledTimes(2);
  expect(list.data.map((x) => x.id)).toEqual(["a", "b"]);
});

const searchFor = async (query: string) => {
  await act(async () => {
    const el = host.querySelector("input")!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, query);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => click("creators.searchAction"));
};
it("searches the server and paginates by page size rather than mapped card count", async () => {
  await act(async () => root.render(<CreatorsScreen />));
  await searchFor(" Artist ");
  expect(h.search.mock.calls[0][1].params).toEqual({ key: "Artist", page: 1, pageSize: 50 });
  expect(list.data.map((x) => x.id)).toEqual(["artist"]);
  await act(async () => list.onEndReached());
  expect(h.search.mock.calls[1][1].params.page).toBe(2);
});
it("discards a previous query's late result and clearing returns to public directory", async () => {
  let finish!: (v: unknown) => void;
  h.search.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await act(async () => root.render(<CreatorsScreen />));
  await searchFor("old");
  await searchFor("new");
  await act(async () => finish({ data: [{ id: "stale" }], sum: 1 }));
  expect(list.data.map((x) => x.id)).toEqual(["artist"]);
  await searchFor("");
  expect(list.data.map((x) => x.id)).toEqual(["a", "b"]);
});
it("retries a failed search without showing unrelated directory rows", async () => {
  h.search.mockRejectedValueOnce(new Error("Search unavailable"));
  await act(async () => root.render(<CreatorsScreen />));
  await searchFor("Artist");
  await act(async () => click("creators.searchAction"));
  expect(h.search).toHaveBeenCalledTimes(2);
  expect(list.data.map((x) => x.id)).toEqual(["artist"]);
});
