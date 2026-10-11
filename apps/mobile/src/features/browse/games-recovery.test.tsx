import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import GamesScreen from "@/app/games";

const h = vi.hoisted(() => ({
  feed: vi.fn(),
  texts: vi.fn(),
  push: vi.fn(),
  filmPlay: vi.fn(),
  tags: vi.fn(),
  locale: "en-US",
  t: (key: string) => key,
}));
type ListProps = {
  data: { gameId: string }[];
  onEndReached: () => void;
  ListHeaderComponent: ReactNode;
  refreshControl: ReactNode;
  ListFooterComponent: ReactNode;
  renderItem: (args: { item: { gameId: string } }) => ReactNode;
};
let list: ListProps;
vi.mock("@/data/text-game-api", () => ({ listPublishedTextGames: h.texts }));
vi.mock("expo-router", () => ({
  router: { push: vi.fn() },
  useRouter: () => ({ push: h.push }),
  useLocalSearchParams: () => ({}),
  Stack: { Screen: () => null },
}));
vi.mock("expo-image", () => ({ Image: () => null }));
vi.mock("@/auth", () => ({ useAuthGate: () => ({ isAuthenticated: true, openLogin: vi.fn() }) }));
vi.mock("@/data/browse-refresh", () => ({ useBrowseVersion: () => 0 }));
vi.mock("@/lib/navigation", () => ({ toHref: (v: string) => v }));
vi.mock("@/components/ip-grid", () => ({ IpGridCard: () => null }));
vi.mock("@/data/interactive-film-api", () => ({ listPublishedInteractiveFilms: h.feed }));
vi.mock("@/features/film-store/film-store", () => ({
  FilmStore: ({ game }: { game: { gameId: string } }) => <span>preview:{game.gameId}</span>,
}));
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
        {props.data.map((item, i) => (
          <div key={i}>{props.renderItem({ item })}</div>
        ))}
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
const page = (...ids: string[]) => ids.map((gameId) => ({ gameId }));
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
  h.texts.mockReset();
  h.texts.mockResolvedValue([]);
  h.push.mockReset();
  h.filmPlay.mockReset();
  h.feed.mockResolvedValue(page("a"));
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
const render = () => act(async () => root.render(<GamesScreen />));
it("keeps a newer refresh after the old refresh completes", async () => {
  await render();
  const old = deferred();
  h.feed.mockReturnValueOnce(old.promise);
  await act(async () => click("refresh"));
  h.feed.mockResolvedValueOnce(page("new"));
  await act(async () => click("refresh"));
  await act(async () => old.resolve(page("old")));
  expect(list.data.map((x) => x.gameId)).toEqual(["new"]);
});
it("aborts refresh transport when replaced and when the screen leaves", async () => {
  await render();
  const old = deferred();
  h.feed.mockReturnValueOnce(old.promise);
  await act(async () => click("refresh"));
  const firstSignal = h.feed.mock.calls[1][0].signal as AbortSignal;
  const next = deferred();
  h.feed.mockReturnValueOnce(next.promise);
  await act(async () => click("refresh"));
  expect(firstSignal?.aborted).toBe(true);
  const nextSignal = h.feed.mock.calls[2][0].signal as AbortSignal;
  await act(async () => root.render(null));
  expect(nextSignal?.aborted).toBe(true);
  await act(async () => {
    old.resolve(page("old"));
    next.resolve(page("next"));
  });
});

it("opens a text adventure natively and retains film navigation", async () => {
  h.texts.mockResolvedValue([
    { gameId: "tg_0123456789abcdef", status: "published", name: "A text game" },
  ]);
  await render();
  const buttons = [...host.querySelectorAll("button")];
  await act(async () => buttons.find((b) => b.textContent?.includes("A text game"))!.click());
  expect(h.push).toHaveBeenCalledWith("/play/text-game/tg_0123456789abcdef");
  await act(async () => buttons.find((b) => b.textContent?.includes("games.filmLabel"))!.click());
  expect(host.textContent).toContain("preview:a");
  expect(h.filmPlay).not.toHaveBeenCalled();
});
