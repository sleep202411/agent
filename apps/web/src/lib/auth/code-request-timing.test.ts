import { performance as timing } from "node:perf_hooks";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuthTransportError, type AuthRequest } from "@repo/auth-flow";
import {
  CODE_REQUEST_MEASURE,
  CODE_REQUEST_TIMING_OPT_IN,
  measureCodeRequest,
} from "./code-request-timing";
const request: AuthRequest = {
  method: "GET",
  path: "/user/new/getCode",
  query: { type: "email", account: "private@example.invalid" },
};
const result = { status: 200, body: { code: 200, msg: "private text", token: "private-token" } };
const entries = () =>
  timing.getEntriesByName(CODE_REQUEST_MEASURE, "measure") as PerformanceMeasure[];
beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (key === CODE_REQUEST_TIMING_OPT_IN ? "1" : null),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  timing.clearMeasures(CODE_REQUEST_MEASURE);
});
it("measures response completion without retaining identifiers or response data", async () => {
  const measure = vi.fn();
  vi.stubGlobal("performance", {
    now: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(260),
    getEntriesByName: () => [],
    measure,
  });
  const send = vi.fn(async () => result);
  expect(await measureCodeRequest(request, "zh-CN", send)).toBe(result);
  expect(send).toHaveBeenCalledTimes(1);
  expect(measure).toHaveBeenCalledWith(CODE_REQUEST_MEASURE, {
    start: 10,
    end: 260,
    detail: { channel: "email", flow: "sign_in", locale: "zh-CN", outcome: "accepted" },
  });
});
it.each(["email", "phone"])("measures %s resets with normalized locale", async (channel) => {
  vi.stubGlobal("performance", timing);
  await measureCodeRequest(
    { method: "GET", path: channel === "email" ? "/user/email/getCode" : "/user/getCode" },
    "private-locale",
    async () => result
  );
  expect(entries()[0].detail).toEqual({
    channel,
    flow: "password_reset",
    locale: "other",
    outcome: "accepted",
  });
});
it("uses shared envelope semantics, including HTTP-200 rejection", async () => {
  vi.stubGlobal("performance", timing);
  for (const response of [
    { status: 200, body: { code: 500 } },
    { status: 503, body: {} },
    { status: 200, body: { code: "200" } },
  ])
    expect(await measureCodeRequest(request, "en-US", async () => response)).toBe(response);
  expect(entries().map((e) => e.detail.outcome)).toEqual(["rejected", "rejected", "accepted"]);
});
it.each(["network", "invalid_response"] as const)(
  "preserves %s errors without retry",
  async (reason) => {
    vi.stubGlobal("performance", timing);
    const error = new AuthTransportError(reason);
    const send = vi.fn(async () => {
      throw error;
    });
    await expect(measureCodeRequest(request, "en-US", send)).rejects.toBe(error);
    expect(send).toHaveBeenCalledTimes(1);
    expect(entries()[0].detail.outcome).toBe(reason);
  }
);
it("ignores login, arbitrary channels and non-GET requests", async () => {
  vi.stubGlobal("performance", timing);
  for (const input of [
    { ...request, path: "/user/new/login" },
    { ...request, method: "POST" as const },
    { ...request, query: { type: "private" } },
  ])
    await measureCodeRequest(input, "en-US", async () => result);
  expect(entries()).toEqual([]);
});
it("bounds its batch without clearing unrelated entries", async () => {
  vi.stubGlobal("performance", timing);
  timing.measure("unrelated", { start: 0, end: 1 });
  for (let i = 0; i < 51; i++) await measureCodeRequest(request, "en-US", async () => result);
  expect(entries()).toHaveLength(1);
  expect(timing.getEntriesByName("unrelated")).toHaveLength(1);
  timing.clearMeasures("unrelated");
});
it("isolates unavailable or failing timing APIs", async () => {
  for (const api of [
    undefined,
    {
      now: () => 1,
      getEntriesByName: () => {
        throw Error("observer");
      },
    },
  ]) {
    vi.stubGlobal("performance", api);
    expect(await measureCodeRequest(request, "en-US", async () => result)).toBe(result);
    const error = Error("original");
    await expect(
      measureCodeRequest(request, "en-US", async () => {
        throw error;
      })
    ).rejects.toBe(error);
  }
});

it.each([null, "0"])("does not record without explicit opt-in (%s)", async (setting) => {
  vi.stubGlobal("localStorage", { getItem: () => setting });
  const measure = vi.fn();
  vi.stubGlobal("performance", { measure });
  const send = vi.fn(async () => result);
  expect(await measureCodeRequest(request, "en-US", send)).toBe(result);
  expect(send).toHaveBeenCalledTimes(1);
  expect(measure).not.toHaveBeenCalled();
});
it("preserves requests when local storage is unavailable", async () => {
  vi.stubGlobal("localStorage", {
    getItem: () => {
      throw Error("blocked");
    },
  });
  expect(await measureCodeRequest(request, "en-US", async () => result)).toBe(result);
  const error = Error("original");
  await expect(
    measureCodeRequest(request, "en-US", async () => {
      throw error;
    })
  ).rejects.toBe(error);
});
