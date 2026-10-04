import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverPublicContent, readPublicCourse } from "./public-content";
const fetcher = vi.fn();
const ip = "0197f4a2-0800-7000-8000-000000000001";
const response = (data: unknown) => new Response(JSON.stringify({ code: 200, data }));
beforeEach(() => {
  vi.stubEnv("SERVER_URL", "https://nest.test");
  vi.stubEnv("JAVA_CONTENT_URL", "https://java-cn.test");
  fetcher.mockReset();
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("anonymous public discovery", () => {
  it("follows opaque cursors and rejects private/draft IPs", async () => {
    fetcher
      .mockResolvedValueOnce(
        response({
          items: [{ id: ip, status: "draft", listingVisibility: "public" }],
          nextCursor: "a/b",
        })
      )
      .mockResolvedValueOnce(
        response({
          items: [{ id: ip, status: "published", listingVisibility: "public" }],
          nextCursor: null,
        })
      );
    expect(await discoverPublicContent("ips", "zh-CN")).toEqual([{ path: `/ips/${ip}` }]);
    expect(fetcher.mock.calls[1][0]).toContain("cursor=a%2Fb");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: "omit", cache: "no-store" });
    expect(fetcher.mock.calls[0][1].headers).toBeUndefined();
  });
  it("detects a repeated cursor and does not publish partial results", async () => {
    fetcher.mockImplementation(async () => response({ items: [], nextCursor: "same" }));
    await expect(discoverPublicContent("ips", "en-US")).rejects.toThrow("did not advance");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("continues past full external-news pages without adding external URLs", async () => {
    fetcher
      .mockResolvedValueOnce(
        response({
          list: Array.from({ length: 50 }, (_, id) => ({ id: id + 1, kind: "external" })),
        })
      )
      .mockResolvedValueOnce(
        response({ list: [{ id: 51, kind: "article", publishedAt: "2026-10-04" }] })
      );
    const found = await discoverPublicContent("news", "en-US");
    expect(found.map((x) => x.path)).toEqual(["/news/51"]);
    expect(fetcher.mock.calls[1][0]).toContain("page=2");
  });
  it("fails closed on HTTP-200 service errors", async () => {
    fetcher.mockResolvedValue(new Response(JSON.stringify({ code: 403, data: [{ id: 1 }] })));
    await expect(discoverPublicContent("courses", "en-US")).rejects.toThrow();
  });
  it("reads current publication each time and does not retain removed entries", async () => {
    fetcher.mockResolvedValueOnce(response([{ id: 1 }])).mockResolvedValueOnce(response([]));
    expect(await discoverPublicContent("courses", "en-US")).toEqual([{ path: "/courses/1" }]);
    expect(await discoverPublicContent("courses", "en-US")).toEqual([]);
  });
  it("projects only public course copy and recovers from outages or invalid IDs", async () => {
    fetcher.mockImplementation(async () =>
      response({ id: 1, title: "Course", description: "Description", videos: [{ url: "private" }] })
    );
    expect(await readPublicCourse("1", "zh-HK")).toEqual({
      id: 1,
      title: "Course",
      description: "Description",
    });
    expect(fetcher.mock.calls[0][0]).toBe("https://java-cn.test/project/courses/1?locale=zh-HK");
    fetcher.mockRejectedValue(new Error("offline"));
    expect(await readPublicCourse("1", "en-US")).toBeNull();
    expect(await readPublicCourse("../../secret", "en-US")).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not emit metadata for an explicitly unpublished course", async () => {
    fetcher.mockResolvedValue(
      response({ id: 1, title: "Draft", description: "Hidden", status: "draft" })
    );
    expect(await readPublicCourse("1", "en-US")).toBeNull();
  });
});
