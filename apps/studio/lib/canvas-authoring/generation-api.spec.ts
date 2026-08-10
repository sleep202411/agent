import { describe, expect, it } from "vitest";
import {
  canvasDefaultModel,
  type FizzAiCatalog,
  type FizzAiGenerationMode,
  type FizzAiModel,
} from "./generation-api";

function videoModel(
  id: string,
  generationModes: FizzAiGenerationMode[],
  overrides: Partial<FizzAiModel> = {}
): FizzAiModel {
  return {
    id,
    type: "video",
    name: id,
    enabled: true,
    schemaVersion: "test",
    generationModes,
    input_schema: { type: "object" },
    ...overrides,
  };
}

function catalog(models: FizzAiModel[]): FizzAiCatalog {
  return {
    models,
    version: "test",
  };
}

describe("canvasDefaultModel", () => {
  it("defaults new video cards to Seedance 2.5 regardless of catalog order", () => {
    const agnes = videoModel("quick-video-1-0", ["multimodal_to_video"]);
    const seedance = videoModel("seedance-2-5", [
      "text_to_video",
      "image_to_video",
      "multimodal_to_video",
    ]);

    expect(canvasDefaultModel(catalog([agnes, seedance]), "video")).toBe(seedance);
  });

  it("falls back to a usable reference-capable model when Seedance is unavailable", () => {
    const agnes = videoModel("quick-video-1-0", ["multimodal_to_video"]);
    const seedance = videoModel("seedance-2-5", ["multimodal_to_video"], {
      access: { allowed: false },
    });

    expect(canvasDefaultModel(catalog([agnes, seedance]), "video")).toBe(agnes);
  });
});
