import { describe, expect, it } from "vitest";
import { estimateProductModelPoints, type AiProductPricingPolicy } from "./billing.js";

const seedance25Pricing: AiProductPricingPolicy = {
  mode: "per_second_matrix",
  version: "test",
  currency: "COMPUTE_POINTS",
  defaultResolution: "720p",
  pointsPerSecond: { "480p": 18, "720p": 38 },
  referenceVideoPointsPerSecond: { "480p": 11, "720p": 23 },
  minSeconds: 4,
  maxSeconds: 30,
  defaultSeconds: 5,
  autoQuoteSeconds: 30,
};

describe("character-metered pricing", () => {
  it("counts Unicode code points and applies the product minimum", () => {
    const result = estimateProductModelPoints({
      policy: {
        mode: "per_character",
        version: "tts-v1",
        currency: "COMPUTE_POINTS",
        pointsPerCharacter: 0.003,
        minCharacters: 1,
        maxCharacters: 3000,
        defaultCharacters: 200,
        minimumPoints: 1,
        roundTo: 1,
      },
      text: "Hi 🐉龙",
    });

    expect(result.selection.characters).toBe(5);
    expect(result.sellPoints).toBe(1);
  });
});

describe("reference-video per-second pricing", () => {
  it("uses the ordinary output meter when no reference video is supplied", () => {
    const result = estimateProductModelPoints({
      policy: seedance25Pricing,
      resolution: "720p",
      duration: "5",
    });

    expect(result.sellPoints).toBe(190);
    expect(result.referenceVideoSurchargePoints).toBe(0);
  });

  it("meters both input and output seconds at the video-input rate", () => {
    const result = estimateProductModelPoints({
      policy: seedance25Pricing,
      resolution: "720p",
      duration: "5",
      referenceVideoSeconds: 12,
    });

    expect(result.basePoints).toBe(115);
    expect(result.referenceVideoSurchargePoints).toBe(276);
    expect(result.sellPoints).toBe(391);
  });
});

describe("native-audio per-second pricing", () => {
  const veoPricing: AiProductPricingPolicy = {
    mode: "per_second_matrix",
    version: "veo-test",
    currency: "COMPUTE_POINTS",
    defaultResolution: "1080p",
    pointsPerSecond: { "720p": 16, "1080p": 20 },
    videoOnlyPointsPerSecond: { "720p": 12, "1080p": 15 },
    minSeconds: 4,
    maxSeconds: 8,
    defaultSeconds: 8,
    autoQuoteSeconds: 8,
  };

  it("uses the audio-inclusive rate by default", () => {
    expect(
      estimateProductModelPoints({
        policy: veoPricing,
        resolution: "1080p",
        duration: "8",
      }).sellPoints
    ).toBe(160);
  });

  it("uses the video-only rate only when audio is explicitly disabled", () => {
    expect(
      estimateProductModelPoints({
        policy: veoPricing,
        resolution: "1080p",
        duration: "8",
        generateAudio: false,
      }).sellPoints
    ).toBe(120);
  });
});
