import { afterEach, describe, expect, it, vi } from "vitest";

import { locales } from "@/src/i18n/config";
import { createWebAuthTransport } from "./transport";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createWebAuthTransport", () => {
  it.each(locales)("adds the active path locale %s to the sign-in code request", async (locale) => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 200 }), {
          headers: { "content-type": "application/json" },
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const transport = createWebAuthTransport(locale);
    await transport.request({
      method: "GET",
      path: "/user/new/getCode",
      query: { type: "email", account: "creator@fizzdragon.com" },
    });

    const [requestUrl, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const url = new URL(requestUrl);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      type: "email",
      account: "creator@fizzdragon.com",
      locale,
    });
    expect(requestInit.headers).toMatchObject({ "accept-language": locale });
  });

  it("does not add locale to unrelated auth requests", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 200 }), {
          headers: { "content-type": "application/json" },
        })
    );
    vi.stubGlobal("fetch", fetchMock);

    const transport = createWebAuthTransport("zh-CN");
    await transport.request({
      method: "POST",
      path: "/user/new/login",
      form: { type: "email", account: "creator@fizzdragon.com", code: "123456" },
    });

    const [requestUrl] = fetchMock.mock.calls[0] as unknown as [string];
    expect(new URL(requestUrl).searchParams.has("locale")).toBe(false);
  });
});

it("records the actual code transport through body completion and preserves business errors", async () => {
  vi.stubGlobal("localStorage", { getItem: () => "1" });
  const timing = await import("node:perf_hooks");
  vi.stubGlobal("performance", timing.performance);
  const name = "fizzdragon.auth.code-request";
  timing.performance.clearMeasures(name);
  let finish!: (body: string) => void;
  const body = new Promise<string>((resolve) => {
    finish = resolve;
  });
  const fetchMock = vi.fn(async () => ({ status: 200, text: () => body }));
  vi.stubGlobal("fetch", fetchMock);
  const pending = createWebAuthTransport("en-US").request({
    method: "GET",
    path: "/user/new/getCode",
    query: { type: "phone", account: "private-phone" },
  });
  await Promise.resolve();
  expect(timing.performance.getEntriesByName(name)).toHaveLength(0);
  finish(JSON.stringify({ code: 429, msg: "Please wait" }));
  expect(await pending).toEqual({ status: 200, body: { code: 429, msg: "Please wait" } });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const measured = timing.performance.getEntriesByName(name)[0] as PerformanceMeasure;
  expect(measured.detail).toEqual({
    channel: "phone",
    flow: "sign_in",
    locale: "en-US",
    outcome: "rejected",
  });
  timing.performance.clearMeasures(name);
});
