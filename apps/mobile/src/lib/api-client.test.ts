import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api, setApiTokenProvider, setUnauthorizedHandler } from "./api-client";
vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("@/config", () => ({
  appEnv: {
    appVariant: "production",
    api: {
      contentBaseUrl: "https://fixture.invalid",
      studioBaseUrl: "https://fixture.invalid",
      auroraBaseUrl: "https://fixture.invalid",
    },
  },
}));
vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "en-US" }));
const fetchMock = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  setApiTokenProvider(undefined);
  setUnauthorizedHandler(undefined);
});
afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("sends PATCH updates as JSON and does not retry conflicts", async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ message: "Version conflict" }), { status: 409 })
  );
  await expect(
    api.patch("/creator-services/s", {
      service: "aurora",
      data: { title: "Film", expectedVersion: 3 },
    })
  ).rejects.toMatchObject({ status: 409 });
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0][1]).toMatchObject({
    method: "PATCH",
    body: JSON.stringify({ title: "Film", expectedVersion: 3 }),
  });
});
it("preserves no active authoring run through the actual API lookup", async () => {
  const { getActiveStoryAgentRun } = await import("@/features/agent/api/story-agent-runs-api");
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 200, data: null })));
  await expect(getActiveStoryAgentRun("project-1", null)).resolves.toBeNull();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each([
  { data: null, info: { id: "fallback" } },
  { info: null, path: "fallback" },
  { path: null },
])("preserves the explicit primary payload: %j", async (payload) => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: 200, ...payload })));
  await expect(api.get("/user/test")).resolves.toBeNull();
});

it.each([false, 0, "", [], { id: "valid" }])("preserves non-null data: %j", async (data) => {
  const body = { code: 200, data };
  fetchMock.mockImplementation(async () => new Response(JSON.stringify(body)));
  await expect(api.get("/user/test")).resolves.toEqual(data);
  await expect(api.get("/user/test", { raw: true })).resolves.toEqual(body);
});

