import { describe, expect, it } from "vitest";
import type { FizzAiCatalog, FizzAiModel } from "@/app/[locale]/canvas/_lib/generation-api";
import type { FilmClipSummary, FilmReferenceSlot } from "@/lib/story-projects-api";
import {
  countBillableBoundReferences,
  filterStoryVideoCatalog,
  storyComposerAddableSlots,
  storyComposerReferenceItems,
  storyReferenceBindingsWith,
  storyReferenceBindingsWithout,
} from "./story-shot-composer-model";

describe("filterStoryVideoCatalog", () => {
  it("keeps only video models that support both Story modes", () => {
    const catalog: FizzAiCatalog = {
      models: [
        model("omni", "video", [
          "multimodal_to_video",
          "image_to_video",
          "first_last_frame_to_video",
        ]),
        model("both-modes", "video", ["multimodal_to_video", "first_last_frame_to_video"]),
        model("omni-only", "video", ["multimodal_to_video", "image_to_video"]),
        model("image-model", "image", ["multimodal_to_video"]),
      ],
    };

    expect(filterStoryVideoCatalog(catalog)?.models.map((candidate) => candidate.id)).toEqual([
      "omni",
      "both-modes",
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

describe("composer reference rail model", () => {
  const slots = [
    slot("slot:omni", "character", "Cheng pack", 0, "v-omni"),
    slot("slot:style", "style", "Style board", 1, "v-style"),
    slot("slot:first", "first_frame", "S00 first", 2, "v-first"),
    slot("slot:join", "join_frame", "C2 join", 3, "v-join"),
    slot("slot:pending", "location", "Unapproved location", 4, null),
  ];

  const omniClip = {
    generationControl: { mode: "omni_reference" },
    referenceBindings: [
      { ...binding("omni", "v-omni"), referenceSlotId: "slot:omni", rank: 1 },
      { ...binding("first_frame", "v-first"), referenceSlotId: "slot:first", rank: 0 },
    ],
  } as FilmClipSummary;

  it("renders only mode-valid bindings, sorted by rank, with slot previews", () => {
    const items = storyComposerReferenceItems(omniClip, slots);
    expect(items.map((item) => item.slotId)).toEqual(["slot:omni"]);
    expect(items[0]).toMatchObject({
      label: "Cheng pack",
      approved: true,
      previewUrl: "https://cdn.test/v-omni.png",
    });
  });

  it("offers approved unbound slots with the role the current mode implies", () => {
    expect(
      storyComposerAddableSlots(omniClip, slots).map((entry) => [entry.slotId, entry.role])
    ).toEqual([["slot:style", "omni"]]);

    const frameClip = {
      ...omniClip,
      generationControl: { mode: "frame_lock", frameMode: "first_last_frame" },
      referenceBindings: [],
    } as FilmClipSummary;
    expect(
      storyComposerAddableSlots(frameClip, slots).map((entry) => [entry.slotId, entry.role])
    ).toEqual([
      ["slot:first", "first_frame"],
      ["slot:join", "first_frame"],
    ]);
  });

  it("adds and removes bindings immutably while preserving the rest", () => {
    const added = storyReferenceBindingsWith(omniClip, "slot:style", "omni");
    expect(added).toHaveLength(3);
    expect(added.at(-1)).toEqual({
      referenceSlotId: "slot:style",
      role: "omni",
      rank: 2,
      required: false,
    });
    expect(storyReferenceBindingsWith(omniClip, "slot:omni", "omni")).toHaveLength(2);

    expect(
      storyReferenceBindingsWithout(omniClip, "slot:first").map((entry) => entry.referenceSlotId)
    ).toEqual(["slot:omni"]);
  });
});

function slot(
  id: string,
  kind: FilmReferenceSlot["kind"],
  label: string,
  rank: number,
  approvedVersionId: string | null
): FilmReferenceSlot {
  return {
    id,
    projectId: "project",
    revisionId: "revision",
    key: id,
    kind,
    label,
    description: "",
    required: true,
    rank,
    version: 1,
    status: approvedVersionId ? "approved" : "candidate",
    approvedVersionId,
    versions: approvedVersionId
      ? [
          {
            id: approvedVersionId,
            slotId: id,
            number: 1,
            source: "import",
            aiJobId: null,
            aiJobOutputId: null,
            sourceTakeId: null,
            sourceFrameIndex: null,
            sourceOutputChecksumSha256: null,
            asset: {
              id: `${approvedVersionId}:asset`,
              kind: "image",
              status: "ready",
              moderationStatus: "approved",
              contentType: "image/png",
              width: 1024,
              height: 1024,
              durationSeconds: null,
              checksumSha256: "hash",
              previewUrl: `https://cdn.test/${approvedVersionId}.png`,
            },
            promptSnapshot: null,
            configSnapshot: null,
            checksumSha256: "hash",
            reviewRevision: 1,
            approved: true,
            createdByUserId: "user",
            createdAt: "2026-07-13T00:00:00Z",
          },
        ]
      : [],
    createdAt: "2026-07-13T00:00:00Z",
    updatedAt: "2026-07-13T00:00:00Z",
  };
}

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
