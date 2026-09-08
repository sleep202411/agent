import { afterEach, expect, it, vi } from "vitest";
import { formatCrewMoney, parseCrewMoney, formatCrewMoneyInput } from "./crew-money";
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

it.each([
  ["0", "0"],
  ["0.01", "1"],
  ["10.29", "1029"],
  ["92233720368547758.07", "9223372036854775807"],
])("parses %s exactly and round-trips to display units", (value, amount) => {
  expect(parseCrewMoney(value)).toBe(amount);
  expect(parseCrewMoney(formatCrewMoneyInput(amount))).toBe(amount);
});
it.each(["", "-1", "1.001", "1e2", "1,000", "NaN", "01", "92233720368547758.08"])(
  "rejects an invalid or overflowing monetary input: %s",
  (input) => {
    expect(parseCrewMoney(input)).toBeNull();
  }
);
