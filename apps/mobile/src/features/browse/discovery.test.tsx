import { act, useLayoutEffect, useImperativeHandle, type ReactNode, type Ref } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import Discovery from "@/app/discovery";
import type { IpSummary } from "@/data/types";
const h = vi.hoisted(() => ({
  pause: vi.fn(),
  resume: vi.fn(),
  generation: 1,
  active: true,
  status: "authenticated",
  like: vi.fn(),
  unlike: vi.fn(),
  block: vi.fn(),
  gate: vi.fn(),
  push: vi.fn(),
  scroll: vi.fn(),
  more: vi.fn(),
  refresh: vi.fn(),
  invalidate: vi.fn(),
  items: [] as IpSummary[],
  hasMore: false,
}));
vi.mock("@/auth", () => ({
  useAuth: () => ({ generation: h.generation, status: h.status }),
  useAuthGate: () => ({ requireAuth: h.gate }),
}));
vi.mock("@/auth/auth-store", () => ({ getAuthGeneration: () => h.generation }));
vi.mock("@/hooks/use-app-active", () => ({ useScreenActive: () => h.active }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
vi.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ push: h.push }),
}));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("./discovery-preview", () => ({
  DiscoveryPreview: ({ ipId, playback }: { ipId: string; playback: { current: unknown } }) => {
    useLayoutEffect(() => {
      playback.current = { pause: h.pause, resume: h.resume };
      return () => {
        playback.current = null;
      };
    }, [playback]);
    return <div data-preview={ipId} />;
  },
}));
vi.mock("@/components/ui", () => ({ PosterImage: () => null }));
vi.mock("@/data/ip-api", () => ({ likeIp: h.like, unlikeIp: h.unlike, blockIpContent: h.block }));
vi.mock("@/data/browse-refresh", () => ({ invalidateBrowse: h.invalidate }));
vi.mock("./use-discovery-feed", () => ({
  useDiscoveryFeed: () => ({
    items: h.items,
    genres: [],
    typeTags: [],
    hasMore: h.hasMore,
    loading: false,
    loadMore: h.more,
    retry: h.more,
    refresh: h.refresh,
  }),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "web" },
  ActivityIndicator: () => null,
  View: ({ children, onLayout }: { children: ReactNode; onLayout?: (event: unknown) => void }) => {
    useLayoutEffect(() => {
      onLayout?.({ nativeEvent: { layout: { height: 600 } } });
    }, [onLayout]);
    return <div>{children}</div>;
  },
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
  }: {
    children: ReactNode;
    onPress: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
  }) => (
    <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  FlatList: ({
    ref,
    onScroll,
    data,
    renderItem,
    ListFooterComponent,
  }: {
    ref: Ref<unknown>;
    onScroll: (e: unknown) => void;
    data: IpSummary[];
    renderItem: (args: { item: IpSummary; index: number }) => ReactNode;
    ListFooterComponent: ReactNode;
  }) => {
    useImperativeHandle(ref, () => ({ scrollToIndex: h.scroll, scrollToOffset: vi.fn() }));
    return (
      <div>
        <button onClick={() => onScroll({ nativeEvent: { contentOffset: { y: 300 } } })}>
          half swipe
        </button>
        <button onClick={() => onScroll({ nativeEvent: { contentOffset: { y: 600 } } })}>
          next swipe
        </button>
        {data.map((item, index) => (
          <div key={item.id}>{renderItem({ item, index })}</div>
        ))}
        {ListFooterComponent}
      </div>
    );
  },
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root, host: HTMLDivElement;
const render = () => act(async () => root.render(<Discovery />));
const button = (label: string) => host.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
beforeEach(() => {
  vi.resetAllMocks();
  h.generation = 1;
  h.active = true;
  h.status = "authenticated";
  h.hasMore = false;
  h.items = [
    { id: "one", title: "One", likeCount: 0, viewerHasLiked: false },
    { id: "two", title: "Two", likeCount: 0, viewerHasLiked: false },
  ] as IpSummary[];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
it("X advances to the next work without account mutations", async () => {
  await render();
  await act(async () => button("discovery.skip").click());
  expect(h.scroll).toHaveBeenCalledWith({ index: 1, animated: true });
  expect(h.like).not.toHaveBeenCalled();
  expect(h.unlike).not.toHaveBeenCalled();
  expect(h.block).not.toHaveBeenCalled();
});
it("loads the next page before advancing and disables X at the end", async () => {
  h.items = h.items.slice(0, 1);
  h.hasMore = true;
  await render();
  await act(async () => button("discovery.skip").click());
  expect(h.more).toHaveBeenCalledTimes(1);
  expect(h.scroll).not.toHaveBeenCalled();
  h.items.push({ id: "two", title: "Two" } as IpSummary);
  await render();
  expect(h.scroll).toHaveBeenCalledWith({ index: 1, animated: true });
  h.generation++;
  h.items = h.items.slice(0, 1);
  h.hasMore = false;
  await render();
  expect(button("discovery.skip").disabled).toBe(true);
});
it("serializes rapid heart taps and supports unlike", async () => {
  let finish!: (value: unknown) => void;
  h.like.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await act(async () => {
    button("discovery.like").click();
    button("discovery.like").click();
  });
  expect(h.like).toHaveBeenCalledTimes(1);
  await act(async () => finish({ viewerHasLiked: true, likeCount: 1, viewCount: 0 }));
  h.unlike.mockResolvedValue({ viewerHasLiked: false, likeCount: 0, viewCount: 0 });
  await act(async () => button("discovery.unlike").click());
  expect(h.unlike).toHaveBeenCalledWith("one");
});
it("gates guest likes and suppresses responses from the previous account", async () => {
  h.status = "anonymous";
  await render();
  await act(async () => button("discovery.like").click());
  expect(h.gate).toHaveBeenCalledTimes(1);
  expect(h.like).not.toHaveBeenCalled();
  h.status = "authenticated";
  h.generation++;
  let finish!: (value: unknown) => void;
  h.like.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await render();
  await act(async () => button("discovery.like").click());
  h.generation++;
  await render();
  await act(async () => finish({ viewerHasLiked: true, likeCount: 1, viewCount: 0 }));
  expect(host.querySelector('[aria-label="discovery.unlike"]')).toBeNull();
  expect(h.invalidate).not.toHaveBeenCalled();
});
it("keeps failed likes retryable and hides inactive content", async () => {
  h.like.mockRejectedValue(new Error("offline"));
  await render();
  await act(async () => button("discovery.like").click());
  expect(host.textContent).toContain("offline");
  expect(button("discovery.like").disabled).toBe(false);
  h.active = false;
  await render();
  expect(host.textContent).toBe("");
});

it("pauses during scrolling and switches players only after the next card settles", async () => {
  vi.useFakeTimers();
  await render();
  expect(host.querySelector('[data-preview="one"]')).not.toBeNull();
  expect(host.querySelector('[data-preview="two"]')).toBeNull();
  const clickText = async (text: string) =>
    act(async () =>
      [...host.querySelectorAll("button")].find((b) => b.textContent === text)!.click()
    );
  await clickText("half swipe");
  expect(h.pause).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[data-preview="one"]')).not.toBeNull();
  await clickText("next swipe");
  await act(async () => vi.advanceTimersByTime(150));
  expect(host.querySelector('[data-preview="one"]')).toBeNull();
  expect(host.querySelector('[data-preview="two"]')).not.toBeNull();
  h.active = false;
  await render();
  expect(host.querySelector("[data-preview]")).toBeNull();
});

it("cancels an old scroll settlement when a filter is selected", async () => {
  vi.useFakeTimers();
  await render();
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "next swipe")!.click()
  );
  await act(async () =>
    [...host.querySelectorAll("button")].find((b) => b.textContent === "home.genreAll")!.click()
  );
  await act(async () => vi.advanceTimersByTime(150));
  expect(host.querySelector('[data-preview="one"]')).not.toBeNull();
  expect(host.querySelector('[data-preview="two"]')).toBeNull();
});
