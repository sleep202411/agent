import {
  estimateProductModelPoints,
  type AiProductPricingPolicy,
  type EstimateProductModelPointsResult,
} from '@repo/shared';

type EstimateKind = 'image' | 'video';

const MEMBERSHIP_GENERATION_ESTIMATE_MODELS = [
  { slug: 'gpt-image-2', kind: 'image' },
  { slug: 'wan-3-0', kind: 'video' },
  { slug: 'seedance-2-5', kind: 'video' },
  { slug: 'seedance-2-0', kind: 'video' },
  { slug: 'veo-3-1', kind: 'video' },
] as const satisfies readonly { slug: string; kind: EstimateKind }[];

export const MEMBERSHIP_GENERATION_ESTIMATE_MODEL_SLUGS =
  MEMBERSHIP_GENERATION_ESTIMATE_MODELS.map((model) => model.slug);

export interface MembershipGenerationEstimateModel {
  slug: string;
  displayName: string;
  billingPolicy: unknown;
}

export interface MembershipGenerationEstimate {
  kind: EstimateKind;
  modelId: string;
  modelName: string;
  estimatedOutputs: string;
  unitPoints: number;
  pricingVersion: string;
  resolution: string | null;
  quality: string | null;
  durationSeconds: number | null;
  audioIncluded: boolean | null;
}

interface CheapestEstimate {
  result: EstimateProductModelPointsResult;
  audioIncluded: boolean | null;
}

/**
 * Project a plan's included compute credits into transparent reference output
 * counts. The product catalog remains the price authority: no generation cost
 * is duplicated in billing or Studio copy. Missing/invalid model pricing omits
 * that estimate instead of publishing a stale fallback.
 */
export function membershipGenerationEstimates(
  includedComputeCredits: bigint,
  models: readonly MembershipGenerationEstimateModel[],
): MembershipGenerationEstimate[] {
  const modelBySlug = new Map(models.map((model) => [model.slug, model]));

  return MEMBERSHIP_GENERATION_ESTIMATE_MODELS.flatMap((definition) => {
    const model = modelBySlug.get(definition.slug);
    if (!model) return [];
    const estimate = estimateForModel(
      definition.kind,
      model,
      includedComputeCredits,
    );
    return estimate ? [estimate] : [];
  });
}

function estimateForModel(
  kind: EstimateKind,
  model: MembershipGenerationEstimateModel,
  includedComputeCredits: bigint,
): MembershipGenerationEstimate | null {
  const pricing = productPricing(model.billingPolicy);
  if (!pricing) return null;

  const cheapest = cheapestEstimate(pricing);
  if (
    !cheapest ||
    !Number.isSafeInteger(cheapest.result.sellPoints) ||
    cheapest.result.sellPoints <= 0
  ) {
    return null;
  }
  const estimate = cheapest.result;

  return {
    kind,
    modelId: model.slug,
    modelName: model.displayName,
    estimatedOutputs: (
      includedComputeCredits / BigInt(estimate.sellPoints)
    ).toString(),
    unitPoints: estimate.sellPoints,
    pricingVersion: estimate.pricingVersion,
    resolution: estimate.selection.resolution ?? null,
    quality: estimate.selection.quality ?? null,
    durationSeconds: estimate.selection.seconds ?? null,
    audioIncluded: cheapest.audioIncluded,
  };
}

function cheapestEstimate(
  pricing: AiProductPricingPolicy,
): CheapestEstimate | null {
  try {
    if (pricing.mode === 'parameter_matrix') {
      const candidates: EstimateProductModelPointsResult[] = [];
      for (const [resolution, qualities] of Object.entries(pricing.matrix)) {
        for (const quality of Object.keys(qualities)) {
          candidates.push(
            estimateProductModelPoints({
              policy: pricing,
              resolution,
              quality,
              numOutputs: pricing.minOutputCount,
            }),
          );
        }
      }
      const result = lowestPoints(candidates);
      return result ? { result, audioIncluded: null } : null;
    }

    if (pricing.mode === 'per_second_matrix') {
      const candidates: CheapestEstimate[] = [];
      for (const resolution of Object.keys(pricing.pointsPerSecond)) {
        candidates.push({
          result: estimateProductModelPoints({
            policy: pricing,
            resolution,
            duration: pricing.minSeconds,
            numOutputs: pricing.minOutputCount,
          }),
          audioIncluded: true,
        });
        if (pricing.videoOnlyPointsPerSecond?.[resolution] !== undefined) {
          candidates.push({
            result: estimateProductModelPoints({
              policy: pricing,
              resolution,
              duration: pricing.minSeconds,
              numOutputs: pricing.minOutputCount,
              generateAudio: false,
            }),
            audioIncluded: false,
          });
        }
      }
      return lowestEstimate(candidates);
    }

    return {
      result: estimateProductModelPoints({
        policy: pricing,
        numOutputs: pricing.minOutputCount,
      }),
      audioIncluded: null,
    };
  } catch {
    return null;
  }
}

function lowestEstimate(
  candidates: readonly CheapestEstimate[],
): CheapestEstimate | null {
  return (
    candidates.reduce<CheapestEstimate | null>(
      (lowest, candidate) =>
        lowest === null ||
        candidate.result.sellPoints < lowest.result.sellPoints
          ? candidate
          : lowest,
      null,
    ) ?? null
  );
}

function lowestPoints(
  candidates: readonly EstimateProductModelPointsResult[],
): EstimateProductModelPointsResult | null {
  return (
    candidates.reduce<EstimateProductModelPointsResult | null>(
      (lowest, candidate) =>
        lowest === null || candidate.sellPoints < lowest.sellPoints
          ? candidate
          : lowest,
      null,
    ) ?? null
  );
}

function productPricing(billingPolicy: unknown): AiProductPricingPolicy | null {
  if (!isRecord(billingPolicy) || !isRecord(billingPolicy.productPricing))
    return null;
  return billingPolicy.productPricing as unknown as AiProductPricingPolicy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
