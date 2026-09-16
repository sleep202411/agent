import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import NewsScreen from "@/app/(tabs)/news";

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
vi.mock("expo-web-browser", () => ({ openBrowserAsync: vi.fn() }));
vi.mock("@/config", () => ({ webBaseUrl: "http://localhost" }));
vi.mock("@/data/browse-service", () => ({
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
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const page = (...ids: string[]) => ({ articles: ids.map((id) => ({ id })), total: 6 });
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
  h.tags.mockReset();
  h.locale = "en-US";
  h.feed.mockResolvedValue(page("a", "b"));
  h.tags.mockResolvedValue([{ id: "tag", label: "Tag" }]);
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
const render = () => act(async () => root.render(<NewsScreen />));

it("does not append an old page while a first-page refresh is pending", async () => {
  await render();
  const refresh = deferred();
  h.feed.mockReturnValueOnce(refresh.promise);
  await act(async () => click("refresh"));
  await act(async () => list.onEndReached());
  expect(h.feed).toHaveBeenCalledTimes(2);
  await act(async () => refresh.resolve(page("c", "d")));
  expect(list.data.map((a) => a.id)).toEqual(["c", "d"]);
});

it("lets a replacement tag page load while an abandoned pagination request is unresolved", async () => {
  await render();
  const old = deferred();
  h.feed.mockReturnValueOnce(old.promise);
  await act(async () => list.onEndReached());
  h.feed.mockResolvedValueOnce(page("t1", "t2"));
  await act(async () => click("tag"));
  h.feed.mockResolvedValueOnce(page("t3", "t4"));
  await act(async () => list.onEndReached());
  expect(h.feed).toHaveBeenCalledTimes(4);
  expect(list.data.map((a) => a.id)).toEqual(["t1", "t2", "t3", "t4"]);
  await act(async () => old.resolve(page("c", "d")));
  expect(list.data.map((a) => a.id)).toEqual(["t1", "t2", "t3", "t4"]);
});

it("deduplicates repeated records within a returned page", async () => {
  await render();
  h.feed.mockResolvedValueOnce(page("c", "c"));
  await act(async () => list.onEndReached());
  expect(list.data.map((a) => a.id)).toEqual(["a", "b", "c"]);
});

it("keeps a failed next page retryable and preserves loaded records", async () => {
  await render();
  h.feed.mockRejectedValueOnce(new Error("offline"));
  await act(async () => list.onEndReached());
  expect(list.data.map((a) => a.id)).toEqual(["a", "b"]);
  expect(host.textContent).not.toContain("paging");
  h.feed.mockResolvedValueOnce(page("c", "d"));
  await act(async () => list.onEndReached());
  expect(h.feed.mock.calls.slice(1).map((c) => c[1].page)).toEqual([2, 2]);
  expect(list.data.map((a) => a.id)).toEqual(["a", "b", "c", "d"]);
});

it("does not release replacement pagination when the old request finishes", async () => {
  await render();
  const old = deferred();
  h.feed.mockReturnValueOnce(old.promise);
  await act(async () => list.onEndReached());
  h.feed.mockResolvedValueOnce(page("t1", "t2"));
  await act(async () => click("tag"));
  const next = deferred();
  h.feed.mockReturnValueOnce(next.promise);
  await act(async () => list.onEndReached());
  await act(async () => old.resolve(page("c", "d")));
  expect(host.textContent).toContain("paging");
  await act(async () => list.onEndReached());
  expect(h.feed).toHaveBeenCalledTimes(4);
  await act(async () => next.resolve(page("t3", "t4")));
  expect(host.textContent).not.toContain("paging");
});
