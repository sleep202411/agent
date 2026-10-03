import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({ list: vi.fn(), tags: vi.fn(), item: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-locale": "zh-CN" }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("./_data/news", () => ({ getNewsList: s.list, getNewsTags: s.tags, getNewsItem: s.item }));
vi.mock("./_components/news-load-error", () => ({
  NewsLoadError: ({ error }: { error: string }) => <p role="alert">{error}</p>,
}));
vi.mock("./_components/news-list", () => ({ NewsList: () => <p>Published feed</p> }));
vi.mock("./_components/news-detail", () => ({
  NewsNotFound: () => <p>Not found</p>,
  NewsDetail: ({ item }: { item: { body: string } }) => <article>{item.body}</article>,
}));
vi.mock("@/src/lib/seo", () => ({
  JsonLd: () => null,
  buildArticle: vi.fn(),
  buildBreadcrumbList: vi.fn(),
  buildItemList: vi.fn(),
  localeCanonicalUrl: vi.fn(),
}));
import NewsPage from "./page";
import DetailPage from "./[id]/page";
beforeEach(() => {
  s.list.mockReset().mockResolvedValue([]);
  s.tags.mockReset().mockResolvedValue([]);
  s.item.mockReset().mockResolvedValue(null);
});
it("shows feed failure without claiming the feed is empty", async () => {
  s.list.mockRejectedValue(new Error("News offline"));
  const html = renderToStaticMarkup(await NewsPage());
  expect(html).toContain("News offline");
  expect(html).not.toContain("Published feed");
});
it("keeps articles visible if only tag loading fails", async () => {
  s.tags.mockRejectedValue(new Error("Tags offline"));
  const html = renderToStaticMarkup(await NewsPage());
  expect(html).toContain("Published feed");
  expect(html).toContain("Tags offline");
});
it("does not substitute a summary for a failed article body", async () => {
  s.item.mockRejectedValue(new Error("Article offline"));
  s.list.mockResolvedValue([{ id: 2, title: "Title", info: "Summary only" }]);
  const html = renderToStaticMarkup(await DetailPage({ params: Promise.resolve({ id: "2" }) }));
  expect(html).toContain("Article offline");
  expect(html).not.toContain("Summary only");
  expect(html).not.toContain("Not found");
});
it("keeps the full article visible when related news fails", async () => {
  s.item.mockResolvedValue({ id: 2, title: "Title", body: "Full article" });
  s.list.mockRejectedValue(new Error("Related news offline"));
  const html = renderToStaticMarkup(await DetailPage({ params: Promise.resolve({ id: "2" }) }));
  expect(html).toContain("Full article");
  expect(html).toContain("Related news offline");
});
