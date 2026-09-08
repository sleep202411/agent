import { afterEach, expect, it, vi } from "vitest";
import { formatCrewMoney } from "./crew-money";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
it.each(["en-US", "zh-CN", "zh-HK"])(
  "preserves the specified currency and exact minor units in %s",
  (locale) => {
    expect(formatCrewMoney("125", locale, "CNY")).toBe("CNY 1.25");
    expect(formatCrewMoney("125", locale, "USD")).toBe("USD 1.25");
    expect(formatCrewMoney("-1", locale, "CNY")).toBe("CNY -0.01");
    expect(formatCrewMoney("9223372036854775807", locale, "USD").replaceAll(",", "")).toBe(
      "USD 92233720368547758.07"
    );
  }
);
it.each([
  ["cn", "CNY"],
  ["global", "USD"],
  ["com", "USD"],
])("uses deployment %s rather than interface language", async (region, currency) => {
  vi.stubEnv("NEXT_PUBLIC_SITE_REGION", region);
  vi.resetModules();
  expect((await import("./crew-money")).CREW_CURRENCY).toBe(currency);
});
it("keeps historical points unconverted", () =>
  expect(formatCrewMoney("125", "en-US", "POINTS")).toBe("125"));
