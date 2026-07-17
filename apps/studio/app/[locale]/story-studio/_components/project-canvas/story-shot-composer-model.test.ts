import { describe, expect, it } from "vitest";
import type { FizzAiModel } from "@/app/[locale]/canvas/_lib/generation-api";
import {
  addStoryRecipeReference,
  countBillableRecipeReferences,
  isStoryRecipeReferencePlanValid,
  removeStoryRecipeReference,
  storyVideoDurationContract,
} from "./story-shot-composer-model";

describe("direct video recipe model", () => {
  it("derives duration exclusively from the catalog schema", () => {
    const model = {
      input_schema: {
        properties: {
          durationSeconds: { type: "number", enum: [5, 10], default: 10 },
        },
      },
    } as unknown as FizzAiModel;

    expect(storyVideoDurationContract(model)).toEqual({
      defaultMs: 10_000,
      optionsMs: [5_000, 10_000],
      minMs: 5_000,
      maxMs: 10_000,
    });
    expect(
      storyVideoDurationContract({ input_schema: { properties: {} } } as unknown as FizzAiModel)
    ).toBeNull();
  });

  it("validates exact reference roles for each mode", () => {
    const firstLast = [
      { referenceVersionId: "first", role: "first_frame" as const },
      { referenceVersionId: "last", role: "last_frame" as const },
    ];
    expect(isStoryRecipeReferencePlanValid("first_last_frame_to_video", firstLast)).toBe(true);
    expect(isStoryRecipeReferencePlanValid("multimodal_to_video", firstLast)).toBe(false);

    const added = addStoryRecipeReference([], "reference", "reference");
    expect(countBillableRecipeReferences([...added, ...added])).toBe(1);
    expect(removeStoryRecipeReference(added, "reference")).toEqual([]);
  });
});
