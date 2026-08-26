import { describe, expect, it } from "vitest";
import { STORY_AUTHORING_STAGE_KEYS } from "@repo/shared/story-agent";
import enUS from "@/messages/en-US.json";
import zhCN from "@/messages/zh-CN.json";
import zhHK from "@/messages/zh-HK.json";

const LOCALES = [
  ["en-US", enUS],
  ["zh-CN", zhCN],
  ["zh-HK", zhHK],
] as const;

describe("story authoring stage messages", () => {
  it.each(LOCALES)("covers every pipeline stage in %s", (_locale, messages) => {
    const { activity, stages } = messages.storyStudio.authoringRun;

    for (const stage of STORY_AUTHORING_STAGE_KEYS) {
      expect((stages as Record<string, string>)[stage]?.trim(), `stages.${stage}`).toBeTruthy();
      expect((activity as Record<string, string>)[stage]?.trim(), `activity.${stage}`).toBeTruthy();
    }
  });
});
