import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { NewsList } from "./news-list";
import type { NewsItem } from "../_data/types";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), error: vi.fn() }));
vi.mock("../_data/news-client", () => ({ fetchNewsByTag: mocks.fetch }));
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
let pending: Array<{ resolve: (items: NewsItem[]) => void; reject: (e: Error) => void }>;
beforeEach(() => {
  vi.clearAllMocks();
  pending = [];
  mocks.fetch.mockImplementation(
    () => new Promise<NewsItem[]>((resolve, reject) => pending.push({ resolve, reject }))
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <NewsList
        articles={[article(1, "Original")]}
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
  await act(async () => pending[1].resolve([article(2, "Alpha article")]));
  expect(tag("Alpha").getAttribute("aria-pressed")).toBe("true");
  expect(host.textContent).toContain("Alpha article");
});
it("restores the last successful tag instead of All", async () => {
  await click("Alpha");
  await act(async () => pending[0].resolve([article(2, "Alpha article")]));
  await click("Beta");
  await act(async () => pending[1].reject(new Error("offline")));
  expect(tag("Alpha").getAttribute("aria-pressed")).toBe("true");
  expect(tag("Beta").getAttribute("aria-pressed")).toBe("false");
  expect(host.textContent).toContain("Alpha article");
});
it("does not roll back a newer selection when an older request fails", async () => {
  await click("Alpha");
  await click("Beta");
  await act(async () => pending[1].resolve([article(3, "Beta article")]));
  await act(async () => pending[0].reject(new Error("offline")));
  expect(tag("Beta").getAttribute("aria-pressed")).toBe("true");
  expect(host.textContent).toContain("Beta article");
  expect(mocks.error).not.toHaveBeenCalled();
});
