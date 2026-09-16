import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestJavaStudioAdmin } from "./java-studio-admin";
vi.mock("server-only", () => ({}));
describe("Java administration request lifetime", () => {
  beforeEach(() => {
    vi.stubEnv("TEXT_GAME_API_BASE_URL", "https://java.example.test");
    vi.stubEnv("JAVA_ADMIN_API_TOKEN", "fixture-token");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  it("rejects pre-cancelled callers before dispatch", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const signal = AbortSignal.abort(new DOMException("left", "AbortError"));
    await expect(requestJavaStudioAdmin("/admin/games", { signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(["fetch", "body"] as const)(
    "retains the deadline during %s even with a caller signal",
    async (phase) => {
      const deadline = new AbortController();
      vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
      const caller = new AbortController();
      const wait = (signal: AbortSignal) =>
        new Promise<never>((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), { once: true })
        );
      const fetcher = vi.fn((_url: unknown, init: RequestInit) =>
        phase === "fetch"
          ? wait(init.signal!)
          : Promise.resolve({ ok: true, status: 200, json: () => wait(init.signal!) })
      );
      vi.stubGlobal("fetch", fetcher);
      const request = requestJavaStudioAdmin("/admin/games", { signal: caller.signal });
      const result = expect(request).rejects.toMatchObject({ name: "TimeoutError" });
      await Promise.resolve();
      deadline.abort(new DOMException("deadline", "TimeoutError"));
      await result;
      expect(caller.signal.aborted).toBe(false);
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  );
  it("preserves a specific upstream error instead of a generic status message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          code: 409,
          msg: "失败",
          message: "Version changed; reload before reviewing",
        })
      )
    );
    await expect(requestJavaStudioAdmin("/admin/games")).rejects.toThrow(
      "Version changed; reload before reviewing"
    );
  });
});
