import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import CrewsScreen from "@/app/(tabs)/crews";
import CreatorsScreen from "@/app/(tabs)/creators";

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
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("@/auth", () => ({ useAuthGate: () => ({ isAuthenticated: true, openLogin: vi.fn() }) }));
vi.mock("@/data/browse-refresh", () => ({ useBrowseVersion: () => 0 }));
vi.mock("@/lib/navigation", () => ({ toHref: (v: string) => v }));
vi.mock("@/lib/avatar", () => ({ dicebearAvatarUrl: () => "" }));
vi.mock("expo-web-browser", () => ({ openBrowserAsync: vi.fn() }));
vi.mock("@/config", () => ({ webBaseUrl: "http://localhost" }));
vi.mock("@/data/browse-service", () => ({
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
for (const [name, Screen] of [
  ["Crew", CrewsScreen],
  ["creator", CreatorsScreen],
] as const) {
  it(`${name}: ignores an old page after refresh replaces the list`, async () => {
    await act(async () => root.render(<Screen />));
    const old = deferred();
    h.feed.mockReturnValueOnce(old.promise);
    await act(async () => list.onEndReached());
    h.feed.mockResolvedValueOnce(page("new"));
    await act(async () => click("refresh"));
    await act(async () => old.resolve(page("old")));
    expect(list.data.map((x) => x.id)).toEqual(["new"]);
  });
  it(`${name}: blocks append during refresh and deduplicates returned records`, async () => {
    await act(async () => root.render(<Screen />));
    const refresh = deferred();
    h.feed.mockReturnValueOnce(refresh.promise);
    await act(async () => click("refresh"));
    await act(async () => list.onEndReached());
    expect(h.feed).toHaveBeenCalledTimes(2);
    await act(async () => refresh.resolve(page("new")));
    h.feed.mockResolvedValueOnce(page("x", "x"));
    await act(async () => list.onEndReached());
    expect(list.data.map((x) => x.id)).toEqual(["new", "x"]);
  });
}

it("creator: advances the server offset by received rows and stops on an empty page", async () => {
  await act(async () => root.render(<CreatorsScreen />));
  h.feed.mockResolvedValueOnce(page("c", "c"));
  await act(async () => list.onEndReached());
  h.feed.mockResolvedValueOnce(page());
  await act(async () => list.onEndReached());
  expect(h.feed.mock.calls[2][1]).toBe(4);
  await act(async () => list.onEndReached());
  expect(h.feed).toHaveBeenCalledTimes(3);
});

for (const [name, Screen] of [
  ["Crew", CrewsScreen],
  ["creator", CreatorsScreen],
] as const) {
  it(`${name}: keeps a rejected page retryable`, async () => {
    await act(async () => root.render(<Screen />));
    h.feed.mockRejectedValueOnce(new Error("offline"));
    await act(async () => list.onEndReached());
    expect(list.data.map((x) => x.id)).toEqual(["a", "b"]);
    h.feed.mockResolvedValueOnce(page("c"));
    await act(async () => list.onEndReached());
    expect(h.feed.mock.calls[1]).toEqual(h.feed.mock.calls[2]);
    expect(list.data.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
}
