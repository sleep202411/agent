export const COMPUTE_POINT_FIAT_CURRENCY = "USD" as const;

/**
 * Compute points are USD-cent anchored:
 * 1 compute point = US$0.01, so USD minor units map 1:1 to points.
 */
export const COMPUTE_POINTS_PER_USD_CENT = 1 as const;

export const COMPUTE_POINT_EXPLICIT_ADMIN_PRICING = "explicit_admin_pricing" as const;

export type AiProductPricingCurrency = "COMPUTE_POINTS";
export type AiProductPricingMode = "fixed_per_output" | "parameter_matrix";

interface AiProductPricingBase {
  /**
   * Immutable product-pricing version. Jobs should snapshot this later when
   * price freezing is implemented.
   */
  version: string;
  currency: AiProductPricingCurrency;
  defaultOutputCount?: number;
  minOutputCount?: number;
  maxOutputCount?: number;
  minimumPoints?: number;
  /** Round final sell points up to this increment. Defaults to 1. */
  roundTo?: number;
  /** Charged per generated output when at least one reference image is used. */
  referenceImageSurchargePoints?: number;
  /** Charged once per job for each reference image after the first. */
  extraReferenceImagePoints?: number;
  /** Charged per generated output when a mask is supplied. */
  maskSurchargePoints?: number;
}

export interface AiFixedPerOutputPricingPolicy extends AiProductPricingBase {
  mode: "fixed_per_output";
  pointsPerOutput: number;
}

export interface AiParameterMatrixPricingPolicy extends AiProductPricingBase {
  mode: "parameter_matrix";
  defaultResolution: string;
  defaultQuality: string;
  resolutionOptions?: string[];
  qualityOptions?: string[];
  /** resolution -> quality -> points per generated output. */
  matrix: Record<string, Record<string, number>>;
}

export type AiProductPricingPolicy = AiFixedPerOutputPricingPolicy | AiParameterMatrixPricingPolicy;

export interface EstimateProductModelPointsInput {
  policy: AiProductPricingPolicy;
  numOutputs?: number;
  resolution?: string;
  quality?: string;
  referenceImageCount?: number;
  hasMask?: boolean;
}

export interface EstimateProductModelPointsResult {
  sellPoints: number;
  pointsPerOutput: number;
  basePoints: number;
  referenceSurchargePoints: number;
  extraReferencePoints: number;
  maskSurchargePoints: number;
  outputCount: number;
  pricingVersion: string;
  selection: {
    resolution?: string;
    quality?: string;
  };
}

export function estimateProductModelPoints(
  input: EstimateProductModelPointsInput
): EstimateProductModelPointsResult {
  const policy = input.policy;
  const outputCount = normalizeOutputCount(input.numOutputs, policy);
  const referenceImageCount = Math.max(0, Math.floor(input.referenceImageCount ?? 0));
  const roundTo = positiveInteger(policy.roundTo) ?? 1;

  const selection: EstimateProductModelPointsResult["selection"] = {};
  let pointsPerOutput: number;

  if (policy.mode === "fixed_per_output") {
    pointsPerOutput = positiveNumber(policy.pointsPerOutput) ?? 0;
  } else {
    const resolution = selectMatrixResolution(policy, input.resolution);
    const quality = selectMatrixQuality(policy, resolution, input.quality);
    selection.resolution = resolution;
    selection.quality = quality;
    pointsPerOutput = positiveNumber(policy.matrix[resolution]?.[quality]) ?? 0;
  }

  const basePoints = pointsPerOutput * outputCount;
  const referenceSurchargePoints =
    referenceImageCount > 0
      ? (positiveNumber(policy.referenceImageSurchargePoints) ?? 0) * outputCount
      : 0;
  const extraReferencePoints =
    referenceImageCount > 1
      ? (referenceImageCount - 1) * (positiveNumber(policy.extraReferenceImagePoints) ?? 0)
      : 0;
  const maskSurchargePoints =
    input.hasMask === true ? (positiveNumber(policy.maskSurchargePoints) ?? 0) * outputCount : 0;

  const minimumPoints = positiveNumber(policy.minimumPoints) ?? 0;
  const rawTotal = Math.max(
    minimumPoints,
    basePoints + referenceSurchargePoints + extraReferencePoints + maskSurchargePoints
  );

  return {
    sellPoints: roundUp(rawTotal, roundTo),
    pointsPerOutput,
    basePoints,
    referenceSurchargePoints,
    extraReferencePoints,
    maskSurchargePoints,
    outputCount,
    pricingVersion: policy.version,
    selection,
  };
}

function normalizeOutputCount(value: number | undefined, policy: AiProductPricingBase): number {
  const fallback = positiveInteger(policy.defaultOutputCount) ?? 1;
  const min = positiveInteger(policy.minOutputCount) ?? 1;
  const max = positiveInteger(policy.maxOutputCount) ?? 100;
  const requested = positiveInteger(value) ?? fallback;
  return Math.min(Math.max(requested, min), max);
}

function selectMatrixResolution(
  policy: AiParameterMatrixPricingPolicy,
  requested: string | undefined
): string {
  if (requested && policy.matrix[requested]) return requested;
  if (policy.matrix[policy.defaultResolution]) return policy.defaultResolution;
  return Object.keys(policy.matrix)[0] ?? policy.defaultResolution;
}

function selectMatrixQuality(
  policy: AiParameterMatrixPricingPolicy,
  resolution: string,
  requested: string | undefined
): string {
  const row = policy.matrix[resolution] ?? {};
  if (requested && row[requested] !== undefined) return requested;
  if (row[policy.defaultQuality] !== undefined) return policy.defaultQuality;
  return Object.keys(row)[0] ?? policy.defaultQuality;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function roundUp(value: number, increment: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value / increment) * increment;
}
