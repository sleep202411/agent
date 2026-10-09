import { expect, it } from "vitest";
import { studioSiteRegionHref } from "./studio-site";

it("keeps locale and path when jumping between studio cells", () => {
  expect(studioSiteRegionHref("cn", "zh-CN", "/projects?tab=mine#top")).toBe(
    "https://studio.fizzspace.cn/zh-CN/projects?tab=mine#top"
  );
  expect(studioSiteRegionHref("global", "en-US", "/")).toBe("https://studio.fizzdragon.com/en-US");
});
