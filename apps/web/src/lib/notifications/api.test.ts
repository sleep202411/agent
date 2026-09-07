import { afterEach, describe, expect, it, vi } from "vitest";
import { listNotifications, markNotificationRead } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("notification requests", () => {
  it("sends the filter and cursor to the server without caching private data", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ items: [], nextCursor: null })));
    vi.stubGlobal("fetch", fetch);
    await listNotifications({ filter: "sharing", cursor: "n1", limit: 30 });
    expect(fetch).toHaveBeenCalledWith(
      "/aurora/notifications?limit=30&cursor=n1&filter=sharing",
      expect.objectContaining({ credentials: "include", cache: "no-store" })
    );
  });
  it("allows mark-read to complete when navigation unloads the document", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    await markNotificationRead("n1");
    expect(fetch).toHaveBeenCalledWith(
      "/aurora/notifications/n1/read",
      expect.objectContaining({ method: "POST", keepalive: true })
    );
  });
  it.each([
    [JSON.stringify({ message: "Session expired" }), "Session expired"],
    [
      JSON.stringify({ message: ["Invalid filter", "Invalid cursor"] }),
      "Invalid filter; Invalid cursor",
    ],
    ["Upstream unavailable", "Upstream unavailable"],
  ])("preserves the server's error detail", async (body, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 502 })));
    await expect(listNotifications()).rejects.toThrow(message);
  });
});
