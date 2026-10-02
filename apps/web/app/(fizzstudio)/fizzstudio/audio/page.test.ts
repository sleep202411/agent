import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ locale: "en-US" }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-locale": state.locale }) }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/src/lib/region/cell", () => ({
  getStudioHref: (locale: string) => `https://studio.example/${locale}`,
}));
import { redirect } from "next/navigation";
import AudioPage from "./page";
beforeEach(() => vi.clearAllMocks());
it.each(["en-US", "zh-CN", "zh-HK"])(
  "opens the working Studio audio page in %s",
  async (locale) => {
    state.locale = locale;
    await AudioPage();
    expect(redirect).toHaveBeenCalledWith(`https://studio.example/${locale}/audio`);
  }
);
it("uses the default locale for invalid locale headers", async () => {
  state.locale = "invalid";
  await AudioPage();
  expect(redirect).toHaveBeenCalledWith("https://studio.example/en-US/audio");
});
