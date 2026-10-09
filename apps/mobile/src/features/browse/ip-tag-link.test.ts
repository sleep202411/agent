import { expect, it } from "vitest";
import { redirectIpTagLink } from "./ip-tag-link";
it("maps regional Web, localized and app-scheme tag links", () => {
  for (const path of [
    "/tags/topic",
    "/zh-CN/tags/topic/",
    "https://fizzdragon.com/en-US/tags/topic",
    "fizzdragon-dev://tags/topic",
    "fizzdragon-dev:///tags/topic",
  ])
    expect(redirectIpTagLink(path, "global", ["fizzdragon-dev"])).toBe("/tags/topic");
  expect(redirectIpTagLink("https://fizzdragon.fizzspace.cn/zh-HK/tags/a%20b", "cn", [])).toBe(
    "/tags/a%20b"
  );
});
it("preserves other regions, origins, callbacks, context and malformed paths", () => {
  for (const path of [
    "https://fizzdragon.fizzspace.cn/tags/topic",
    "https://evil.test/tags/topic",
    "https://user@fizzdragon.com/tags/topic",
    "https://fizzdragon.com:444/tags/topic",
    "/tags/topic?view=other",
    "/tags/topic#entry",
    "/tags/%ZZ",
    "/tags/",
    "/tags/" + "x".repeat(81),
    "wxpay://callback?code=a",
    "/agent?workspace=x",
    "https://fizzdragon.com/\\tags/topic",
    "fizzdragon://tags/topic",
  ])
    expect(redirectIpTagLink(path, "global", ["fizzdragon-dev"])).toBe(path);
});
