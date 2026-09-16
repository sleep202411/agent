import { afterEach, describe, expect, it, vi } from "vitest";
import { api, type ApiRequestError } from "./api-client";

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

  it("prefers detailed message over generic msg on envelope failures", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 500,
          msg: "失败",
          message: "该等级已有待审核申请",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      )
    );

    await expect(api.post("/user/levels/apply", { data: {} })).rejects.toMatchObject({
      name: "ApiRequestError",
      message: "该等级已有待审核申请",
      code: 500,
    } satisfies Partial<InstanceType<typeof ApiRequestError>>);
  });
});

describe("request cancellation and deadlines", () => {
  const originalFetch = globalThis.fetch;
  afterEach(async () => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
    const { setUnauthorizedHandler } = await import("./api-client");
    setUnauthorizedHandler(null);
  });
  const run = (method: "request" | "upload", signal: AbortSignal, timeout = 1000) =>
    method === "request"
      ? api.post("/api/player/play/sessions/start", { data: {}, signal, timeout })
      : api.upload("/api/user/upload", new File(["x"], "test.txt"), "file", { signal, timeout });
  function pendingFetch() {
    const fetcher = vi.fn(
      (_url: unknown, init: RequestInit = {}) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
        })
    );
    globalThis.fetch = fetcher;
    return fetcher;
  }
  it.each(["request", "upload"] as const)(
    "forwards caller cancellation for %s and cleans up its listener",
    async (method) => {
      const fetcher = pendingFetch();
      const caller = new AbortController();
      const remove = vi.spyOn(caller.signal, "removeEventListener");
      const promise = run(method, caller.signal);
      const expected = expect(promise).rejects.toMatchObject({ name: "AbortError" });
      caller.abort();
      await expected;
      expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    }
  );
  it.each(["request", "upload"] as const)(
    "retains the timeout when %s has a caller signal",
    async (method) => {
      vi.useFakeTimers();
      pendingFetch();
      const caller = new AbortController();
      const promise = run(method, caller.signal);
      const expected = expect(promise).rejects.toMatchObject({
        name: "ApiRequestError",
        message: "Request timed out",
      });
      await vi.advanceTimersByTimeAsync(1000);
      await expected;
      expect(caller.signal.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    }
  );
  it.each(["request", "upload"] as const)(
    "does not send a %s that was already cancelled",
    async (method) => {
      const fetcher = pendingFetch();
      const caller = new AbortController();
      caller.abort();
      await expect(run(method, caller.signal)).rejects.toMatchObject({ name: "AbortError" });
      expect(fetcher).not.toHaveBeenCalled();
    }
  );
  it.each([true, false])(
    "does not expire a newer account after a cancelled %s unauthorized response",
    async (httpError) => {
      const { setUnauthorizedHandler } = await import("./api-client");
      const unauthorized = vi.fn();
      setUnauthorizedHandler(unauthorized);
      let resolve!: (value: unknown) => void;
      const body = new Promise((yes) => {
        resolve = yes;
      });
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: !httpError,
        status: httpError ? 401 : 200,
        text: () => body,
        json: () => body,
      });
      const caller = new AbortController();
      const promise = run("request", caller.signal);
      const expected = expect(promise).rejects.toMatchObject({ name: "AbortError" });
      await Promise.resolve();
      caller.abort();
      resolve(
        httpError ? '{"message":"Session expired"}' : { code: 401, message: "Session expired" }
      );
      await expected;
      expect(unauthorized).not.toHaveBeenCalled();
    }
  );
  it("keeps the deadline active while the response body is loading", async () => {
    vi.useFakeTimers();
    let resolve!: (value: unknown) => void;
    const body = new Promise((yes) => {
      resolve = yes;
    });
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => body });
    const promise = run("request", new AbortController().signal);
    const expected = expect(promise).rejects.toMatchObject({ message: "Request timed out" });
    await vi.advanceTimersByTimeAsync(1000);
    resolve({ code: 200, data: "late" });
    await expected;
  });
});

describe("request configuration preservation", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(["request", "upload"] as const)(
    "preserves query, fragment and all header forms for %s",
    async (kind) => {
      for (const headers of [
        new Headers({ "Accept-Language": "zh-CN", "X-Proof": "proof" }),
        [
          ["Accept-Language", "zh-CN"],
          ["X-Proof", "proof"],
        ] as [string, string][],
        { "Accept-Language": "zh-CN", "X-Proof": "proof" },
      ]) {
        const fetcher = vi
          .fn()
          .mockResolvedValue(new Response(JSON.stringify({ code: 200, data: "ok" })));
        vi.stubGlobal("fetch", fetcher);
        const config = { headers, params: { page: 2, search: "a & b", ignored: undefined } };
        const path = "/api/example?keep=yes&page=1#preview";
        if (kind === "request") await api.get(path, config);
        else await api.upload(path, new File(["x"], "file.txt"), "file", config);
        const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
        expect(url).toContain("/api/example?keep=yes&page=2&search=a+%26+b#preview");
        const sent = new Headers(init.headers);
        expect(sent.get("accept-language")).toBe("zh-CN");
        expect(sent.get("x-proof")).toBe("proof");
        expect(sent.has("content-type")).toBe(kind === "request");
      }
    }
  );
});
