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

describe("pooled reference-token pricing", () => {
  const policy: AiProductPricingPolicy = {
    mode: "per_second_matrix",
    version: "h3-max-test",
    currency: "COMPUTE_POINTS",
    defaultResolution: "768P",
    pointsPerSecond: { "768P": 12 },
    minSeconds: 5,
    maxSeconds: 15,
    defaultSeconds: 5,
    autoQuoteSeconds: 15,
    referenceTokenPricing: {
      includedTokens: 4096,
      pointsPerThousandTokens: 2,
      imagePixelsPerToken: 1024,
      videoTokensPerSecond: { "768P": 7460 },
      audioTokensPerSecond: 80,
    },
  };
  const image = { width: 1024, height: 1024 };

  it("keeps text and keyframe generation at the base rate", () => {
    expect(estimateProductModelPoints({ policy }).sellPoints).toBe(60);
    expect(
      estimateProductModelPoints({ policy, referenceImageCount: 2, referenceMedia: {} }).sellPoints
    ).toBe(60);
  });
  it("pools the free allowance across all reference kinds and rounds charges up", () => {
    expect(
      estimateProductModelPoints({ policy, referenceMedia: { images: Array(4).fill(image) } })
        .sellPoints
    ).toBe(60);
    expect(
      estimateProductModelPoints({ policy, referenceMedia: { images: Array(5).fill(image) } })
        .sellPoints
    ).toBe(63);
    expect(
      estimateProductModelPoints({
        policy,
        referenceMedia: {
          images: [{ width: 2048, height: 2048 }],
          audios: [{ durationSeconds: 1 }],
        },
      }).sellPoints
    ).toBe(61);
  });
  it("covers fal's mixed-reference example including the reference video", () => {
    // fal: $0.40 output + $0.70496 references. Product: 60 + 71 points.
    const result = estimateProductModelPoints({
      policy,
      referenceMedia: { images: [image, image], videos: [{ durationSeconds: 5 }] },
    });
    expect(result.referenceSurchargePoints).toBe(71);
    expect(result.sellPoints).toBe(131);
  });
  it("charges each output for the reference inputs it consumes", () => {
    expect(
      estimateProductModelPoints({
        policy,
        numOutputs: 2,
        referenceMedia: { videos: [{ durationSeconds: 15 }], audios: [{ durationSeconds: 15 }] },
      }).sellPoints
    ).toBe(558);
  });
  it.each([{ images: [{}] }, { videos: [{ durationSeconds: 0 }] }, { audios: [null] }])(
    "rejects incomplete reference evidence: %j",
    (referenceMedia) => {
      expect(() => estimateProductModelPoints({ policy, referenceMedia })).toThrow(
        /required for pricing/
      );
    }
  );
  it("does not silently estimate a metered reference from a count alone", () => {
    expect(() => estimateProductModelPoints({ policy, referenceImageCount: 1 })).toThrow(
      /facts are required/
    );
  });
});
