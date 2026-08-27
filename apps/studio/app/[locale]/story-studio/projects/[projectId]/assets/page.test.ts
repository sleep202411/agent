import { describe, expect, it, vi } from "vitest";
import enUS from "@/messages/en-US.json";
import zhCN from "@/messages/zh-CN.json";
import zhHK from "@/messages/zh-HK.json";
import { generateMetadata } from "./page";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

vi.mock("../../../_components/story-assets-gallery", () => ({
  StoryAssetsGallery: () => null,
}));

describe("Assets page metadata", () => {
  it("uses the localized Assets metadata namespace", async () => {
    await expect(generateMetadata()).resolves.toEqual({
      title: "storyStudio.assetsPage.pageTitle",
      description: "storyStudio.assetsPage.pageDescription",
    });
  });

  it.each([
    ["en-US", enUS.storyStudio.assetsPage],
    ["zh-CN", zhCN.storyStudio.assetsPage],
    ["zh-HK", zhHK.storyStudio.assetsPage],
  ])("provides title and description in %s", (_locale, messages) => {
    expect(messages.pageTitle).toBeTruthy();
    expect(messages.pageDescription).toBeTruthy();
  });
});
