// @vitest-environment jsdom
import { beforeEach, afterEach, it, expect, vi } from "vitest";
const host = window as unknown as Record<string, unknown>;
const google = { provider: "google" as const, key: "browser-fixture", mapId: "owned-map" };
beforeEach(() => {
  vi.resetModules();
  for (const key of ["google", "AMap", "gm_authFailure", "_AMapSecurityConfig"]) delete host[key];
  document.head.querySelectorAll("script").forEach((node) => node.remove());
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
function script() {
  return document.head.querySelector<HTMLScriptElement>("script[src]")!;
}
function complete() {
  const name = new URL(script().src).searchParams.get("callback")!;
  (host[name] as () => void)();
}
it("deduplicates concurrent SDK loads and confines keys to the configured provider endpoint", async () => {
  const { loadGpsSdk } = await import("./content-gps-map-sdk");
  const first = loadGpsSdk(google),
    second = loadGpsSdk(google);
  expect(first).toBe(second);
  expect(document.head.querySelectorAll("script[src]")).toHaveLength(1);
  const url = new URL(script().src);
  expect(url.origin).toBe("https://maps.googleapis.com");
  expect(url.searchParams.get("libraries")).toBe("marker");
  host.google = { maps: { fixture: true } };
  complete();
  await expect(first).resolves.toEqual({ fixture: true });
  await expect(loadGpsSdk({ ...google, key: "another-key" })).rejects.toThrow("conflict");
});
it("initializes Gaode with the same-origin security proxy before loading its script", async () => {
  const { loadGpsSdk } = await import("./content-gps-map-sdk");
  const promise = loadGpsSdk({
    provider: "gaode",
    key: "public-key",
    securityProxyPath: "/_AMapService",
  });
  expect(host._AMapSecurityConfig).toEqual({
    serviceHost: new URL("/_AMapService", location.origin).href,
  });
  expect(new URL(script().src).origin).toBe("https://webapi.amap.com");
  expect(script().src).not.toContain("securityJsCode");
  host.AMap = {};
  complete();
  await promise;
});
it("fails bounded loads without automatically injecting another quota-spending SDK request", async () => {
  vi.useFakeTimers();
  const { loadGpsSdk } = await import("./content-gps-map-sdk");
  const promise = loadGpsSdk(google);
  const callback = host[new URL(script().src).searchParams.get("callback")!] as () => void;
  const rejected = expect(promise).rejects.toThrow("load");
  await vi.advanceTimersByTimeAsync(15000);
  await rejected;
  callback();
  expect(loadGpsSdk(google)).toBe(promise);
  expect(document.head.querySelectorAll("script[src]")).toHaveLength(0);
});
it("propagates provider authentication failure to active maps and subsequent subscriptions", async () => {
  const { loadGpsSdk, onGoogleMapAuthFailure } = await import("./content-gps-map-sdk");
  const promise = loadGpsSdk(google);
  host.google = { maps: {} };
  complete();
  await promise;
  const first = vi.fn(),
    second = vi.fn();
  const unsubscribe = onGoogleMapAuthFailure(first);
  (host.gm_authFailure as () => void)();
  expect(first).toHaveBeenCalledTimes(1);
  unsubscribe();
  const removeSecond = onGoogleMapAuthFailure(second);
  expect(second).toHaveBeenCalledTimes(1);
  removeSecond();
});
it("rejects taking over an SDK loaded by another feature", async () => {
  host.AMap = {};
  const { loadGpsSdk } = await import("./content-gps-map-sdk");
  await expect(
    loadGpsSdk({ provider: "gaode", key: "public", securityProxyPath: "/_AMapService" })
  ).rejects.toThrow("conflict");
  expect(script()).toBeNull();
});
