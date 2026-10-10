// @vitest-environment node
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const mobileRoot = fileURLToPath(new URL("../../", import.meta.url));
function cacheVersion(overrides: Record<string, string> = {}) {
  return execFileSync(
    process.execPath,
    ["-e", 'console.log(require("./metro.config.js").cacheVersion)'],
    {
      cwd: mobileRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        FD_APP_REGION: "global",
        APP_VARIANT: "production",
        FD_GLOBAL_IOS_BUNDLE_IDENTIFIER: "com.fizzdragon.app",
        FD_GLOBAL_ANDROID_PACKAGE: "com.fizzdragon",
        FD_CN_IOS_BUNDLE_IDENTIFIER: "cn.fizzspaceapp",
        FD_CN_ANDROID_PACKAGE: "cn.feiteng.fizzspace",
        ...overrides,
      },
    }
  ).trim();
}

it("separates actual Metro transforms by region, variant and resolved API config", () => {
  const global = cacheVersion();
  expect(cacheVersion()).toBe(global);
  expect(cacheVersion({ FD_APP_REGION: "cn" })).not.toBe(global);
  expect(cacheVersion({ APP_VARIANT: "preview" })).not.toBe(global);
  expect(
    cacheVersion({ EXPO_PUBLIC_API_AURORA_BASE_URL: "https://api.example.test/aurora" })
  ).not.toBe(global);
}, 30000);