it("rejects pre-cancelled work before sending a request", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(api.get("/user/test", { signal: controller.signal })).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(fetchMock).not.toHaveBeenCalled();
});
it("cancels an unresponsive transport without retry", async () => {
  fetchMock.mockImplementation(() => new Promise(() => {}));
  const controller = new AbortController();
  const pending = api.get("/user/test", { signal: controller.signal });
  const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await assertion;
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(5000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("keeps timeout protection through body reading without retrying a mutation", async () => {
  fetchMock.mockResolvedValue({ ok: true, status: 200, text: () => new Promise(() => {}) });
  const pending = api.post("/user/test", { timeout: 50 });
  const assertion = expect(pending).rejects.toMatchObject({
    code: "NETWORK_ERROR",
    message: "Request timed out",
  });
  await vi.advanceTimersByTimeAsync(50);
  await assertion;
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
});
it("cancels retry backoff before another GET", async () => {
  fetchMock.mockRejectedValue(new Error("offline"));
  const controller = new AbortController();
  const pending = api.get("/user/test", { signal: controller.signal });
  const assertion = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(0);
  controller.abort();
  await assertion;
  await vi.advanceTimersByTimeAsync(1000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("does not expire replacement credentials on a late unauthorized response", async () => {
  let token = { name: "satoken", value: "old" };
  setApiTokenProvider(() => token);
  const unauthorized = vi.fn();
  setUnauthorizedHandler(unauthorized);
  let finish!: (value: unknown) => void;
  fetchMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const pending = api.get("/user/test");
  const assertion = expect(pending).rejects.toMatchObject({ status: 401 });
  token = { name: "satoken", value: "new" };
  finish({ ok: false, status: 401, text: () => Promise.resolve("{}") });
  await assertion;
  expect(unauthorized).not.toHaveBeenCalled();
});
it("retains current credential expiry", async () => {
  setApiTokenProvider(() => ({ name: "satoken", value: "same" }));
  const unauthorized = vi.fn();
  setUnauthorizedHandler(unauthorized);
  fetchMock.mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve("{}") });
  await expect(api.get("/user/test")).rejects.toMatchObject({ status: 401 });
  expect(unauthorized).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(500);
});

it("does not automatically retry a GET action when retries are disabled", async () => {
  fetchMock.mockRejectedValue(new Error("Response lost"));
  await expect(api.get("/user/new/getCode", { retry: false })).rejects.toMatchObject({
    code: "NETWORK_ERROR",
  });
  await vi.advanceTimersByTimeAsync(6000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1]).not.toHaveProperty("retry");
});

function successResponse() {
  return { ok: true, status: 200, text: () => Promise.resolve('{"code":200,"data":{}}') };
}
it("overrides content and language headers without case-variant duplicates", async () => {
  fetchMock.mockResolvedValue(successResponse());
  await api.post("/user/test", {
    data: { value: 1 },
    headers: {
      "Content-Type": "application/custom",
      "CONTENT-TYPE": "application/final",
      "Accept-Language": "zh-CN",
    },
  });
  const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
  expect(headers["content-type"]).toBe("application/final");
  expect(headers["accept-language"]).toBe("zh-CN");
  expect(Object.keys(headers).filter((key) => key.toLowerCase() === "content-type")).toHaveLength(
    1
  );
});
it("lets the transport supply multipart boundaries even with a mixed-case override", async () => {
  fetchMock.mockResolvedValue(successResponse());
  const formData = new FormData();
  formData.append("name", "fixture");
  await api.post("/user/test", { formData, headers: { "CONTENT-Type": "application/json" } });
  expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty("content-type");
  expect(fetchMock.mock.calls[0][1].body).toBe(formData);
});
it("does not expire the active account for an overridden token header", async () => {
  setApiTokenProvider(() => ({ name: "SaToken", value: "current" }));
  const unauthorized = vi.fn();
  setUnauthorizedHandler(unauthorized);
  fetchMock.mockResolvedValue({ ok: false, status: 401, text: () => Promise.resolve("{}") });
  await expect(api.get("/user/test", { headers: { satoken: "different" } })).rejects.toMatchObject({
    status: 401,
  });
  expect(fetchMock.mock.calls[0][1].headers.satoken).toBe("different");
  expect(
    Object.keys(fetchMock.mock.calls[0][1].headers).filter((key) => key.toLowerCase() === "satoken")
  ).toHaveLength(1);
  expect(unauthorized).not.toHaveBeenCalled();
});
it("recognizes current credentials despite token header name casing changes", async () => {
  let token = { name: "SaToken", value: "current" };
  setApiTokenProvider(() => token);
  const unauthorized = vi.fn();
  setUnauthorizedHandler(unauthorized);
  let finish!: (value: unknown) => void;
  fetchMock.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const pending = api.get("/user/test");
  const assertion = expect(pending).rejects.toMatchObject({ status: 401 });
  token = { name: "satoken", value: "current" };
  finish({ ok: false, status: 401, text: () => Promise.resolve("{}") });
  await assertion;
  expect(unauthorized).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(500);
});

it.each([
  { code: 403, success: true },
  { code: 200, success: false },
])("rejects conflicting response statuses: %j", async (status) => {
  const body = { ...status, message: "Operation denied", data: { id: "untrusted" } };
  const mock = vi.fn().mockImplementation(async () => new Response(JSON.stringify(body)));
  vi.stubGlobal("fetch", mock);
  for (const raw of [false, true]) {
    await expect(api.post("/user/test", { raw })).rejects.toMatchObject({
      message: "Operation denied",
      code: status.code,
    });
  }
  expect(mock).toHaveBeenCalledTimes(2);
});

it.each([
  { success: true },
  { code: 200 },
  { code: "SUCCESS" },
  { code: 200, success: true },
  { code: "200" },
])("retains supported success responses: %j", async (status) => {
  const body = { ...status, data: { id: "accepted" } };
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => new Response(JSON.stringify(body)))
  );
  await expect(api.get("/user/test")).resolves.toEqual(body.data);
  await expect(api.get("/user/test", { raw: true })).resolves.toEqual(body);
});

it("retains unauthorized handling when success conflicts with code 401", async () => {
  const { setUnauthorizedHandler } = await import("./api-client");
  const handler = vi.fn();
  setUnauthorizedHandler(handler);
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ code: 401, success: true, message: "Sign in again" }))
      )
  );
  try {
    await expect(api.post("/user/test")).rejects.toMatchObject({
      status: 401,
      message: "Sign in again",
    });
    expect(handler).toHaveBeenCalledTimes(1);
  } finally {
    setUnauthorizedHandler(undefined);
  }
});

