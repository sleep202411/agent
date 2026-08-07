import { describe, expect, it } from "vitest";

import {
  aiUiOptionsFromEnum,
  attachUiOptionsToEnumFields,
  withAttachedUiOptions,
} from "./ai-schema-ui-options.js";
import type { AiObjectSchema } from "./ai-schema.js";

describe("aiUiOptionsFromEnum", () => {
  it("maps adaptive/auto to Auto + labelKey", () => {
    expect(aiUiOptionsFromEnum(["16:9", "adaptive", "auto"])).toEqual([
      { value: "16:9", label: "16:9" },
      { value: "adaptive", label: "Auto", labelKey: "sizePresets.auto" },
      { value: "auto", label: "Auto", labelKey: "sizePresets.auto" },
    ]);
  });
});

describe("attachUiOptionsToEnumFields", () => {
  it("fills options for enum fields that already have x-ui", () => {
    const schema: AiObjectSchema = {
      type: "object",
      properties: {
        resolution: {
          type: "string",
          enum: ["720p", "1080p"],
          "x-ui": { control: "segmented", group: "settings", order: 10 },
        },
        prompt: {
          type: "string",
          "x-ui": { control: "textarea", group: "prompt", order: 1 },
        },
      },
    };
    const next = attachUiOptionsToEnumFields(schema);
    expect(next.properties.resolution["x-ui"]).toMatchObject({
      options: [
        { value: "720p", label: "720p" },
        { value: "1080p", label: "1080p" },
      ],
    });
    expect(next.properties.prompt["x-ui"]).not.toHaveProperty("options");
  });

  it("does not overwrite existing options", () => {
    const schema: AiObjectSchema = {
      type: "object",
      properties: {
        aspectRatio: {
          type: "string",
          enum: ["adaptive", "16:9"],
          "x-ui": {
            control: "segmented",
            options: [{ value: "adaptive", label: "Custom Auto" }],
          },
        },
      },
    };
    const next = attachUiOptionsToEnumFields(schema);
    expect(next.properties.aspectRatio["x-ui"]).toMatchObject({
      options: [{ value: "adaptive", label: "Custom Auto" }],
    });
  });
});

describe("withAttachedUiOptions", () => {
  it("returns model with decorated input_schema", () => {
    const model = withAttachedUiOptions({
      id: "m1",
      input_schema: {
        type: "object" as const,
        properties: {
          duration: {
            type: "string" as const,
            enum: ["5", "auto"],
            "x-ui": { control: "select" as const },
          },
        },
      },
    });
    expect(model.input_schema?.properties.duration["x-ui"]).toMatchObject({
      options: [
        { value: "5", label: "5" },
        { value: "auto", label: "Auto", labelKey: "sizePresets.auto" },
      ],
    });
  });
});
