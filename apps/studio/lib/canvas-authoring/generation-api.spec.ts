import { describe, expect, it } from "vitest";
import {
  buildReferenceInputForMode,
  canvasDefaultModel,
  fizzAiModelLock,
  fizzAiPlanLabel,
  isFizzAiModelUsable,
  isFizzAiModelVisible,
  filterFizzAiInput,
  normalizeModelSettings,
  referenceFieldsForMode,
  schemaFields,
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

describe("stateful video editing references", () => {
  const omni = videoModel("gemini-omni-flash-preview", ["text_to_video", "video_to_video"], {
    input_schema: {
      type: "object",
      properties: {
        sourceVideo: {
          type: "object",
          properties: { url: { type: "string" }, sourceJobId: { type: "string" } },
          "x-ui": { control: "video_upload" },
        },
      },
    },
  });

  it("routes video-to-video to the singular sourceVideo field", () => {
    expect(referenceFieldsForMode(omni, "video_to_video").map((field) => field.field)).toEqual([
      "sourceVideo",
    ]);
  });

  it("preserves the internal source job lineage in the provider input", () => {
    expect(
      buildReferenceInputForMode(omni, "video_to_video", {
        sourceVideo: [
          {
            id: "edge-1",
            url: "https://assets.test/omni.mp4",
            kind: "video",
            sourceJobId: "job-omni-1",
          },
        ],
      })
    ).toEqual({
      sourceVideo: {
        url: "https://assets.test/omni.mp4",
        sourceJobId: "job-omni-1",
      },
    });
  });
});

/**
 * Access and visibility used to be the same predicate, so gating a model
 * deleted it from every picker instead of locking it. These pin the split:
 * pickers must SHOW a gated model, and anything that auto-selects must not
 * pick one.
 */
describe("visibility vs usability", () => {
  const gated = videoModel("premium", ["text_to_video"], {
    access: { allowed: false, reason: "membership_required", requiredPlan: "pro" },
  });
  const open = videoModel("open", ["text_to_video"]);
  const killed = videoModel("killed", ["text_to_video"], {
    enabled: false,
    disabledReason: "provider outage",
  });

  it("shows a plan-gated model but does not call it usable", () => {
    expect(isFizzAiModelVisible(gated)).toBe(true);
    expect(isFizzAiModelUsable(gated)).toBe(false);
  });

  it("hides an operator-disabled model from the picker entirely", () => {
    expect(isFizzAiModelVisible(killed)).toBe(false);
    expect(isFizzAiModelUsable(killed)).toBe(false);
  });

  it("reports the plan a gated model is asking for", () => {
    expect(fizzAiModelLock(gated)).toEqual({ requiredPlan: "pro", expired: false });
  });

  it("flags an expired membership separately from an upgrade gate", () => {
    // The server denies EVERY model to a lapsed member, so an "upgrade to Pro"
    // label would be wrong — they already bought the tier.
    const expired = videoModel("expired", ["text_to_video"], {
      access: { allowed: false, reason: "membership_expired", requiredPlan: "pro" },
    });
    expect(fizzAiModelLock(expired)).toEqual({ requiredPlan: "pro", expired: true });
  });

  it("reports a lock with no plan when the denial names no tier", () => {
    const denied = videoModel("denied", ["text_to_video"], {
      access: { allowed: false, reason: "denied" },
    });
    expect(fizzAiModelLock(denied)).toEqual({ requiredPlan: null, expired: false });
  });

  it("reports no lock for a usable or operator-disabled model", () => {
    expect(fizzAiModelLock(open)).toBeNull();
    expect(fizzAiModelLock(killed)).toBeNull();
  });

  it("keeps auto-selection off gated models", () => {
    // The picker would list both; the default must still land on `open`.
    expect(canvasDefaultModel(catalog([gated, open]), "video")).toBe(open);
  });

  it("title-cases a plan key for display", () => {
    expect(fizzAiPlanLabel("pro")).toBe("Pro");
    expect(fizzAiPlanLabel("community_membership")).toBe("Community Membership");
  });
});

describe("schema numeric normalization", () => {
  const audio = videoModel("seed-audio-1-0", ["text_to_audio"], {
    type: "audio",
    input_schema: {
      type: "object",
      properties: {
        durationSeconds: {
          type: "number",
          minimum: 1,
          maximum: 120,
          multipleOf: 1,
          default: 10,
          "x-ui": { control: "slider" },
        },
      },
    },
  });

  it("carries JSON Schema multipleOf into the slider descriptor", () => {
    expect(schemaFields(audio)[0]?.step).toBe(1);
  });

  it("migrates legacy floating slider values and normalizes the wire input", () => {
    const legacy = { durationSeconds: 8.8818359375 };
    expect(normalizeModelSettings(audio, legacy)).toEqual({ durationSeconds: 9 });
    expect(filterFizzAiInput(audio, legacy)).toEqual({ durationSeconds: 9 });
  });
});
