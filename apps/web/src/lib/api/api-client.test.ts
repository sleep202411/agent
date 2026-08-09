import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api-client";

describe("api client response unwrapping", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("preserves Java's explicit data null for successful empty lookups", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 200, msg: "ok", data: null }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await expect(
      api.get<null>("/api/player/text-game/tg_demo/playing-session")
    ).resolves.toBeNull();
  });

  it("keeps multi-field envelopes when raw mode is requested", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 200, info: { id: 1 }, level: ["creator"] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );

    await expect(
      api.get<{ info: { id: number }; level: string[] }>("/user/query/user/info", { raw: true })
    ).resolves.toEqual({ code: 200, info: { id: 1 }, level: ["creator"] });
  });
});
