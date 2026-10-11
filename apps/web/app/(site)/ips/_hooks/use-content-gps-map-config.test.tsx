// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/src/lib/api";
import { parseRuntimeMapConfig, useContentGpsMapConfig } from "./use-content-gps-map-config";

vi.mock("@/src/lib/api", () => ({ api: { get: vi.fn() } }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
});

it("rejects cross-region providers and external security proxies", () => {
  vi.stubEnv("NEXT_PUBLIC_SITE_REGION", "global");
  const google = { provider: "google", key: "public", mapId: "owned" };
  expect(parseRuntimeMapConfig(google)).toEqual(google);
  const gaode = {
    provider: "gaode",
    key: "public",
    securityProxyPath: "/aurora/ip-commerce/content-gps-map/_AMapService",
  };
  expect(() => parseRuntimeMapConfig(gaode)).toThrow("configuration");
  vi.stubEnv("NEXT_PUBLIC_SITE_REGION", "cn");
  expect(parseRuntimeMapConfig(gaode)).toEqual(gaode);
  expect(() => parseRuntimeMapConfig(google)).toThrow("configuration");
  expect(() =>
    parseRuntimeMapConfig({ ...gaode, securityProxyPath: "https://external.test" })
  ).toThrow("configuration");
});

async function readHook() {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const element = document.createElement("div");
  const root = createRoot(element);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let current: ReturnType<typeof useContentGpsMapConfig> | undefined;
  function Probe() {
    current = useContentGpsMapConfig();
    return null;
  }
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  await act(async () => root.unmount());
  client.clear();
  return current!;
}

it("loads runtime configuration when an existing Web build has no map keys", async () => {
  vi.stubEnv("NEXT_PUBLIC_SITE_REGION", "global");
  vi.stubEnv("NEXT_PUBLIC_CONTENT_GPS_MAP_ENABLED", "false");
  const config = { provider: "google", key: "public", mapId: "owned" };
  vi.mocked(api.get).mockResolvedValue(config);
  expect(await readHook()).toMatchObject({ config, error: false, loading: false });
  expect(api.get).toHaveBeenCalledWith(
    "/aurora/ip-commerce/content-gps-map/config",
    expect.objectContaining({ credentials: "omit", timeout: 10000 })
  );
});

it("reports missing server configuration without repeated retries", async () => {
  vi.stubEnv("NEXT_PUBLIC_CONTENT_GPS_MAP_ENABLED", "false");
  vi.mocked(api.get).mockRejectedValue(new Error("Map configuration missing"));
  expect(await readHook()).toMatchObject({ config: null, error: true, loading: false });
  expect(api.get).toHaveBeenCalledTimes(1);
});
