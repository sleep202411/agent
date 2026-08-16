export const COMPUTE_POINT_FIAT_CURRENCY = "USD" as const;

/**
 * Compute points are USD-cent anchored:
 * 1 compute point = US$0.01, so USD minor units map 1:1 to points.
 */
export const COMPUTE_POINTS_PER_USD_CENT = 1 as const;

export const COMPUTE_POINT_EXPLICIT_ADMIN_PRICING = "explicit_admin_pricing" as const;

export type AiProductPricingCurrency = "COMPUTE_POINTS";
export type AiProductPricingMode =
  | "fixed_per_output"
  | "parameter_matrix"
  | "per_second_matrix"
  | "per_character";

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

/**
 * Per-second pricing for duration-billed video models (e.g. Seedance, which
 * fal bills as `video_seconds`). The billed seconds come from the submitted
 * `duration`; non-numeric durations ('auto') and absent durations quote at
 * `autoQuoteSeconds` — the ceiling — so an estimate can never undercharge.
 */
export interface AiPerSecondMatrixPricingPolicy extends AiProductPricingBase {
  mode: "per_second_matrix";
  defaultResolution: string;
  /** resolution -> points charged per generated output second. */
  pointsPerSecond: Record<string, number>;
  /**
   * Optional lower rate when the provider is explicitly asked for video-only
   * output. Absent means audio does not change the provider price.
   */
  videoOnlyPointsPerSecond?: Record<string, number>;
  /** Provider's minimum billable duration; shorter requests bill this floor. */
  minSeconds: number;
  /** Provider's maximum duration; longer requests are clamped (and rejected upstream). */
  maxSeconds: number;
  /** Duration the product UI pre-selects; informational for pricing displays. */
  defaultSeconds: number;
  /** Seconds quoted when duration is 'auto'/absent — always the ceiling. */
  autoQuoteSeconds: number;
  /**
   * Optional alternate meter for providers that bill video-reference jobs on
   * `(input video seconds + output video seconds)` at a different rate from
   * ordinary text/image/audio-input jobs (Seedance 2.5).
   *
   * When at least one reference-video second is present, this matrix replaces
   * `pointsPerSecond` for the output duration and is also charged for the
   * combined reference-video duration. Keeping this declarative lets the
   * catalog, server preflight and clients quote the exact same contract.
   */
  referenceVideoPointsPerSecond?: Record<string, number>;
}

/** Character-metered product pricing for speech synthesis. */
export interface AiPerCharacterPricingPolicy extends AiProductPricingBase {
  mode: "per_character";
  pointsPerCharacter: number;
  minCharacters: number;
  maxCharacters: number;
  defaultCharacters: number;
}

export type AiProductPricingPolicy =
  | AiFixedPerOutputPricingPolicy
  | AiParameterMatrixPricingPolicy
  | AiPerSecondMatrixPricingPolicy
  | AiPerCharacterPricingPolicy;

export interface EstimateProductModelPointsInput {
  policy: AiProductPricingPolicy;
  numOutputs?: number;
  resolution?: string;
  quality?: string;
  /**
   * Video duration as submitted (string enum incl. 'auto', or plain seconds).
   * Takes precedence over `durationSeconds` when both are present.
   */
  duration?: string | number;
  /** Legacy numeric duration field (integer-slider video models). */
  durationSeconds?: number;
  /** Text billed by a character-metered provider (usually the prompt). */
  text?: string;
  referenceImageCount?: number;
  /** Combined duration of all reference videos supplied to the job. */
  referenceVideoSeconds?: number;
  /** Whether native audio is requested. Only affects policies with a video-only rate. */
  generateAudio?: boolean;
  hasMask?: boolean;
}

