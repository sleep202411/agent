import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ locale: null as string | null }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(state.locale ? { "x-locale": state.locale } : {}),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import WorkbenchPage from "./page";

it.each(["en-US", "zh-CN", "zh-HK"])(
  "opens persisted notifications for old %s workbench bookmarks",
  async (locale) => {
    state.locale = locale;
    await expect(WorkbenchPage()).rejects.toThrow(`REDIRECT:/${locale}/messages?tab=notifications`);
  }
);

it.each([null, "invalid"])(
  "uses the default locale when the route header is %s",
  async (locale) => {
    state.locale = locale;
    await expect(WorkbenchPage()).rejects.toThrow("REDIRECT:/en-US/messages?tab=notifications");
  }
);
