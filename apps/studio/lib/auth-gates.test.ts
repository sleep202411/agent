import { describe, expect, it } from "vitest";
import { isProtectedPath } from "./auth-gates";

describe("Studio route auth gates", () => {
  it("keeps the Story Studio landing public while protecting project authoring surfaces", () => {
    expect(isProtectedPath("/story-studio")).toBe(false);
    expect(isProtectedPath("/zh-CN/story-studio")).toBe(false);
    expect(isProtectedPath("/story-studio/projects/project-1/canvas")).toBe(true);
    expect(isProtectedPath("/zh-CN/story-studio/projects/project-1/playtest?revision=4")).toBe(
      true
    );
  });

  it("protects Text Adventures across localized routes", () => {
    expect(isProtectedPath("/text-adventures")).toBe(true);
    expect(isProtectedPath("/en-US/text-adventures/tg_1234567890ABCDEF")).toBe(true);
  });
});
