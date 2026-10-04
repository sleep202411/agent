import { expect, it, vi } from "vitest";
import Page from "./page";
const state = vi.hoisted(() => ({ locale: "en-US", redirect: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-locale": state.locale }) }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => state.redirect(url) }));
it.each(["en-US", "zh-CN", "zh-HK", "invalid"])(
  "takes old feedback links to tasks (%s)",
  async (locale) => {
    state.locale = locale;
    await Page();
    expect(state.redirect).toHaveBeenLastCalledWith(
      `/${locale === "invalid" ? "en-US" : locale}/crews/tasks`
    );
  }
);
