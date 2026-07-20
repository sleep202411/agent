import { describe, expect, it } from "vitest";
import type { FizzAiCatalog, FizzAiModel } from "@/app/[locale]/canvas/_lib/generation-api";
import type {
  StoryReferenceKind,
  StoryReferenceSlot,
  StoryVideoGenerationReferenceInput,
} from "@/lib/story-projects-api";
import {
  addStoryRecipeReference,
  countBillableRecipeReferences,
  filterStoryVideoModels,
  isStoryRecipeReferencePlanValid,
  pruneStoryRecipeReferencesForMode,
  removeStoryRecipeReference,
  storyComposerAddableSlots,
  storyFreeformUploadTarget,
  storyVideoDurationContract,
  supportedStoryVideoModes,
} from "./story-shot-composer-model";

const DURATION_SCHEMA = {
  input_schema: { properties: { durationSeconds: { type: "number", enum: [5, 10], default: 10 } } },
};

function videoModel(
  id: string,
  generationModes: string[],
  overrides: Partial<FizzAiModel> = {}
): FizzAiModel {
  return {
    id,
    type: "video",
    name: id,
    enabled: true,
    schemaVersion: "1",
    generationModes: generationModes as FizzAiModel["generationModes"],
    ...DURATION_SCHEMA,
    ...overrides,
  } as unknown as FizzAiModel;
}

function catalogOf(models: FizzAiModel[]): FizzAiCatalog {
  return { models };
}

function approvedSlot(
  id: string,
  kind: StoryReferenceKind,
  rank: number,
  versionId: string
): StoryReferenceSlot {
  return {
    id,
    projectId: "p",
    key: id.toUpperCase(),
    kind,
    label: id,
    description: "",
    required: false,
    rank,
    version: 1,
    status: "approved",
    approvedVersionId: versionId,
    versions: [
      {
        id: versionId,
        slotId: id,
        number: 1,
        source: "upload",
        aiJobId: null,
        aiJobOutputId: null,
        sourceGenerationId: null,
        sourceFrameIndex: null,
        sourceOutputChecksumSha256: null,
        asset: {
          id: `${versionId}-asset`,
          kind: "image",
          status: "ready",
          moderationStatus: "approved",
          contentType: "image/png",
          width: 1024,
          height: 1024,
          durationSeconds: null,
          checksumSha256: "sum",
          previewUrl: `https://cdn.example/${versionId}.png`,
        },
        variantId: `${versionId}-variant`,
        promptSnapshot: null,
        configSnapshot: null,
        checksumSha256: "sum",
        reviewRevision: 1,
        approved: true,
        createdByUserId: "u",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

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

describe("multi-mode catalog + model support", () => {
  it("includes every video model that drives at least one story mode with a valid duration", () => {
    const catalog = catalogOf([
      videoModel("omni", ["multimodal_to_video"]),
      videoModel("frames", ["first_last_frame_to_video"]),
      videoModel("both", ["multimodal_to_video", "first_last_frame_to_video"]),
      videoModel("i2v-only", ["image_to_video"]),
      videoModel("no-duration", ["multimodal_to_video"], {
        input_schema: { properties: {} },
      } as Partial<FizzAiModel>),
      videoModel("disabled", ["multimodal_to_video"], { enabled: false }),
    ]);

    const ids = filterStoryVideoModels(catalog)?.models.map((model) => model.id);
    expect(ids).toEqual(["omni", "frames", "both"]);
    expect(filterStoryVideoModels(undefined)).toBeUndefined();
  });

  it("reports the model's supported story modes in canonical order", () => {
    expect(supportedStoryVideoModes(videoModel("m", ["first_last_frame_to_video"]))).toEqual([
      "first_last_frame_to_video",
    ]);
    expect(
      supportedStoryVideoModes(
        videoModel("m", ["first_last_frame_to_video", "multimodal_to_video"])
      )
    ).toEqual(["multimodal_to_video", "first_last_frame_to_video"]);
    expect(supportedStoryVideoModes(videoModel("m", ["image_to_video"]))).toEqual([]);
    expect(supportedStoryVideoModes(undefined)).toEqual([]);
  });
});

describe("mode-driven references", () => {
  const slots: StoryReferenceSlot[] = [
    approvedSlot("hero", "character", 10, "hero-v1"),
    approvedSlot("first", "first_frame", 20, "first-v1"),
    approvedSlot("last", "last_frame", 30, "last-v1"),
  ];

  it("offers only role-appropriate slots for the active mode", () => {
    const multimodal = storyComposerAddableSlots("multimodal_to_video", [], slots);
    expect(multimodal.map((slot) => slot.slotId)).toEqual(["hero"]);
    expect(multimodal[0]?.role).toBe("reference");

    const firstLast = storyComposerAddableSlots("first_last_frame_to_video", [], slots);
    expect(firstLast.map((slot) => slot.role)).toEqual(["first_frame", "last_frame"]);
  });

  it("drops references that no longer fit when the mode switches", () => {
    const multimodalRefs: StoryVideoGenerationReferenceInput[] = [
      { referenceVersionId: "hero-v1", role: "reference" },
    ];
    expect(pruneStoryRecipeReferencesForMode("first_last_frame_to_video", multimodalRefs)).toEqual(
      []
    );

    const frameRefs: StoryVideoGenerationReferenceInput[] = [
      { referenceVersionId: "first-v1", role: "first_frame" },
      { referenceVersionId: "last-v1", role: "last_frame" },
    ];
    expect(pruneStoryRecipeReferencesForMode("multimodal_to_video", frameRefs)).toEqual([]);
    // Same-mode prune keeps a valid plan intact.
    expect(pruneStoryRecipeReferencesForMode("first_last_frame_to_video", frameRefs)).toEqual(
      frameRefs
    );
  });

  it("targets the right slot kind + role for a free-form upload", () => {
    expect(storyFreeformUploadTarget("multimodal_to_video", [])).toEqual({
      kind: "graphic",
      role: "reference",
    });
    expect(
      storyFreeformUploadTarget(
        "multimodal_to_video",
        Array.from({ length: 12 }, (_, index) => ({
          referenceVersionId: `r${index}`,
          role: "reference" as const,
        }))
      )
    ).toBeNull();

    expect(storyFreeformUploadTarget("first_last_frame_to_video", [])).toEqual({
      kind: "first_frame",
      role: "first_frame",
    });
    expect(
      storyFreeformUploadTarget("first_last_frame_to_video", [
        { referenceVersionId: "first-v1", role: "first_frame" },
      ])
    ).toEqual({ kind: "last_frame", role: "last_frame" });
    expect(
      storyFreeformUploadTarget("first_last_frame_to_video", [
        { referenceVersionId: "first-v1", role: "first_frame" },
        { referenceVersionId: "last-v1", role: "last_frame" },
      ])
    ).toBeNull();
  });
});
