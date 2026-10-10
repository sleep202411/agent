import { createRequire } from "node:module";
import { afterEach, it, expect, vi } from "vitest";
const configure = createRequire(import.meta.url)("../../app.config.js");
afterEach(() => vi.unstubAllEnvs());
it.each(["global", "cn"])(
  "declares explicit camera/microphone permission descriptions for %s while preserving config",
  (region) => {
    vi.stubEnv("FD_APP_REGION", region);
    vi.stubEnv("APP_VARIANT", "development");
    const config = configure({
      config: {
        ios: { infoPlist: { Existing: "value" } },
        android: { permissions: ["android.permission.INTERNET", "android.permission.CAMERA"] },
      },
    });
    expect(config.ios.infoPlist.Existing).toBe("value");
    expect(config.ios.infoPlist.NSCameraUsageDescription).toContain("verify your own likeness");
    expect(config.ios.infoPlist.NSMicrophoneUsageDescription).toContain("likeness verification");
    expect(config.android.permissions).toEqual([
      "android.permission.INTERNET",
      "android.permission.CAMERA",
      "android.permission.RECORD_AUDIO",
    ]);
  }
);
