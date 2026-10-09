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
