import { describe, expect, it } from "vitest";

import { resolveStoryProductionTargetStage } from "./story-definitions.js";

function productionState(status: "missing" | "current") {
  return {
    script: {
      status,
      documentId: status === "missing" ? null : "11111111-1111-4111-8111-111111111111",
      sequence: status === "missing" ? null : 1,
    },
  } as const;
}

describe("resolveStoryProductionTargetStage", () => {
  it("does not let the model shrink an explicit four-stage review request", () => {
    expect(
      resolveStoryProductionTargetStage({
        creatorRequest:
          "请逐阶段提供剧本、情节树、资产规格和分镜规格供我分别审核；不要生成图片或视频。",
        proposed: "script",
        productionState: productionState("missing"),
      })
    ).toBe("storyboard");
  });

  it("preserves an explicit single-stage boundary even when the model widens it", () => {
    expect(
      resolveStoryProductionTargetStage({
        creatorRequest: "只生成剧本，不要生成情节树、资产规格或分镜规格。",
        proposed: "storyboard",
        productionState: productionState("missing"),
      })
    ).toBe("script");
  });

  it("does not carry a media negation across a new request clause", () => {
    expect(
      resolveStoryProductionTargetStage({
        creatorRequest: "不要生成图片或视频，请逐阶段提供剧本、情节树、资产规格和分镜规格。",
        proposed: "script",
        productionState: productionState("missing"),
      })
    ).toBe("storyboard");
  });

  it("recognizes an explicit Plot-only request", () => {
    expect(
      resolveStoryProductionTargetStage({
        creatorRequest: "请生成情节树供我审核。",
        proposed: "storyboard",
        productionState: productionState("missing"),
      })
    ).toBe("plot");
  });

  it("treats a referenced screenplay as source material in an empty chapter", () => {
    expect(
      resolveStoryProductionTargetStage({
        creatorRequest: "根据这个剧本生成",
        proposed: "script",
        productionState: productionState("missing"),
      })
    ).toBe("storyboard");

    expect(
      resolveStoryProductionTargetStage({
        creatorRequest: "Generate the interactive film from this script.",
        proposed: "script",
        productionState: productionState("missing"),
      })
    ).toBe("storyboard");

    expect(
      resolveStoryProductionTargetStage({
        creatorRequest: "只根据这个剧本生成，不要参考其他材料。",
        proposed: "script",
        productionState: productionState("missing"),
      })
    ).toBe("storyboard");
  });

  it("defaults an attachment-only empty chapter to the complete review path", () => {
    expect(
      resolveStoryProductionTargetStage({
        creatorRequest: "",
        proposed: "script",
        productionState: productionState("missing"),
      })
    ).toBe("storyboard");
  });

  it("uses storyboard for a broad continuation of a partially produced chapter", () => {
    expect(
      resolveStoryProductionTargetStage({
        creatorRequest: "继续完成这个互动影游",
        proposed: "plot",
        productionState: productionState("current"),
      })
    ).toBe("storyboard");
  });

  it("keeps an explicit Script-only output request narrow", () => {
    expect(
      resolveStoryProductionTargetStage({
        creatorRequest: "请生成一份正式剧本供我审核。",
        proposed: "storyboard",
        productionState: productionState("missing"),
      })
    ).toBe("script");
  });

  it("honors an explicit exclusion of later production stages", () => {
    expect(
      resolveStoryProductionTargetStage({
        creatorRequest: "完整制作，但不要生成分镜。",
        proposed: "storyboard",
        productionState: productionState("missing"),
      })
    ).toBe("assets");
  });

  it("keeps the model decision for ambiguous prose", () => {
    expect(
      resolveStoryProductionTargetStage({
        creatorRequest: "剧本里提到了情节树的概念。",
        proposed: "script",
        productionState: productionState("current"),
      })
    ).toBe("script");
  });
});
