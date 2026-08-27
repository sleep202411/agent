import { describe, expect, it, vi } from "vitest";
import enUS from "@/messages/en-US.json";
import zhCN from "@/messages/zh-CN.json";
import zhHK from "@/messages/zh-HK.json";
import { generateMetadata } from "./page";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

vi.mock("../../../_components/story-storyboard-view", () => ({
  StoryStoryboardView: () => null,
}));

describe("Storyboard page metadata", () => {
  it("uses the localized Storyboard metadata namespace", async () => {
    await expect(generateMetadata()).resolves.toEqual({
      title: "storyStudio.storyboardPage.pageTitle",
      description: "storyStudio.storyboardPage.pageDescription",
    });
  });

  it.each([
    ["en-US", enUS.storyStudio.storyboardPage],
    ["zh-CN", zhCN.storyStudio.storyboardPage],
    ["zh-HK", zhHK.storyStudio.storyboardPage],
  ])("provides title and description in %s", (_locale, messages) => {
    expect(messages.pageTitle).toBeTruthy();
    expect(messages.pageDescription).toBeTruthy();
  });
});
