import { test } from "node:test";
import assert from "node:assert/strict";
import { checkContentGps } from "./check-content-gps.mjs";

test("feature check fails on missing config and does not claim catalogue success", async () => {
  let calls = 0;
  await assert.rejects(
    checkContentGps("https://example.test", "cn", async () => {
      calls++;
      return new Response("{}", { status: 503 });
    }),
    /HTTP 503/
  );
  assert.equal(calls, 1);
});
test("feature check requires region-matched configuration and a real search response", async () => {
  const config = {
    provider: "gaode",
    key: "browser-key",
    securityProxyPath: "/aurora/ip-commerce/content-gps-map/_AMapService",
  };
  const fetcher = async (url, options) => {
    const input = options.body ? JSON.parse(options.body) : null;
    if (input) {
      assert.equal(input.map.coordinateSystem, "GCJ02");
      assert.equal(input.query.locale, "zh-CN");
      assert.match(url.pathname, /content-gps\/search$/);
    }
    return Response.json({
      code: 200,
      data: input ? { requestId: input.requestId, items: [], matchedCount: 0 } : config,
    });
  };
  assert.deepEqual(await checkContentGps("https://example.test", "cn", fetcher), {
    provider: "gaode",
    matchedCount: 0,
  });
  await assert.rejects(
    checkContentGps("https://example.test", "global", fetcher),
    /does not match/
  );
});
