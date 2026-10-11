import { expect, it, vi } from "vitest";
import { textGameShareUrl } from "./text-game-share";
vi.mock("@/config", () => ({ webBaseUrl: "https://fizzdragon.fizzspace.cn" }));
it("shares the selected region and locale without private session identifiers", () => {
  expect(textGameShareUrl("tg_0123456789abcdef", "zh-CN")).toBe(
    "https://fizzdragon.fizzspace.cn/zh-CN/play/text-game/tg_0123456789abcdef"
  );
});
it("rejects unrecognized locales and malformed IDs", () => {
  expect(() => textGameShareUrl("../private", "en-US")).toThrow();
  expect(() => textGameShareUrl("tg_0123456789abcdef", "../private")).toThrow();
});
