import { describe, expect, it } from "vitest";
import {
  generationModalityForNodeType,
  generationNodeTypeForModality,
  isGenerationNodeType,
} from "./generation-node-types";

describe("generation node identity", () => {
  it.each([
    ["image", "prompt"],
    ["video", "video"],
    ["audio", "audio"],
  ] as const)("maps %s generation to its durable %s node type", (modality, nodeType) => {
    expect(generationNodeTypeForModality(modality)).toBe(nodeType);
    expect(generationModalityForNodeType(nodeType)).toBe(modality);
    expect(isGenerationNodeType(nodeType)).toBe(true);
  });

  it("does not classify uploaded media or notes as generation nodes", () => {
    expect(isGenerationNodeType("audioAsset")).toBe(false);
    expect(isGenerationNodeType("note")).toBe(false);
    expect(generationModalityForNodeType(undefined)).toBeUndefined();
  });
});
