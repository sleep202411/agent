import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("studio API request cancellation", () => {
  it("accepts a numeric 202 envelope for asynchronous operations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 202,
        json: vi.fn().mockResolvedValue({
          code: 202,
          data: { status: "queued" },
        }),
      } as unknown as Response)
    );

    await expect(api.post("/aurora/async-operation")).resolves.toEqual({ status: "queued" });
  });

  it("preserves nested Nest error codes and messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        text: vi.fn().mockResolvedValue(
          JSON.stringify({
            statusCode: 422,
            message: {
              code: "VIDEO_PROBE_FAILED",
              message: "The uploaded file is not a valid video.",
            },
          })
        ),
      } as unknown as Response)
    );

    await expect(api.get("/aurora/failed-operation")).rejects.toMatchObject({
      code: "VIDEO_PROBE_FAILED",
      message: "The uploaded file is not a valid video.",
      status: 422,
    });
  });

  it("preserves a caller abort while combining it with the request timeout", async () => {
    const requestSignals: AbortSignal[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.signal) requestSignals.push(init.signal);
        return rejectWhenAborted(init?.signal ?? null);
      })
    );
    const controller = new AbortController();

    const pending = api.get("/aurora/test", {
      signal: controller.signal,
      timeout: 60_000,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(requestSignals[0]).not.toBe(controller.signal);
    expect(requestSignals[0]?.aborted).toBe(true);
  });

  it("retains the distinct timeout error when the internal deadline wins", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
        rejectWhenAborted(init?.signal ?? null)
      )
    );

    const pending = api.get("/aurora/test", { timeout: 250 });
    const assertion = expect(pending).rejects.toEqual(
      expect.objectContaining({
        name: "ApiRequestError",
        code: "NETWORK_ERROR",
        message: "Request timed out",
        status: 0,
      })
    );
    await vi.advanceTimersByTimeAsync(250);
    await assertion;
  });
});

function rejectWhenAborted(signal: AbortSignal | null): Promise<Response> {
  return new Promise((_resolve, reject) => {
    const rejectAbort = () =>
      reject(signal?.reason ?? new DOMException("Request aborted", "AbortError"));
    if (signal?.aborted) rejectAbort();
    else signal?.addEventListener("abort", rejectAbort, { once: true });
  });
}
