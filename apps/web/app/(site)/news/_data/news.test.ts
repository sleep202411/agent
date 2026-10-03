import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/src/env", () => ({ env: { BANNER_BASE_URL: "https://media.example.test" } }));
vi.stubEnv("JAVA_CONTENT_URL", "https://content.example.test");
const { getNewsList, getNewsItem, getNewsTags, getNewsPage } = await import("./news");
const { fetchNewsPage } = await import("./news-client");
afterEach(() => vi.unstubAllGlobals());
function reply(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status }))
  );
}
it("distinguishes empty published feeds from failed or malformed feeds", async () => {
  reply({ code: 200, data: { list: [] } });
  expect(await getNewsList("zh-CN")).toEqual([]);
  reply({ code: 503, msg: "Content service unavailable" }, 503);
  await expect(getNewsList("zh-CN")).rejects.toThrow("Content service unavailable");
  reply({ code: 200, data: {} });
  await expect(getNewsList("zh-CN")).rejects.toThrow("invalid article list");
});
it("only treats a missing article as missing, not an unavailable service", async () => {
  reply({}, 404);
  expect(await getNewsItem(2, "en-US")).toBeNull();
  reply({ success: false, message: "Try again later" }, 500);
  await expect(getNewsItem(2, "en-US")).rejects.toThrow("Try again later");
  reply({ code: 200, data: { id: 3, title: "Wrong article" } });
  await expect(getNewsItem(2, "en-US")).rejects.toThrow("invalid article");
});
it("loads full articles and localized tags without caching failures", async () => {
  reply({ code: 200, data: { id: 2, title: "Title", body: "Full article" } });
  expect(await getNewsItem(2, "zh-HK")).toMatchObject({ id: 2, body: "Full article" });
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("locale=zh-HK"),
    expect.objectContaining({ cache: "no-store" })
  );
  reply({ success: true, data: [{ id: "news", label: "News" }] });
  expect(await getNewsTags("en-US")).toEqual([{ id: "news", label: "News" }]);
  reply({ success: false, message: "Tags unavailable" });
  await expect(getNewsTags("en-US")).rejects.toThrow("Tags unavailable");
});
it("preserves filter request errors instead of replacing them with an empty feed", async () => {
  reply({ code: 500, msg: "Filter service unavailable" });
  await expect(fetchNewsPage("en-US", "tag")).rejects.toThrow("Filter service unavailable");
  reply({ code: 200, data: {} });
  await expect(fetchNewsPage("en-US", "tag")).rejects.toThrow("invalid article list");
});

it("requests subsequent pages without sending the All sentinel and forwards cancellation", async () => {
  reply({ code: 200, data: { list: [{ id: 21, title: "Older article" }] } });
  const controller = new AbortController();
  expect(await fetchNewsPage("zh-HK", "all", 2, controller.signal)).toMatchObject({
    hasMore: false,
    items: [{ id: 21 }],
  });
  expect(fetch).toHaveBeenCalledWith(
    "/content/api/news?locale=zh-HK&page=2&pageSize=20",
    expect.objectContaining({ signal: controller.signal })
  );
});
it("uses raw page length for continuation even if malformed records are omitted", async () => {
  reply({
    code: 200,
    data: {
      list: Array.from({ length: 20 }, (_, id) => ({ id, title: id === 0 ? "" : "Article" })),
    },
  });
  const page = await getNewsPage("en-US");
  expect(page.hasMore).toBe(true);
  expect(page.items).toHaveLength(19);
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("page=1&pageSize=20"),
    expect.anything()
  );
});
