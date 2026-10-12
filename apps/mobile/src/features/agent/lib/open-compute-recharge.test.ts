import { afterEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  open: vi.fn(),
  alert: vi.fn(),
  locale: "zh-CN" as "en-US" | "zh-CN" | "zh-HK",
}));

vi.mock("@/config", () => ({ webBaseUrl: "https://fizzdragon.com" }));
vi.mock("@/i18n", () => ({
  getLocale: () => h.locale,
  t: (key: string) => key,
}));
vi.mock("react-native", () => ({
  Linking: { openURL: h.open },
  Alert: { alert: h.alert },
}));

import { computeRechargeWebUrl, openComputeRecharge } from "./open-compute-recharge";

afterEach(() => {
  h.open.mockReset();
  h.alert.mockReset();
  h.locale = "zh-CN";
});

it("builds the regional FizzDragon membership page for the current locale", () => {
  expect(computeRechargeWebUrl("zh-CN")).toBe("https://fizzdragon.com/zh-CN/membership");
  h.locale = "en-US";
  expect(computeRechargeWebUrl()).toBe("https://fizzdragon.com/en-US/membership");
});

it("asks before opening the page, and cancel stays in the app", async () => {
  h.open.mockResolvedValue(undefined);
  openComputeRecharge();
  expect(h.open).not.toHaveBeenCalled();
  expect(h.alert).toHaveBeenCalledOnce();
  const [, , buttons] = h.alert.mock.calls[0] as [
    string,
    string,
    { text: string; style?: string; onPress?: () => void }[],
  ];
  expect(buttons.map((button) => button.text)).toEqual([
    "common.cancel",
    "agent.credits.webRechargeOpen",
  ]);
  expect(buttons[0]?.style).toBe("cancel");
  expect(buttons[0]?.onPress).toBeUndefined();

  buttons[1]?.onPress?.();
  expect(h.open).toHaveBeenCalledExactlyOnceWith("https://fizzdragon.com/zh-CN/membership");
  await Promise.resolve();
  expect(h.alert).toHaveBeenCalledOnce();
});

it("keeps the explanation when the browser cannot open", async () => {
  h.open.mockRejectedValue(new Error("unavailable"));
  openComputeRecharge();
  const buttons = h.alert.mock.calls[0]?.[2] as { onPress?: () => void }[];
  buttons[1]?.onPress?.();
  await Promise.resolve();
  expect(h.alert).toHaveBeenLastCalledWith(
    "agent.credits.webRechargeTitle",
    "agent.credits.webRechargeBody"
  );
});
