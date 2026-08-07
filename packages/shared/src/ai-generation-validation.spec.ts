import { describe, expect, it } from "vitest";

import {
  VALIDATION_ISSUE_CODES,
  hasBlockingValidationIssues,
  validateGenerationInput,
  type ValidationInputSchema,
} from "./ai-generation-validation.js";

/** Seedance-like multimodal reference schema (catalog x-ui constraints). */
function seedanceLikeSchema(): ValidationInputSchema {
  return {
    type: "object",
    properties: {
      prompt: { type: "string" },
      referenceImages: {
        type: "array",
        maxItems: 9,
        "x-ui": {
          control: "image_upload",
          group: "references",
          mediaKind: "image",
          maxTotalFiles: 12,
        },
      },
      referenceVideos: {
        type: "array",
        maxItems: 3,
        "x-ui": {
          control: "video_upload",
          group: "references",
          mediaKind: "video",
          minCombinedDurationSeconds: 2,
          maxCombinedDurationSeconds: 15,
          maxTotalFiles: 12,
        },
      },
      referenceAudios: {
        type: "array",
        maxItems: 3,
        "x-ui": {
          control: "audio_upload",
          group: "references",
          mediaKind: "audio",
          maxCombinedDurationSeconds: 15,
          audioRequiresVisual: true,
          maxTotalFiles: 12,
        },
      },
    },
  };
}

describe("validateGenerationInput", () => {
  it("allows valid Seedance-like omni reference payload", () => {
    const issues = validateGenerationInput({
      inputSchema: seedanceLikeSchema(),
      input: {
        prompt: "a cat walks",
        referenceVideos: [
          { url: "https://cdn.example.com/a.mp4", durationSeconds: 6 },
          { url: "https://cdn.example.com/b.mp4", durationSeconds: 8 },
        ],
      },
    });
    expect(issues).toEqual([]);
  });

  it("blocks combined reference video duration over catalog max (no model if)", () => {
    const issues = validateGenerationInput({
      inputSchema: seedanceLikeSchema(),
      input: {
        referenceVideos: [
          { url: "https://cdn.example.com/a.mp4", durationSeconds: 8 },
          { url: "https://cdn.example.com/b.mp4", durationSeconds: 8 },
        ],
      },
    });
    expect(hasBlockingValidationIssues(issues)).toBe(true);
    expect(issues[0]?.code).toBe(VALIDATION_ISSUE_CODES.MEDIA_DURATION_SUM_EXCEEDED);
    expect(issues[0]?.params).toMatchObject({ actual: 16, max: 15 });
    expect(issues[0]?.field).toBe("referenceVideos");
  });

  it("hard-fails when duration is required but unknown (never skip)", () => {
    const issues = validateGenerationInput({
      inputSchema: seedanceLikeSchema(),
      input: {
        referenceVideos: [{ url: "https://cdn.example.com/a.mp4" }],
      },
    });
    expect(issues.map((i) => i.code)).toContain(VALIDATION_ISSUE_CODES.MEDIA_DURATION_UNKNOWN);
  });

  it("prefers explicit media snapshots over bare input urls", () => {
    const issues = validateGenerationInput({
      inputSchema: seedanceLikeSchema(),
      input: {
        referenceVideos: ["https://cdn.example.com/a.mp4"],
      },
      media: [
        {
          field: "referenceVideos",
          kind: "video",
          url: "https://cdn.example.com/a.mp4",
          durationSeconds: 20,
        },
      ],
    });
    expect(issues.some((i) => i.code === VALIDATION_ISSUE_CODES.MEDIA_DURATION_SUM_EXCEEDED)).toBe(
      true
    );
  });

  it("enforces audioRequiresVisual from catalog", () => {
    const issues = validateGenerationInput({
      inputSchema: seedanceLikeSchema(),
      input: {
        referenceAudios: [{ url: "https://cdn.example.com/a.mp3", durationSeconds: 3 }],
      },
    });
    expect(issues.map((i) => i.code)).toContain(VALIDATION_ISSUE_CODES.MEDIA_AUDIO_REQUIRES_VISUAL);
  });

  it("enforces maxTotalFiles across reference kinds", () => {
    const issues = validateGenerationInput({
      inputSchema: seedanceLikeSchema(),
      input: {
        referenceImages: Array.from({ length: 10 }, (_, i) => ({
          url: `https://cdn.example.com/i${i}.png`,
        })),
        referenceVideos: [
          { url: "https://cdn.example.com/v1.mp4", durationSeconds: 2 },
          { url: "https://cdn.example.com/v2.mp4", durationSeconds: 2 },
          { url: "https://cdn.example.com/v3.mp4", durationSeconds: 2 },
        ],
      },
    });
    expect(issues.map((i) => i.code)).toContain(VALIDATION_ISSUE_CODES.MEDIA_MAX_TOTAL_FILES);
  });

  it("does nothing when schema has no upload constraints", () => {
    const issues = validateGenerationInput({
      inputSchema: {
        type: "object",
        properties: { prompt: { type: "string" } },
      },
      input: { prompt: "hi" },
    });
    expect(issues).toEqual([]);
  });

  it("does not enforce minItems when the field is absent (required owns absence)", () => {
    const schema: ValidationInputSchema = {
      type: "object",
      properties: {
        prompt: { type: "string" },
        references: {
          type: "array",
          minItems: 1,
          maxItems: 4,
          "x-ui": {
            control: "image_upload",
            group: "references",
            mediaKind: "image",
          },
        },
      },
    };
    const issues = validateGenerationInput({
      inputSchema: schema,
      input: { prompt: "text only t2v" },
    });
    expect(issues.map((i) => i.code)).not.toContain(VALIDATION_ISSUE_CODES.FIELD_MIN_ITEMS);
  });

  it("enforces minItems when the field is present but empty", () => {
    const schema: ValidationInputSchema = {
      type: "object",
      properties: {
        references: {
          type: "array",
          minItems: 1,
          "x-ui": {
            control: "image_upload",
            group: "references",
            mediaKind: "image",
          },
        },
      },
    };
    const issues = validateGenerationInput({
      inputSchema: schema,
      input: { references: [] },
    });
    expect(issues.map((i) => i.code)).toContain(VALIDATION_ISSUE_CODES.FIELD_MIN_ITEMS);
  });
});
