import { afterEach, describe, expect, it, vi } from "vitest";
import { api, setApiWorkspaceId } from "./api";

afterEach(() => {
  setApiWorkspaceId(null);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("studio API client", () => {
  it("does not inherit the ambient Workspace header for a project-scoped request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ code: 200, data: { id: "project-1" } }),
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    setApiWorkspaceId("workspace-1");

    await api.get("/aurora/story-projects/project-1", { requestScope: "project" });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(new Headers(request?.headers).get("x-fizz-workspace-id")).toBeNull();
  });

  it("continues inheriting the ambient Workspace header for legacy requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ code: 200, data: [] }),
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    setApiWorkspaceId("workspace-1");

    await api.get("/aurora/workspaces/workspace-1/projects");

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(new Headers(request?.headers).get("x-fizz-workspace-id")).toBe("workspace-1");
  });

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

  it("preserves an explicit null envelope payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ code: 200, data: null }),
      } as unknown as Response)
    );

    await expect(api.get("/aurora/empty-resource")).resolves.toBeNull();
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
