import { redirectSystemPath } from "@/app/+native-intent";
import { expect, it, vi } from "vitest";
import { redirectGpsSearch } from "./search-link";
vi.mock("expo-constants", () => ({ default: { expoConfig: { scheme: "fizzdragon-dev" } } }));
vi.mock("@/config/app-env", () => ({ appEnv: { appRegion: "global" } }));
it.each(["global", "cn"] as const)(
  "preserves GPS conditions across regional %s links",
  (region) => {
    const host = region === "cn" ? "fizzdragon.fizzspace.cn" : "fizzdragon.com";
    const query =
      "?place=SG%3Asingapore&place=MY%3Ajohor&from=-100&to=0&seconds=120&selected=123&genre=drama&genre=action";
    for (const locale of ["", "en-US/", "zh-CN/", "zh-HK/"]) {
      for (const suffix of ["", "/"]) {
        for (const base of [
          `/${locale}ips/gps`,
          `https://${host}/${locale}ips/gps`,
          `fizzdragon-dev://${locale}ips/gps`,
        ])
          expect(redirectGpsSearch(base + suffix + query, region, ["fizzdragon-dev"])).toBe(
            "/content-gps" + query
          );
      }
    }
    // Preserve even invalid/repeated values for the screen to reject, never silently broaden.
    expect(redirectGpsSearch("/ips/gps?selected=a&selected=b", region, [])).toBe(
      "/content-gps?selected=a&selected=b"
    );
  }
);
it("does not consume foreign-site, unsafe or unrelated callbacks", () => {
  for (const path of [
    "https://fizzdragon.fizzspace.cn/ips/gps",
    "https://evil.test/ips/gps",
    "http://fizzdragon.com/ips/gps",
    "https://user@fizzdragon.com/ips/gps",
    "https://fizzdragon.com:444/ips/gps",
    "//fizzdragon.com/ips/gps",
    "/ips/gps#section",
    "/ips/gps/other",
    "/ips/\\gps",
    "fizzdragon://ips/gps",
    "wxpay://callback?code=a",
    "/agent?workspace=a",
    "/ips/%67ps",
  ])
    expect(redirectGpsSearch(path, "global", ["fizzdragon-dev"])).toBe(path);
});
it("routes through the actual native intent chain without disturbing other routes", () => {
  for (const initial of [true, false]) {
    expect(
      redirectSystemPath({
        path: "https://fizzdragon.com/zh-CN/ips/gps?from=0&selected=a",
        initial,
      })
    ).toBe("/content-gps?from=0&selected=a");
    expect(redirectSystemPath({ path: "fizzdragon-dev://content-gps?from=0", initial })).toBe(
      "/content-gps?from=0"
    );
    expect(redirectSystemPath({ path: "/creators/studios?remote=1", initial })).toBe(
      "/studios?remote=1"
    );
    expect(redirectSystemPath({ path: "wxpay://callback?code=a", initial })).toBe(
      "wxpay://callback?code=a"
    );
  }
});