export interface EstimateProductModelPointsResult {
  sellPoints: number;
  pointsPerOutput: number;
  basePoints: number;
  referenceSurchargePoints: number;
  extraReferencePoints: number;
  referenceVideoSurchargePoints: number;
  maskSurchargePoints: number;
  outputCount: number;
  pricingVersion: string;
  selection: {
    resolution?: string;
    quality?: string;
    /** Billed seconds for per_second_matrix pricing. */
    seconds?: number;
    /** Billed Unicode code points for per_character pricing. */
    characters?: number;
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
  let referenceVideoSurchargePoints = 0;

  const requestedDuration = input.duration ?? input.durationSeconds;

  if (policy.mode === "fixed_per_output") {
    pointsPerOutput = positiveNumber(policy.pointsPerOutput) ?? 0;
  } else if (policy.mode === "per_second_matrix") {
    const resolution = selectPerSecondResolution(policy, input.resolution);
    const seconds = selectBilledSeconds(policy, requestedDuration);
    const referenceVideoSeconds = finiteNonNegative(input.referenceVideoSeconds) ?? 0;
    const referenceVideoRate = positiveNumber(policy.referenceVideoPointsPerSecond?.[resolution]);
    const videoOnlyRate = positiveNumber(policy.videoOnlyPointsPerSecond?.[resolution]);
    const perSecond =
      referenceVideoSeconds > 0 && referenceVideoRate !== undefined
        ? referenceVideoRate
        : input.generateAudio === false && videoOnlyRate !== undefined
          ? videoOnlyRate
          : (positiveNumber(policy.pointsPerSecond[resolution]) ?? 0);
    selection.resolution = resolution;
    selection.seconds = seconds;
    pointsPerOutput = perSecond * seconds;
    referenceVideoSurchargePoints =
      referenceVideoSeconds > 0 && referenceVideoRate !== undefined
        ? referenceVideoRate * referenceVideoSeconds
        : 0;
  } else if (policy.mode === "per_character") {
    const characters = selectBilledCharacters(policy, input.text);
    selection.characters = characters;
    pointsPerOutput = (positiveNumber(policy.pointsPerCharacter) ?? 0) * characters;
  } else {
    const resolution = selectMatrixResolution(policy, input.resolution);
    const quality = selectMatrixQuality(policy, resolution, input.quality, requestedDuration);
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
    basePoints +
      referenceSurchargePoints +
      extraReferencePoints +
      referenceVideoSurchargePoints +
      maskSurchargePoints
  );

  return {
    sellPoints: roundUp(rawTotal, roundTo),
    pointsPerOutput,
    basePoints,
    referenceSurchargePoints,
    extraReferencePoints,
    referenceVideoSurchargePoints,
    maskSurchargePoints,
    outputCount,
    pricingVersion: policy.version,
    selection,
  };
}

function selectBilledCharacters(
  policy: AiPerCharacterPricingPolicy,
  text: string | undefined
): number {
  const requested = typeof text === "string" ? Array.from(text).length : policy.defaultCharacters;
  return Math.min(Math.max(requested, policy.minCharacters), policy.maxCharacters);
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
  requested: string | undefined,
  duration?: string | number
): string {
  const row = policy.matrix[resolution] ?? {};
  if (requested && row[requested] !== undefined) return requested;
  // Duration-aware tier selection: when the caller supplies a duration (and no
  // explicit quality), bucket up to the smallest '<N>s' tier that covers it so
  // the quote never undercharges. The silent defaultQuality fallback applies
  // ONLY when no duration was given at all.
  if (duration !== undefined) {
    const tier = durationTierForRow(row, duration);
    if (tier !== undefined) return tier;
  }
  if (row[policy.defaultQuality] !== undefined) return policy.defaultQuality;
  return Object.keys(row)[0] ?? policy.defaultQuality;
}

/**
 * Picks the smallest '<N>s' duration tier >= the requested duration (clamped
 * to the top tier). Non-numeric durations ('auto') select the top tier —
 * ceiling pricing, never undercharge. Returns undefined when the row carries
 * no duration tiers (plain quality matrices stay on the default path).
 */
function durationTierForRow(
  row: Record<string, number>,
  duration: string | number
): string | undefined {
  const tiers = Object.keys(row)
    .map((key) => {
      const match = /^(\d+(?:\.\d+)?)s$/.exec(key);
      return match ? { key, seconds: Number(match[1]) } : null;
    })
    .filter((tier): tier is { key: string; seconds: number } => tier !== null)
    .sort((a, b) => a.seconds - b.seconds);
  if (tiers.length === 0) return undefined;
  const seconds = numericSeconds(duration);
  if (seconds === undefined) return tiers[tiers.length - 1].key;
  return (tiers.find((tier) => tier.seconds >= seconds) ?? tiers[tiers.length - 1]).key;
}

function selectPerSecondResolution(
  policy: AiPerSecondMatrixPricingPolicy,
  requested: string | undefined
): string {
  if (requested && policy.pointsPerSecond[requested] !== undefined) return requested;
  if (policy.pointsPerSecond[policy.defaultResolution] !== undefined) {
    return policy.defaultResolution;
  }
  return Object.keys(policy.pointsPerSecond)[0] ?? policy.defaultResolution;
}

function selectBilledSeconds(
  policy: AiPerSecondMatrixPricingPolicy,
  requested: string | number | undefined
): number {
  // Only an EXPLICIT 'auto' quotes at the ceiling (provider picks the length —
  // never undercharge). An ABSENT duration is quoted at defaultSeconds: the
  // submit validator fills the schema default before the provider call, so the
  // provider runs the default length — quoting the ceiling there would
  // overcharge sparse/API callers ~3x.
  if (requested === undefined) {
    return Math.min(Math.max(policy.defaultSeconds, policy.minSeconds), policy.maxSeconds);
  }
  const seconds = numericSeconds(requested);
  const effective = seconds ?? policy.autoQuoteSeconds;
  return Math.min(Math.max(effective, policy.minSeconds), policy.maxSeconds);
}

function numericSeconds(value: string | number): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function roundUp(value: number, increment: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value / increment) * increment;
}
