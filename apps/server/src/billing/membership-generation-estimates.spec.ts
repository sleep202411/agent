import type { AiProductPricingPolicy } from '@repo/shared';
import { membershipGenerationEstimates } from './membership-generation-estimates';

const imagePricing: AiProductPricingPolicy = {
  mode: 'parameter_matrix',
  version: 'image-price-v1',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 4,
  defaultResolution: '1K',
  defaultQuality: 'medium',
  resolutionOptions: ['1K', '2K'],
  qualityOptions: ['low', 'medium'],
  matrix: {
    '1K': { low: 20, medium: 60 },
    '2K': { low: 30, medium: 90 },
  },
  referenceImageSurchargePoints: 15,
  extraReferenceImagePoints: 5,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

const videoPricing: AiProductPricingPolicy = {
  mode: 'per_second_matrix',
  version: 'video-price-v1',
  currency: 'COMPUTE_POINTS',
  defaultOutputCount: 1,
  minOutputCount: 1,
  maxOutputCount: 1,
  defaultResolution: '720p',
  pointsPerSecond: { '480p': 12, '720p': 25 },
  minSeconds: 4,
  maxSeconds: 15,
  defaultSeconds: 5,
  autoQuoteSeconds: 15,
  referenceImageSurchargePoints: 0,
  extraReferenceImagePoints: 0,
  maskSurchargePoints: 0,
  minimumPoints: 1,
  roundTo: 1,
};

const wanPricing: AiProductPricingPolicy = {
  ...videoPricing,
  version: 'wan-price-v1',
  defaultResolution: '720P',
  pointsPerSecond: { '480P': 10, '720P': 20 },
  minSeconds: 2,
};

const seedance25Pricing: AiProductPricingPolicy = {
  ...videoPricing,
  version: 'seedance-2-5-price-v1',
  pointsPerSecond: { '480p': 18, '720p': 38 },
};

const veoPricing: AiProductPricingPolicy = {
  ...videoPricing,
  version: 'veo-price-v1',
  defaultResolution: '1080p',
  pointsPerSecond: { '720p': 60, '1080p': 60 },
  videoOnlyPointsPerSecond: { '720p': 30, '1080p': 30 },
};

describe('membershipGenerationEstimates', () => {
  const models = [
    {
      slug: 'gpt-image-2',
      displayName: 'GPT Image 2',
      billingPolicy: { productPricing: imagePricing },
    },
    {
      slug: 'seedance-2-0',
      displayName: 'Seedance 2.0',
      billingPolicy: { productPricing: videoPricing },
    },
    {
      slug: 'wan-3-0',
      displayName: 'Wan 3.0',
      billingPolicy: { productPricing: wanPricing },
    },
    {
      slug: 'seedance-2-5',
      displayName: 'Seedance 2.5',
      billingPolicy: { productPricing: seedance25Pricing },
    },
    {
      slug: 'veo-3-1',
      displayName: 'Veo 3.1',
      billingPolicy: { productPricing: veoPricing },
    },
  ];

  it('projects included credits from each live model pricing floor', () => {
    expect(membershipGenerationEstimates(2_125n, models)).toEqual([
      {
        kind: 'image',
        modelId: 'gpt-image-2',
        modelName: 'GPT Image 2',
        estimatedOutputs: '106',
        unitPoints: 20,
        pricingVersion: 'image-price-v1',
        resolution: '1K',
        quality: 'low',
        durationSeconds: null,
        audioIncluded: null,
      },
      {
        kind: 'video',
        modelId: 'wan-3-0',
        modelName: 'Wan 3.0',
        estimatedOutputs: '106',
        unitPoints: 20,
        pricingVersion: 'wan-price-v1',
        resolution: '480P',
        quality: null,
        durationSeconds: 2,
        audioIncluded: true,
      },
      {
        kind: 'video',
        modelId: 'seedance-2-5',
        modelName: 'Seedance 2.5',
        estimatedOutputs: '29',
        unitPoints: 72,
        pricingVersion: 'seedance-2-5-price-v1',
        resolution: '480p',
        quality: null,
        durationSeconds: 4,
        audioIncluded: true,
      },
      {
        kind: 'video',
        modelId: 'seedance-2-0',
        modelName: 'Seedance 2.0',
        estimatedOutputs: '44',
        unitPoints: 48,
        pricingVersion: 'video-price-v1',
        resolution: '480p',
        quality: null,
        durationSeconds: 4,
        audioIncluded: true,
      },
      {
        kind: 'video',
        modelId: 'veo-3-1',
        modelName: 'Veo 3.1',
        estimatedOutputs: '17',
        unitPoints: 120,
        pricingVersion: 'veo-price-v1',
        resolution: '720p',
        quality: null,
        durationSeconds: 4,
        audioIncluded: false,
      },
    ]);
  });

  it('omits estimates when their canonical pricing is missing or invalid', () => {
    expect(
      membershipGenerationEstimates(2_125n, [
        {
          slug: 'gpt-image-2',
          displayName: 'GPT Image 2',
          billingPolicy: {},
        },
      ]),
    ).toEqual([]);
  });
});
