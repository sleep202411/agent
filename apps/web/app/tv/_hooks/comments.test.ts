import { afterEach, expect, it, vi } from "vitest";
import { commentsApi } from "./comments";

afterEach(() => vi.unstubAllGlobals());
const signal = new AbortController().signal;
it("unwraps actual IP comment envelopes including pagination and mutations", async () => {
  const page = { items: [{ id: "comment", body: "Hello" }], nextCursor: "next" };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ code: 200, data: page }))
    .mockResolvedValueOnce(Response.json({ code: 200, data: page.items[0] }))
    .mockResolvedValueOnce(Response.json({ code: 200, data: { ok: true } }));
  vi.stubGlobal("fetch", fetcher);
  await expect(commentsApi.list("ip", signal, "cursor")).resolves.toEqual(page);
  expect(String(fetcher.mock.calls[0][0])).toContain("cursor=cursor");
  await expect(commentsApi.create("ip", "Hello", "request", signal)).resolves.toEqual(
    page.items[0]
  );
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({
    body: "Hello",
    requestId: "request",
  });
  await expect(commentsApi.remove("ip", "comment", signal)).resolves.toEqual({ ok: true });
});
it("retains real server failure messages", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ message: "Comments unavailable" }, { status: 503 }))
  );
  await expect(commentsApi.list("ip", signal)).rejects.toThrow("Comments unavailable");
});
