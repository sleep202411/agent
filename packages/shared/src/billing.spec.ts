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
