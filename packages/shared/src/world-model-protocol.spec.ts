import { describe, expect, it } from "vitest";
import {
  BindWorldTravelRequestSchema,
  CreateWorldRequestSchema,
  WorldSessionConnectionSchema,
} from "./world-model-protocol.js";

describe("world model protocol", () => {
  it("normalizes an exploration world without leaking provider vocabulary", () => {
    const value = CreateWorldRequestSchema.parse({
      mode: "adventure",
      prompt: "A rain-soaked late-Ming city at night",
      perspective: "third_person",
    });

    expect(value).toMatchObject({
      providerKey: "fal:happy-oyster",
      mode: "adventure",
      perspective: "third_person",
      reference: { imageUrls: [] },
    });
  });

  it("rejects the unsupported directing mode and its controls", () => {
    expect(
      CreateWorldRequestSchema.safeParse({
        mode: "directing",
        prompt: "Direct the storm",
        resolution: "720p",
      }).success
    ).toBe(false);
  });

  it("rejects long-lived provider secrets from the browser connection contract", () => {
    const parsed = WorldSessionConnectionSchema.safeParse({
      apiBaseUrl: "https://world.example.com",
      ticket: "one-time-ticket",
      token: "short-lived-token",
      tokenExpiresIn: 60,
      apiKey: "must-not-cross-the-boundary",
    });

    expect(parsed.success).toBe(false);
  });

  it("keeps provider-specific travel identifiers behind the runtime adapter", () => {
    expect(
      BindWorldTravelRequestSchema.parse({ providerTravelId: "opaque-provider-value" })
    ).toEqual({ providerTravelId: "opaque-provider-value" });
    expect(
      BindWorldTravelRequestSchema.safeParse({ encryptedTravelId: "vendor-vocabulary" }).success
    ).toBe(false);
  });
});
