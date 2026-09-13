/**
 * What comes back off the wire is either the Java envelope or a failure.
 *
 * The bug these pin down: a JSON parse error used to be swallowed into
 * `{ status: 200, body: null }`, which `readEnvelope` then read as
 * `code = 200` — so an nginx HTML error page, a Front Door 502 page or a
 * body-less 200 all reported a SUCCESSFUL business response, and a login
 * "succeeded" with no token. Nothing that is not a JSON object may reach
 * the envelope reader.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthTransportError, createFetchTransport, isJsonObject } from "./transport";

function respondWith(body: string, init?: ResponseInit) {
  return vi.fn(async () => new Response(body, init));
}

const GET = { method: "GET", path: "/user/new/getCode" } as const;

afterEach(() => vi.useRealTimers());

describe("auth request deadline", () => {
  it.each(["headers", "body"])(
    "releases a request stalled at %s without resending it",
    async (stage) => {
      vi.useFakeTimers();
      const never = new Promise<never>(() => undefined);
      let signal: AbortSignal | null | undefined;
      const fetchImpl = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
        signal = init?.signal;
        const response = new Response();
        vi.spyOn(response, "text").mockReturnValue(never);
        return stage === "headers" ? never : Promise.resolve(response);
      });
      const transport = createFetchTransport({ fetchImpl });
      let outcome = "pending";
      void transport.request(GET).then(
        () => {
          outcome = "success";
        },
        (error: unknown) => {
          outcome = error instanceof AuthTransportError ? error.reason : "unexpected";
        }
      );
      await vi.advanceTimersByTimeAsync(30_000);
      expect(outcome).toBe("network");
      expect(signal?.aborted).toBe(true);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it("cleans up its deadline after success or invalid response", async () => {
    vi.useFakeTimers();
    for (const body of ['{"code":200}', "not-json"]) {
      let signal: AbortSignal | null | undefined;
      const transport = createFetchTransport({
        fetchImpl: (_url, init) => {
          signal = init?.signal;
          return Promise.resolve(new Response(body));
        },
      });
      await transport.request(GET).catch(() => undefined);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(signal?.aborted).toBe(false);
    }
  });
});

describe("createFetchTransport", () => {
  it("returns the parsed envelope on a normal response", async () => {
    const fetchImpl = respondWith(JSON.stringify({ code: 200, msg: "ok" }));
    const transport = createFetchTransport({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(transport.request(GET)).resolves.toEqual({
      status: 200,
      body: { code: 200, msg: "ok" },
    });
  });

  it("fails an HTML error page served with a 200", async () => {
    const fetchImpl = respondWith("<html><body>502 Bad Gateway</body></html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    const transport = createFetchTransport({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(transport.request(GET)).rejects.toMatchObject({
      name: "AuthTransportError",
      reason: "invalid_response",
      status: 200,
    });
  });

  it("fails an empty body", async () => {
    const fetchImpl = respondWith("", { status: 200 });
    const transport = createFetchTransport({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(transport.request(GET)).rejects.toBeInstanceOf(AuthTransportError);
  });

  it("fails a 204 with no content", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    const transport = createFetchTransport({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(transport.request(GET)).rejects.toMatchObject({ reason: "invalid_response" });
  });

  it("fails valid JSON that is not an envelope object", async () => {
    for (const body of ["null", "[]", '"ok"', "7", "true"]) {
      const fetchImpl = respondWith(body, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      const transport = createFetchTransport({ fetchImpl: fetchImpl as unknown as typeof fetch });
      await expect(transport.request(GET), body).rejects.toMatchObject({
        reason: "invalid_response",
      });
    }
  });

  it("reports an unreachable server separately from an unreadable one", async () => {
    const fetchImpl = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    const transport = createFetchTransport({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(transport.request(GET)).rejects.toMatchObject({ reason: "network" });
  });

  it("reports a connection dropped mid-body as network, not as bad bytes", async () => {
    // Headers arrived, the body did not — flaky mobile, or a proxy
    // killing an in-flight response. Calling that `invalid_response`
    // tells the user "the server sent something we couldn't read" and
    // sends them hunting a server bug instead of their own signal.
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"code":2'));
        controller.error(new TypeError("network error"));
      },
    });
    const fetchImpl = vi.fn(async () => new Response(stream, { status: 200 }));
    const transport = createFetchTransport({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(transport.request(GET)).rejects.toMatchObject({ reason: "network" });
  });

  it("still calls a body that ARRIVED and is not JSON unreadable", async () => {
    const fetchImpl = respondWith("{ not json", { status: 200 });
    const transport = createFetchTransport({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(transport.request(GET)).rejects.toMatchObject({ reason: "invalid_response" });
  });

  it("still surfaces a real error envelope on a non-2xx status", async () => {
    // Java answers business failures inside HTTP 200, but a genuine 500
    // with a JSON envelope must reach `readEnvelope`, not be discarded.
    const fetchImpl = respondWith(JSON.stringify({ code: 500, msg: "系统繁忙" }), { status: 500 });
    const transport = createFetchTransport({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(transport.request(GET)).resolves.toMatchObject({
      status: 500,
      body: { code: 500, msg: "系统繁忙" },
    });
  });

  it("puts query params on the URL and honours the path resolver", async () => {
    const fetchImpl = respondWith(JSON.stringify({ code: 200 }));
    const transport = createFetchTransport({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      resolvePath: (path) => `/content${path}`,
      headers: () => ({ "accept-language": "zh-CN" }),
    });
    await transport.request({ ...GET, query: { type: "phone", account: "13800138000" } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost/content/user/new/getCode?type=phone&account=13800138000");
    expect(init.credentials).toBe("include");
    expect(init.headers).toMatchObject({ "accept-language": "zh-CN" });
  });
});

describe("isJsonObject", () => {
  it("accepts only a plain object", () => {
    expect(isJsonObject({})).toBe(true);
    expect(isJsonObject({ code: 200 })).toBe(true);
    expect(isJsonObject(null)).toBe(false);
    expect(isJsonObject([])).toBe(false);
    expect(isJsonObject("{}")).toBe(false);
    expect(isJsonObject(undefined)).toBe(false);
  });
});
