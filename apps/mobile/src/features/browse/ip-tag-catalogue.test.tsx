import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IpTagCatalogue } from "./ip-tag-catalogue";
import { IpTags } from "./ip-tags";
const h = vi.hoisted(() => ({
  get: vi.fn(),
  share: vi.fn(),
  push: vi.fn(),
  t: (key: string) => key,
}));
vi.mock("@/config", () => ({ webBaseUrl: "https://fizzdragon.fizzspace.cn" }));
vi.mock("@/data/ip-api", () => ({ fetchIpTagPage: h.get }));
vi.mock("expo-router", () => ({ router: { push: h.push } }));
vi.mock("@/lib/navigation", () => ({ toHref: (value: string) => value }));
vi.mock("@/hooks/use-theme", () => ({ useTheme: () => ({}) }));
vi.mock("@/i18n", () => ({ useTranslations: () => h.t, useLocale: () => "zh-HK" }));
vi.mock("@/components/themed-text", () => ({
  ThemedText: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
vi.mock("@/components/ip-grid", () => ({
  IpGridCard: ({ ip }: { ip: { title: string } }) => <span>{ip.title}</span>,
}));
vi.mock("@/components/ui", () => ({
  Tag: ({ label }: { label: string }) => <span>{label}</span>,
  EmptyState: ({
    detail,
    action,
  }: {
    detail: string;
    action: { label: string; onPress: () => void };
  }) => (
    <div>
      {detail}
      <button onClick={action.onPress}>{action.label}</button>
    </div>
  ),
}));
let changeSearch: (value: string) => void;
vi.mock("react-native", () => ({
  Share: { share: h.share },
  Platform: { select: (v: Record<string, unknown>) => v.web ?? v.default },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActivityIndicator: () => <span>loading</span>,
  TextInput: ({ onChangeText }: { onChangeText: (value: string) => void }) => {
    changeSearch = onChangeText;
    return null;
  },
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
  FlatList: ({
    data,
    renderItem,
    ListHeaderComponent,
    ListFooterComponent,
    ListEmptyComponent,
  }: {
    data: { id: string }[];
    renderItem: (p: unknown) => ReactNode;
    ListHeaderComponent: ReactNode;
    ListFooterComponent: ReactNode;
    ListEmptyComponent: ReactNode;
  }) => (
    <div>
      {ListHeaderComponent}
      {data.length
        ? data.map((item) => <div key={item.id}>{renderItem({ item })}</div>)
        : ListEmptyComponent}
      {ListFooterComponent}
    </div>
  ),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
const page = (id = "one", nextCursor: string | null = "one") => ({
  term: { code: "topic", label: "Activity", description: "Public entries" },
  total: 2,
  items: [{ id, title: id, genres: [], typeTags: [] }],
  nextCursor,
});
const click = (label: string) =>
  host.querySelectorAll("button").forEach((button) => {
    if (button.textContent === label) button.click();
  });
beforeEach(() => {
  h.get.mockReset();
  h.share.mockReset();
  h.push.mockReset();
  h.get.mockResolvedValue(page());
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
const render = () => act(async () => root.render(<IpTagCatalogue code="topic" />));
it("keeps pagination reachable when search hides loaded entries and retains the first-page total", async () => {
  await render();
  await act(async () => changeSearch("two"));
  expect(host.textContent).toContain("ipTag.searchMore");
  h.get.mockResolvedValueOnce({ ...page("two", null), total: null });
  await act(async () => click("ips.loadMore"));
  expect(host.textContent).toContain("two");
  expect(host.textContent).toContain("ipTag.entries: 2");
  expect(host.textContent).not.toContain("ips.loadMore");
});
it("recovers initial and page errors with the original cursor and preserves loaded results", async () => {
  h.get.mockRejectedValueOnce(new Error("offline"));
  await render();
  expect(host.textContent).toContain("offline");
  await act(async () => click("common.retry"));
  h.get.mockRejectedValueOnce(new Error("next offline"));
  await act(async () => click("ips.loadMore"));
  expect(host.textContent).toContain("one");
  expect(host.textContent).toContain("next offline");
  h.get.mockResolvedValueOnce(page("two", null));
  await act(async () => click("common.retry"));
  expect(h.get.mock.calls.at(-1)?.[1].cursor).toBe("one");
  expect(host.textContent).toContain("two");
});
it("shows a not-found state without presenting a transport error", async () => {
  h.get.mockRejectedValueOnce(Object.assign(new Error("missing"), { status: 404 }));
  await render();
  expect(host.textContent).toContain("ipTag.missing");
  expect(host.textContent).not.toContain("common.retry");
});
it("aborts pending reads on unmount", async () => {
  h.get.mockReturnValue(new Promise(() => {}));
  await render();
  const signal = h.get.mock.calls[0]?.[1].signal;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
});
it("links only unambiguous server tag codes without changing plain genre labels", async () => {
  await act(async () =>
    root.render(
      <IpTags
        ip={{ tags: ["Drama", "Activity"], typeTags: ["Activity"], typeTagCodes: ["hidden/tag"] }}
      />
    )
  );
  expect(host.querySelectorAll("button")).toHaveLength(1);
  await act(async () => click("Activity"));
  expect(h.push).toHaveBeenCalledWith("/tags/hidden%2Ftag");
  await act(async () =>
    root.render(
      <IpTags
        ip={{
          tags: ["Activity"],
          typeTags: ["Activity", "Activity"],
          typeTagCodes: ["one", "two"],
        }}
      />
    )
  );
  expect(host.querySelectorAll("button")).toHaveLength(0);
});

it("rejects a cursor returning to an already loaded page", async () => {
  await render();
  h.get.mockResolvedValueOnce({ ...page("two", "one"), total: null });
  await act(async () => click("ips.loadMore"));
  expect(host.textContent).toContain("Invalid activity cursor");
  expect(host.textContent).not.toContain("two");
});
it("prevents duplicate pagination while a page is pending", async () => {
  await render();
  let resolve!: (value: ReturnType<typeof page>) => void;
  h.get.mockReturnValueOnce(
    new Promise((r) => {
      resolve = r;
    })
  );
  await act(async () => {
    click("ips.loadMore");
    click("ips.loadMore");
  });
  expect(h.get).toHaveBeenCalledTimes(2);
  await act(async () => resolve(page("two", null)));
  expect(host.textContent).toContain("two");
});

it("shares the regional localized activity URL and makes failures visible", async () => {
  await render();
  h.share.mockRejectedValueOnce(new Error("Sharing unavailable"));
  await act(async () => click("play.share"));
  expect(h.share).toHaveBeenCalledWith({
    message: "https://fizzdragon.fizzspace.cn/zh-HK/tags/topic",
    url: "https://fizzdragon.fizzspace.cn/zh-HK/tags/topic",
  });
  expect(host.textContent).toContain("Sharing unavailable");
  await act(async () => click("play.share"));
  expect(host.textContent).not.toContain("Sharing unavailable");
});

it("ignores an old share failure after refresh and enables sharing again", async () => {
  await render();
  let reject!: (value: Error) => void;
  h.share.mockReturnValueOnce(
    new Promise((_, fail) => {
      reject = fail;
    })
  );
  await act(async () => click("play.share"));
  await act(async () => click("thread.refresh"));
  await act(async () => reject(new Error("Stale share failure")));
  expect(host.textContent).not.toContain("Stale share failure");
  await act(async () => click("play.share"));
  expect(h.share).toHaveBeenCalledTimes(2);
});
