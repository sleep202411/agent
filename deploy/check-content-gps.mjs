import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

// Read-only feature check: no AI analysis, geocoding or production writes.
// This verifies configuration and catalogue responses, not browser map rendering.
export async function checkContentGps(origin, region, fetcher = fetch) {
  const base = new URL(origin);
  if (
    !["cn", "global"].includes(region) ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash ||
    (base.protocol !== "https:" &&
      !(base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname)))
  )
    throw new Error("Use an HTTPS site origin and region cn or global.");
  async function request(path, options = {}) {
    const response = await fetcher(new URL(`/aurora/${path}`, base), {
      ...options,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(`${path}: HTTP ${response.status}; check regional Server configuration.`);
    const body = await response.json();
    if (body.code !== 200 || !body.data) throw new Error(`${path}: invalid response envelope.`);
    return body.data;
  }
  const config = await request("ip-commerce/content-gps-map/config");
  if (
    typeof config.key !== "string" ||
    !config.key.trim() ||
    (region === "global" &&
      (config.provider !== "google" || typeof config.mapId !== "string" || !config.mapId.trim())) ||
    (region === "cn" &&
      (config.provider !== "gaode" ||
        config.securityProxyPath !== "/aurora/ip-commerce/content-gps-map/_AMapService"))
  )
    throw new Error("Map configuration does not match the selected region.");
  const requestId = randomUUID();
  const result = await request("ip-commerce/content-gps/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      requestId,
      query: {
        schemaVersion: 1,
        locale: region === "cn" ? "zh-CN" : "en-US",
        location: null,
        era: null,
        duration: null,
        genreCodes: [],
        moodPreferences: [],
      },
      map: {
        coordinateSystem: region === "cn" ? "GCJ02" : "WGS84",
        west: -180,
        east: 180,
        south: -80,
        north: 80,
      },
    }),
  });
  if (
    result.requestId !== requestId ||
    !Array.isArray(result.items) ||
    !Number.isInteger(result.matchedCount)
  )
    throw new Error("Catalogue search returned an invalid result.");
  return { provider: config.provider, matchedCount: result.matchedCount };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [origin, region] = process.argv.slice(2);
  try {
    const result = await checkContentGps(origin, region);
    console.log(
      `Content GPS configuration and public search passed (${result.provider}; ${result.matchedCount} matching IPs). Browser map rendering still requires verification.`
    );
  } catch (error) {
    console.error(`Content GPS not ready: ${error.message}`);
    process.exitCode = 1;
  }
}
