import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NewsList } from "./news-list";
import type { NewsItem } from "../_data/types";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), error: vi.fn() }));
vi.mock("../_data/news-client", () => ({ fetchNewsPage: mocks.fetch }));
vi.mock("sonner", () => ({ toast: { error: mocks.error, success: vi.fn() } }));
vi.mock("@/src/i18n/i18n", () => ({
  useLocale: () => "en-US",
  useTranslations: () => (key: string) => key,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const article = (id: number, title: string): NewsItem => ({
  id,
  title,
  type: "article",
  info: "",
  cover: "",
  createTime: "2026-09-22",
  isExternal: false,
});
let root: Root, host: HTMLDivElement;
let pending: Array<{
  resolve: (items: { items: NewsItem[]; hasMore: boolean }) => void;
  reject: (e: Error) => void;
}>;
beforeEach(() => {
  vi.clearAllMocks();
  pending = [];
  mocks.fetch.mockImplementation(
    () =>
      new Promise<{ items: NewsItem[]; hasMore: boolean }>((resolve, reject) =>
        pending.push({ resolve, reject })
      )
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <NewsList
        articles={[article(1, "Original")]}
        initialHasMore
        tags={[
          { id: "alpha", label: "Alpha" },
          { id: "beta", label: "Beta" },
        ]}
      />
    )
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
function tag(label: string) {
  return Array.from(host.querySelectorAll("button")).find((b) => b.textContent === label)!;
}
async function click(label: string) {
  await act(async () => tag(label).click());
}
it("restores the loaded filter after failure and permits retrying the failed tag", async () => {
  await click("Alpha");
  await act(async () => pending[0].reject(new Error("offline")));
  expect(tag("Alpha").getAttribute("aria-pressed")).toBe("false");
  expect(host.textContent).toContain("Original");
  await click("Alpha");
  expect(mocks.fetch).toHaveBeenCalledTimes(2);
  await act(async () =>
    pending[1].resolve({ items: [article(2, "Alpha article")], hasMore: false })
  );
  expect(tag("Alpha").getAttribute("aria-pressed")).toBe("true");
  expect(host.textContent).toContain("Alpha article");
});
it("restores the last successful tag instead of All", async () => {
  await click("Alpha");
  await act(async () =>
    pending[0].resolve({ items: [article(2, "Alpha article")], hasMore: false })
  );
  await click("Beta");
  await act(async () => pending[1].reject(new Error("offline")));
  expect(tag("Alpha").getAttribute("aria-pressed")).toBe("true");
  expect(tag("Beta").getAttribute("aria-pressed")).toBe("false");
  expect(host.textContent).toContain("Alpha article");
});
it("does not roll back a newer selection when an older request fails", async () => {
  await click("Alpha");
  await click("Beta");
  await act(async () =>
    pending[1].resolve({ items: [article(3, "Beta article")], hasMore: false })
  );
  await act(async () => pending[0].reject(new Error("offline")));
  expect(tag("Beta").getAttribute("aria-pressed")).toBe("true");
  expect(host.textContent).toContain("Beta article");
  expect(mocks.error).not.toHaveBeenCalled();
});

it("appends older articles once, keeps the page on failure and retries it", async () => {
  await click("loadMore");
  expect(mocks.fetch.mock.calls[0].slice(0, 3)).toEqual(["en-US", "all", 2]);
  await act(async () => pending[0].reject(Error("Older news unavailable")));
  expect(host.textContent).toContain("Original");
  await click("loadMore");
  expect(mocks.fetch.mock.calls[1][2]).toBe(2);
  await act(async () =>
    pending[1].resolve({
      items: [article(1, "Duplicate"), article(21, "Older article")],
      hasMore: false,
    })
  );
  expect(host.textContent).toContain("Older article");
  expect(host.textContent).not.toContain("Duplicate");
  expect(tag("loadMore")).toBeUndefined();
});
it("cancels an older-page request when switching filters and never appends its late response", async () => {
  await click("loadMore");
  const signal = mocks.fetch.mock.calls[0][3] as AbortSignal;
  await click("Alpha");
  expect(signal.aborted).toBe(true);
  await act(async () =>
    pending[1].resolve({ items: [article(2, "Alpha article")], hasMore: true })
  );
  await act(async () => pending[0].resolve({ items: [article(21, "Wrong feed")], hasMore: true }));
  expect(host.textContent).not.toContain("Wrong feed");
  await click("loadMore");
  expect(mocks.fetch.mock.calls[2].slice(0, 3)).toEqual(["en-US", "alpha", 2]);
});
it("restores All's first page and resets pagination", async () => {
  await click("Alpha");
  await act(async () =>
    pending[0].resolve({ items: [article(2, "Alpha article")], hasMore: false })
  );
  await click("categoryAll");
  await click("loadMore");
  expect(mocks.fetch.mock.calls[1].slice(0, 3)).toEqual(["en-US", "all", 2]);
});
