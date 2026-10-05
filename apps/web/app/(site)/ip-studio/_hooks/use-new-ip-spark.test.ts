import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useNewIpSparkAnalyze } from "./use-new-ip-spark";
const state = vi.hoisted(() => ({ run: null as null | ((file: File) => Promise<unknown>) }));
vi.mock("@tanstack/react-query", () => ({
  useMutation: (options: { mutationFn: (file: File) => Promise<unknown> }) => {
    state.run = options.mutationFn;
    return {};
  },
}));
beforeEach(() => {
  vi.useFakeTimers();
  useNewIpSparkAnalyze();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function run() {
  return state.run!(new File(["brief"], "brief.txt")).then(
    (value) => ({ value }),
    (error: Error) => ({ error: error.message })
  );
}
it("times out a stalled response body after headers arrive", async () => {
  let signal!: AbortSignal;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, init: RequestInit) => {
      signal = init.signal!;
      return {
        ok: true,
        json: () =>
          new Promise((_resolve, reject) =>
            signal.addEventListener(
              "abort",
              () => reject(new DOMException("aborted", "AbortError")),
              { once: true }
            )
          ),
      };
    })
  );
  const pending = run();
  await vi.advanceTimersByTimeAsync(300_000);
  expect(signal.aborted).toBe(true);
  expect(await pending).toEqual({ error: "Analysis timed out" });
});
it("times out a stalled fetch before headers", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_url, init: RequestInit) =>
        new Promise((_resolve, reject) =>
          init.signal!.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          )
        )
    )
  );
  const pending = run();
  await vi.advanceTimersByTimeAsync(300_000);
  expect(await pending).toEqual({ error: "Analysis timed out" });
});
it("returns a successful draft and clears its deadline", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({ code: 200, data: { name: "Title" } }) }))
  );
  expect(await run()).toEqual({ value: { name: "Title" } });
  expect(vi.getTimerCount()).toBe(0);
});
it("preserves backend failure messages and clears its deadline", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ code: 500, msg: "Provider unavailable" }),
    }))
  );
  expect(await run()).toEqual({ error: "Provider unavailable" });
  expect(vi.getTimerCount()).toBe(0);
});
it("preserves malformed-body errors and clears its deadline", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      json: async () => {
        throw new SyntaxError("Invalid JSON");
      },
    }))
  );
  expect(await run()).toEqual({ error: "Invalid JSON" });
  expect(vi.getTimerCount()).toBe(0);
});

it("preserves non-2xx analysis error details", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ msg: "AI provider is not configured." }), { status: 503 })
      )
  );
  expect(await run()).toEqual({ error: "HTTP 503 — AI provider is not configured." });
});
