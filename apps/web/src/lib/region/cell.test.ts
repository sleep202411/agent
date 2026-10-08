import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/src/env", () => ({ env: { STUDIO_HOST: "https://studio.example.test" } }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
it.each([
  ["global", "USD"],
  ["com", "USD"],
  ["cn", "CNY"],
])("%s forms expose only %s", async (region, currency) => {
  vi.stubEnv("NEXT_PUBLIC_SITE_REGION", region);
  const { allowedCurrenciesForCell, defaultCurrencyForCell } = await import("./cell");
  expect(allowedCurrenciesForCell()).toEqual([currency]);
  expect(defaultCurrencyForCell()).toBe(currency);
});
