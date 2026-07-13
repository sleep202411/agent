import { describe, expect, it } from "vitest";
import type { FizzAiCatalog, FizzAiModel } from "@/app/[locale]/canvas/_lib/generation-api";
import type { FilmClipSummary } from "@/lib/story-projects-api";
import { countBillableBoundReferences, filterStoryVideoCatalog } from "./story-shot-composer-model";

describe("filterStoryVideoCatalog", () => {
  it("keeps only video models that support all three Story controls", () => {
    const catalog: FizzAiCatalog = {
      models: [
        model("omni", "video", [
          "multimodal_to_video",
          "image_to_video",
          "first_last_frame_to_video",
        ]),
        model("no-last-frame", "video", ["multimodal_to_video", "image_to_video"]),
        model("image-model", "image", ["multimodal_to_video"]),
      ],
    };

    expect(filterStoryVideoCatalog(catalog)?.models.map((candidate) => candidate.id)).toEqual([
      "omni",
    ]);
  });

  it("preserves catalog metadata and handles an unavailable catalog", () => {
    expect(filterStoryVideoCatalog(undefined)).toBeUndefined();
    expect(filterStoryVideoCatalog({ dialect: "fizz-ai", version: "4", models: [] })).toEqual({
      dialect: "fizz-ai",
      version: "4",
      models: [],
    });
  });

  it("prices only approved, mode-valid bound references and deduplicates their versions", () => {
    const target = {
      generationControl: { mode: "omni_reference" },
      referenceBindings: [
        binding("omni", "version-a"),
        binding("style", "version-a"),
        binding("continuity", "version-b"),
        binding("first_frame", "version-c"),
        binding("last_frame", "version-d"),
        binding("omni", null),
      ],
    } as FilmClipSummary;

    expect(countBillableBoundReferences(target)).toBe(2);
    expect(
      countBillableBoundReferences({
        ...target,
        generationControl: { mode: "frame_lock", frameMode: "first_frame" },
      })
    ).toBe(1);
    expect(
      countBillableBoundReferences({
        ...target,
        generationControl: { mode: "frame_lock", frameMode: "first_last_frame" },
      })
    ).toBe(2);
  });
});

function binding(
  role: FilmClipSummary["referenceBindings"][number]["role"],
  approvedReferenceVersionId: string | null
): FilmClipSummary["referenceBindings"][number] {
  return {
    id: `${role}:${approvedReferenceVersionId}`,
    referenceSlotId: `slot:${role}`,
    role,
    rank: 0,
    required: true,
    approvedReferenceVersionId,
  };
}

function model(
  id: string,
  type: FizzAiModel["type"],
  generationModes: NonNullable<FizzAiModel["generationModes"]>
): FizzAiModel {
  return {
    id,
    type,
    name: id,
    enabled: true,
    schemaVersion: "1",
    generationModes,
    input_schema: { type: "object", properties: {} },
  };
}
