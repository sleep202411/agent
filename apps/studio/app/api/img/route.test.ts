// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { GET } from "./route";
afterEach(() => vi.unstubAllGlobals());
const request = (target: string) =>
  new Request(`https://studio.invalid/api/img?url=${encodeURIComponent(target)}`);
it.each([
  "http://r2.fizzdragon.com/a",
  "https://evil.invalid/a",
  "https://user:pass@r2.fizzdragon.com/a",
  "https://r2.fizzdragon.com:444/a",
])("rejects untrusted targets: %s", async (target) => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  expect((await GET(request(target))).status).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
});
it("returns images without shared caching and forbids redirects", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } })
    );
  vi.stubGlobal("fetch", fetcher);
  const result = await GET(request("https://r2.fizzdragon.com/a?signature=fixture"));
  expect(result.status).toBe(200);
  expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(await result.arrayBuffer()).toHaveProperty("byteLength", 3);
  expect(fetcher).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ redirect: "error", cache: "no-store" })
  );
});
it("does not relay HTML from an allowed host", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("html", { headers: { "content-type": "text/html" } }))
  );
  expect((await GET(request("https://r2.fizzdragon.com/a"))).status).toBe(502);
});
it("rejects oversized images before reading their body", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response("x", {
        headers: { "content-type": "image/png", "content-length": String(33 * 1024 * 1024) },
      })
    )
  );
  expect((await GET(request("https://r2.fizzdragon.com/a"))).status).toBe(413);
});
