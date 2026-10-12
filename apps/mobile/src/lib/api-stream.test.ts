import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { postApiStream, setApiTokenProvider, setUnauthorizedHandler } from "./api-client";
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@/config", () => ({
  appEnv: {
    api: {
      studioBaseUrl: "https://studio.example",
      contentBaseUrl: "https://content.example",
      auroraBaseUrl: "https://aurora.example",
    },
  },
}));
vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "zh-CN" }));
const fetcher = vi.fn();
const options = (signal = new AbortController().signal) => ({
  data: { locale: "zh-CN" },
  service: "studio" as const,
  signal,
  timeout: 100,
});
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockReset();
  setApiTokenProvider(() => ({ name: "satoken", value: "current" }));
  setUnauthorizedHandler(undefined);
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("routes an authenticated streaming POST and decodes split Unicode chunks without retry", async () => {
  const bytes = new TextEncoder().encode("你好");
  fetcher.mockResolvedValue(
    new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(bytes.slice(0, 2));
          c.enqueue(bytes.slice(2));
          c.close();
        },
      }),
      { headers: { "content-type": "text/event-stream;charset=utf-8" } }
    )
  );
  const chunks: string[] = [];
  await postApiStream("/api/player/text-game/test", options(), (text) => chunks.push(text));
  expect(chunks.join("")).toBe("你好");
  expect(fetcher).toHaveBeenCalledOnce();
  expect(fetcher.mock.calls[0]).toMatchObject([
    "https://studio.example/api/player/text-game/test",
    { method: "POST", headers: { satoken: "current", lan: "zh-CN", accept: "text/event-stream" } },
  ]);
});
it("preserves Java error messages and expires only current credentials", async () => {
  const unauthorized = vi.fn();
  setUnauthorizedHandler(unauthorized);
  fetcher.mockResolvedValue(new Response(JSON.stringify({ code: 401, msg: "Session expired" })));
  await expect(postApiStream("/api/test", options(), vi.fn())).rejects.toMatchObject({
    message: "Session expired",
    status: 401,
  });
  expect(unauthorized).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledOnce();
});
it("does not expire replacement credentials on a late unauthorized response", async () => {
  const unauthorized = vi.fn();
  setUnauthorizedHandler(unauthorized);
  fetcher.mockImplementation(async () => {
    setApiTokenProvider(() => ({ name: "satoken", value: "new" }));
    return new Response(JSON.stringify({ code: 401, msg: "expired" }));
  });
  await expect(postApiStream("/api/test", options(), vi.fn())).rejects.toThrow("account changed");
  expect(unauthorized).not.toHaveBeenCalled();
});
it("retains timeout protection while the stream body stalls and never retries", async () => {
  const cancel = vi.fn();
  fetcher.mockResolvedValue(
    new Response(new ReadableStream({ cancel }), {
      headers: { "content-type": "text/event-stream" },
    })
  );
  const pending = postApiStream("/api/test", options(), vi.fn());
  const assertion = expect(pending).rejects.toMatchObject({ message: "Request timed out" });
  await vi.advanceTimersByTimeAsync(100);
  await assertion;
  expect(cancel).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledOnce();
});
it("cancels the body when the parser rejects an event", async () => {
  const cancel = vi.fn();
  fetcher.mockResolvedValue(
    new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("invalid"));
        },
        cancel,
      }),
      { headers: { "content-type": "text/event-stream" } }
    )
  );
  await expect(
    postApiStream("/api/test", options(), () => {
      throw new Error("Bad event");
    })
  ).rejects.toThrow("Bad event");
  expect(cancel).toHaveBeenCalledOnce();
});
it("rejects pre-aborted and external destinations without sending credentials", async () => {
  const c = new AbortController();
  c.abort();
  await expect(postApiStream("/api/test", options(c.signal), vi.fn())).rejects.toMatchObject({
    name: "AbortError",
  });
  await expect(postApiStream("https://other.example/api/test", options(), vi.fn())).rejects.toThrow(
    "relative API path"
  );
  expect(fetcher).not.toHaveBeenCalled();
});
it("stops a stalled fetch when the caller cancels", async () => {
  const c = new AbortController();
  fetcher.mockImplementation(() => new Promise(() => {}));
  const pending = postApiStream("/api/test", options(c.signal), vi.fn());
  const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  c.abort();
  await assertion;
  expect(fetcher).toHaveBeenCalledOnce();
});

it.each(["aurora", "studio"] as const)(
  "uses the correct credentials for %s streams",
  async (service) => {
    fetcher.mockResolvedValue(
      new Response("data: done\n\n", { headers: { "content-type": "text/event-stream" } })
    );
    await postApiStream("/test", { ...options(), service }, vi.fn());
    expect(fetcher.mock.calls[0][1].headers.satoken).toBe("current");
    expect(fetcher.mock.calls[0][1].headers.authorization).toBe(
      service === "aurora" ? "Bearer current" : undefined
    );
  }
);
