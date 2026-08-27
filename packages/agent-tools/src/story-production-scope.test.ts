import { describe, expect, it } from "vitest";

import { resolveStoryProductionTargetStage } from "./story-definitions.js";

describe("resolveStoryProductionTargetStage", () => {
  it("does not let the model shrink an explicit four-stage review request", () => {
    expect(
      resolveStoryProductionTargetStage({
        creatorRequest:
          "请逐阶段提供剧本、情节树、资产规格和分镜规格供我分别审核；不要生成图片或视频。",
        proposed: "script",
      })
    ).toBe("storyboard");
  });

  it("preserves an explicit single-stage boundary even when the model widens it", () => {
    expect(
      resolveStoryProductionTargetStage({
        creatorRequest: "只生成剧本，不要生成情节树、资产规格或分镜规格。",
        proposed: "storyboard",
      })
    ).toBe("script");
  });

  it("does not carry a media negation across a new request clause", () => {
    expect(
      resolveStoryProductionTargetStage({
        creatorRequest: "不要生成图片或视频，请逐阶段提供剧本、情节树、资产规格和分镜规格。",
        proposed: "script",
      })
    ).toBe("storyboard");
  });

  it("recognizes an explicit Plot-only request", () => {
    expect(
      resolveStoryProductionTargetStage({
        creatorRequest: "请生成情节树供我审核。",
        proposed: "storyboard",
      })
    ).toBe("plot");
  });

  it("keeps the model decision for ambiguous prose", () => {
    expect(
      resolveStoryProductionTargetStage({
        creatorRequest: "剧本里提到了情节树的概念。",
        proposed: "script",
      })
    ).toBe("script");
  });
});