it("downloads binary responses with the named session header and no JSON decoding", async () => {
  setApiTokenProvider(() => ({ name: "satoken", value: "session" }));
  fetchMock.mockResolvedValue(
    new Response(new Uint8Array([80, 75, 3, 4]), {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": 'attachment; filename="report.xlsx"',
      },
    })
  );
  const result = await api.post<import("./api-client").ApiBinaryResponse>("/api/report", {
    responseType: "binary",
    data: { id: 1 },
  });
  expect([...new Uint8Array(result.bytes)]).toEqual([80, 75, 3, 4]);
  expect(result.disposition).toContain("report.xlsx");
  expect(fetchMock.mock.calls[0][1].headers.satoken).toBe("session");
  expect(fetchMock.mock.calls[0][1]).not.toHaveProperty("responseType");
});
it("preserves Java authentication errors on binary endpoints", async () => {
  const handler = vi.fn();
  setUnauthorizedHandler(handler);
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ code: 401, msg: "Session expired" }), {
      headers: { "content-type": "application/json" },
    })
  );
  await expect(api.post("/api/report", { responseType: "binary" })).rejects.toMatchObject({
    status: 401,
    message: "Session expired",
  });
  expect(handler).toHaveBeenCalledOnce();
});
it("rejects success JSON instead of returning it as a file", async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ code: 200, data: {} }), {
      headers: { "content-type": "application/json" },
    })
  );
  await expect(api.post("/api/report", { responseType: "binary" })).rejects.toMatchObject({
    code: "INVALID_DOWNLOAD",
  });
});
it("keeps binary body reads inside the cancellation window", async () => {
  const controller = new AbortController();
  fetchMock.mockResolvedValue({
    ok: true,
    headers: new Headers(),
    arrayBuffer: () => new Promise(() => {}),
  });
  const request = api.post("/api/report", { responseType: "binary", signal: controller.signal });
  const checked = expect(request).rejects.toMatchObject({ name: "AbortError" });
  await Promise.resolve();
  controller.abort();
  await checked;
  expect(fetchMock).toHaveBeenCalledOnce();
});

it.each(["<html><body>App fallback</body></html>", "{broken", "OK"])(
  "rejects non-JSON success payloads without treating them as empty data: %s",
  async (payload) => {
    fetchMock.mockImplementation(
      async () => new Response(payload, { status: 200, headers: { "content-type": "text/html" } })
    );
    await expect(api.get("/ip-commerce/ips", { service: "aurora" })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      status: 200,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(api.post("/user/save", { data: { name: "Alice" } })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }
);
it.each(["literal", 42, false, null, []])(
  "preserves valid top-level JSON including primitives: %j",
  async (value) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(value)));
    await expect(api.get("/user/test")).resolves.toEqual(value);
  }
);
it("preserves successful empty responses and structured upstream errors", async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await expect(api.delete("/user/item")).resolves.toBeNull();
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ code: 409, message: "The version changed" }), { status: 409 })
  );
  await expect(api.post("/user/save")).rejects.toMatchObject({
    status: 409,
    message: "The version changed",
  });
});

it.each([202, "202"])(
  "unwraps an Aurora HTTP 202 generation receipt with code %s",
  async (code) => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ code, data: { id: "generation" } }), { status: 202 })
    );
    await expect(
      api.post("/story-projects/p/chapters/c/storyboard/sequences/s/clips/k/generations", {
        service: "aurora",
        data: { expectedVersion: 1 },
        retry: false,
      })
    ).resolves.toEqual({ id: "generation" });
    expect(fetchMock).toHaveBeenCalledOnce();
  }
);
it.each([
  { service: "content" as const, status: 202, success: true },
  { service: "studio" as const, status: 202, success: true },
  { service: "aurora" as const, status: 200, success: true },
  { service: "aurora" as const, status: 202, success: false },
])("rejects nonmatching or unsuccessful 202 envelopes %j", async ({ service, status, success }) => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ code: 202, success, message: "Rejected", data: { id: "bad" } }), {
      status,
    })
  );
  await expect(api.post("/test", { service, retry: false })).rejects.toMatchObject({
    message: "Rejected",
  });
});

it.each(["message", "msg"])(
  "preserves upstream %s validation lists through certificate verification",
  async (field) => {
    const { verifyCertificate } = await import("@/features/certificates/verify-api");
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          [field]: ["Certificate number is invalid", null, 123, "", "Issuer is required"],
        }),
        { status: 400 }
      )
    );
    await expect(
      verifyCertificate("FD-OPC-2605-8K3Q7P", new AbortController().signal)
    ).rejects.toMatchObject({
      status: 400,
      message: "Certificate number is invalid; Issuer is required",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  }
);
it("preserves validation lists in rejected HTTP-success envelopes", async () => {
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({ code: 400, message: ["Name is required", "Deadline is invalid"] })
    )
  );
  await expect(api.post("/user/test", { retry: false })).rejects.toMatchObject({
    code: 400,
    message: "Name is required; Deadline is invalid",
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("keeps a useful fallback when a validation list has no message strings", async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ message: [null, 123, {}, "  "] }), { status: 400 })
  );
  await expect(
    api.get("/certificates/verify", { service: "aurora", retry: false })
  ).rejects.toMatchObject({ message: "HTTP 400" });
});
