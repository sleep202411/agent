import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "./api-client";
const runtime = vi.hoisted(() => ({
  platform: { OS: "web" },
  variant: "preview",
  region: "global",
}));
vi.mock("react-native", () => ({ Platform: runtime.platform }));
vi.mock("@/config", () => ({
  appEnv: {
    get appVariant() {
      return runtime.variant;
    },
    get api() {
      return {
        contentBaseUrl: `https://content.${runtime.region}.test`,
        studioBaseUrl: `https://studio.${runtime.region}.test`,
        auroraBaseUrl: `https://app.${runtime.region}.test/aurora`,
      };
    },
  },
}));
vi.mock("@/i18n/locale-store", () => ({ getLocale: () => "en-US" }));
const fetchMock = vi.fn();
beforeEach(() => {
  runtime.platform.OS = "web";
  runtime.variant = "preview";
  runtime.region = "global";
  fetchMock.mockReset();
  fetchMock.mockImplementation(
    async () => new Response(JSON.stringify({ code: 200, data: { ok: true } }))
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());
it.each(["global", "cn"])(
  "routes static preview and production to the %s service origins",
  async (region) => {
    runtime.region = region;
    for (const variant of ["preview", "production"]) {
      runtime.variant = variant;
      await api.get("/ip-commerce/ips", { service: "aurora", params: { limit: 5 } });
      expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
        `https://app.${region}.test/aurora/ip-commerce/ips?limit=5`
      );
      await api.get("/user/info");
      expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(`https://content.${region}.test/user/info`);
      await api.get("/api/project/list");
      expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(
        `https://studio.${region}.test/api/project/list`
      );
    }
  }
);
it("uses the Expo server proxy only in local web development", async () => {
  runtime.variant = "development";
  await api.get("/ip-commerce/ips", { service: "aurora", params: { limit: 5 } });
  expect(fetchMock.mock.calls[0][0]).toBe("/_mobile-api/aurora/ip-commerce/ips?limit=5");
  await api.get("https://external.test/data");
  expect(fetchMock.mock.calls[1][0]).toBe("https://external.test/data");
});
it.each(["ios", "android"])(
  "keeps direct regional routing on %s in every variant",
  async (platform) => {
    runtime.platform.OS = platform;
    for (const region of ["global", "cn"]) {
      runtime.region = region;
      for (const variant of ["development", "preview", "production"]) {
        runtime.variant = variant;
        await api.post("/action", { service: "aurora", data: { id: 1 } });
        expect(fetchMock.mock.calls.at(-1)?.[0]).toBe(`https://app.${region}.test/aurora/action`);
      }
    }
  }
);
