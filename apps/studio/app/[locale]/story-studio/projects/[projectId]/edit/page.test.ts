import { describe, expect, it, vi } from "vitest";
import enUS from "@/messages/en-US.json";
import zhCN from "@/messages/zh-CN.json";
import zhHK from "@/messages/zh-HK.json";
import { generateMetadata } from "./page";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

vi.mock("../../../_components/story-timeline-editor-view", () => ({
  StoryTimelineEditorView: () => null,
}));

describe("Editor page metadata", () => {
  it("uses the localized editor metadata namespace", async () => {
    await expect(generateMetadata()).resolves.toEqual({
      title: "storyStudio.editorPage.pageTitle",
      description: "storyStudio.editorPage.pageDescription",
    });
  });

  it.each([
    ["en-US", enUS.storyStudio.editorPage],
    ["zh-CN", zhCN.storyStudio.editorPage],
    ["zh-HK", zhHK.storyStudio.editorPage],
  ])("provides title and description in %s", (_locale, messages) => {
    expect(messages.pageTitle).toBeTruthy();
    expect(messages.pageDescription).toBeTruthy();
  });
});
