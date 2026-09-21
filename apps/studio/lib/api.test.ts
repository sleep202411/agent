import { afterEach, describe, expect, it, vi } from "vitest";
import { api, messageFromHttpErrorBody, setApiWorkspaceId } from "./api";

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

it.each([
  new Headers({ "X-Fizz-Workspace-ID": "explicit", "Content-Type": "custom/type" }),
  [
    ["X-Fizz-Workspace-ID", "explicit"],
    ["Content-Type", "custom/type"],
  ] as [string, string][],
  { "X-Fizz-Workspace-ID": "explicit", "Content-Type": "custom/type" },
])("preserves explicit HeadersInit values and existing query/fragment", async (headers) => {
  setApiWorkspaceId("ambient");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ code: 200, data: null }),
    })
  );
  await api.post("/aurora/test?keep=1&replace=old#section", {
    headers,
    params: { replace: "new", add: "two words" },
    data: new FormData(),
  });
  expect(vi.mocked(fetch).mock.calls[0]![0]).toBe(
    "/aurora/test?keep=1&replace=new&add=two+words#section"
  );
  const sent = new Headers(vi.mocked(fetch).mock.calls[0]![1]?.headers);
  expect(sent.get("x-fizz-workspace-id")).toBe("explicit");
  expect(sent.get("content-type")).toBe("custom/type");
});
it.each([204, 205])("accepts an empty %i success without JSON decoding", async (status) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
  await expect(api.delete("/aurora/test")).resolves.toBeUndefined();
});
it("rejects pre-cancelled dispatch before invoking fetch", async () => {
  vi.stubGlobal("fetch", vi.fn());
  const controller = new AbortController();
  controller.abort();
  await expect(api.get("/aurora/test", { signal: controller.signal })).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(fetch).not.toHaveBeenCalled();
});
it.each([200, 401])("suppresses a delayed %i body after cancellation", async (status) => {
  const dispatchEvent = vi.fn();
  vi.stubGlobal("window", { location: { pathname: "/en-US" }, dispatchEvent });
  const controller = new AbortController();
  let finish!: (value: unknown) => void;
  const read = () =>
    new Promise((r) => {
      finish = r;
    });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: status === 200, status, json: read, text: read })
  );
  const pending = api.get("/aurora/test", { signal: controller.signal });
  const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await Promise.resolve();
  controller.abort();
  finish(status === 200 ? { code: 200, data: "old" } : '{"message":"old session"}');
  await assertion;
  expect(dispatchEvent).not.toHaveBeenCalled();
});
it("classifies a stalled body as timeout while preserving active unauthorized notifications", async () => {
  vi.useFakeTimers();
  const dispatchEvent = vi.fn();
  vi.stubGlobal("window", { location: { pathname: "/en-US" }, dispatchEvent });
  vi.stubGlobal(
    "fetch",
    vi.fn((_url, init) =>
      Promise.resolve({
        ok: false,
        status: 401,
        text: () => rejectWhenAborted(init?.signal ?? null),
      })
    )
  );
  const pending = api.get("/aurora/test", { timeout: 250 });
  const assertion = expect(pending).rejects.toMatchObject({
    message: "Request timed out",
    code: "NETWORK_ERROR",
  });
  await vi.advanceTimersByTimeAsync(250);
  await assertion;
  expect(dispatchEvent).not.toHaveBeenCalled();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: () => Promise.resolve('{"message":"Session expired"}'),
    })
  );
  await expect(api.get("/aurora/test")).rejects.toMatchObject({
    status: 401,
    message: "Session expired",
  });
  expect(dispatchEvent).toHaveBeenCalledTimes(1);
});
it("does not dump Cloudflare HTML as the error message", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 524,
      text: () =>
        Promise.resolve(
          `<html><body class="font-semibold">Ray ID</body><a href="https://www.cloudflare.com/5xx-error-landing?utm_source=errorcode_524">Cloudflare</a></html>`
        ),
    })
  );
  await expect(api.post("/api/user/video/moderation/ai/result")).rejects.toMatchObject({
    status: 524,
    message: "The request timed out at the gateway (HTTP 524). The upstream job may still finish.",
  });
});
it("summarizes gateway HTML without a Cloudflare error code", () => {
  expect(messageFromHttpErrorBody(502, "<html><body>Bad gateway</body></html>", "HTTP 502")).toBe(
    "The gateway returned HTTP 502. Try again."
  );
});
