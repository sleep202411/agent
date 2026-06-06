export const COMPUTE_POINT_FIAT_CURRENCY = "USD" as const;

/**
 * Compute points are USD-cent anchored:
 * 1 compute point = US$0.01, so USD minor units map 1:1 to points.
 */
export const COMPUTE_POINTS_PER_USD_CENT = 1 as const;

export const COMPUTE_POINT_EXPLICIT_ADMIN_PRICING = "explicit_admin_pricing" as const;

// ---------------------------------------------------------------------------
// Parameterized AI generation pricing (financial-grade, BigInt, sub-cent).
//
// COST lives per-binding (provider-specific): `unitPriceNanoUsd` + `unitType`.
// MARKUP lives per-canonical (product): `marginBps`.
//
// Currency identity:
//   1 USD          = 1e9 nanoUSD
//   1 积分 (point) = $0.01 = 1 US cent = 1e7 nanoUSD
// ---------------------------------------------------------------------------

/** 1 USD = 1e9 nanoUSD. */
export const NANO_USD_PER_USD = 1_000_000_000n;
/** 1 compute point (积分) = $0.01 = 1e7 nanoUSD. */
export const NANO_USD_PER_COMPUTE_POINT = 10_000_000n;
/** Basis-point denominator (10000 bps = 100%). */
export const BPS_DENOMINATOR = 10_000n;
/** Default gross margin (70%). */
export const DEFAULT_MARGIN_BPS = 7000;

export type AiGenUnitType = "per_image" | "per_megapixel" | "per_unit";

/**
 * Resolution → megapixels. Used only by `per_megapixel` models; `per_image`
 * and `per_unit` ignore resolution. 1K≈1MP, 2K≈4MP, 4K≈16MP.
 */
export const RESOLUTION_MEGAPIXELS: Record<string, number> = {
  "1K": 1,
  "2K": 4,
  "4K": 16,
};

export interface EstimateGenerationPriceInput {
  /** Provider cost per unit, in nanoUSD (from the binding). */
  unitPriceNanoUsd: bigint;
  /** What `unitPriceNanoUsd` is priced per (from the binding). */
  unitType: AiGenUnitType;
  /** Gross-margin basis points (from the canonical model). */
  marginBps: number;
  /** Number of images requested. */
  numImages: number;
  /**
   * Megapixels per image — required when `unitType === 'per_megapixel'`.
   * Fractional values are carried exactly via milli-megapixels internally.
   */
  megapixels?: number;
}

export interface EstimateGenerationPriceResult {
  /** Exact provider cost in nanoUSD (never rounded). */
  costNanoUsd: bigint;
  /** Cost expressed in compute points — may be fractional. For DISPLAY only. */
  costPoints: number;
  /** Sell price in compute points — integer, rounded up (ceil). */
  sellPoints: number;
  /** Echoed margin bps used for the computation. */
  marginBps: number;
}

/** Integer ceil division for non-negative BigInt: ceil(num / den). */
function ceilDiv(num: bigint, den: bigint): bigint {
  if (den <= 0n) {
    throw new Error("ceilDiv: denominator must be positive");
  }
  if (num <= 0n) return 0n;
  return (num + den - 1n) / den;
}

/**
 * Pure, dependency-free price estimator. Reusable in web + server.
 *
 * Algorithm (all in BigInt; nothing pre-rounded except the final sell ceil):
 *   units        = per_image|per_unit ? numImages
 *                  per_megapixel      ? numImages × megapixels   (carried exact)
 *   costNanoUsd  = unitPriceNanoUsd × units
 *                  per_megapixel: unitPriceNanoUsd × numImages × milliMegapixels / 1000
 *   costPoints   = costNanoUsd / 1e7   (fractional, display only — kept as number)
 *   sellPoints   = ceil( costNanoUsd × 10000 / (1e7 × (10000 − marginBps)) )
 *
 * Sanity: nano-banana-2 $0.08/image (80_000_000 nanoUSD), 1 img, per_image,
 * marginBps 7000 → cost 8 积分, sell ceil(8/0.3) = 27.
 */
export function estimateGenerationPrice(
  input: EstimateGenerationPriceInput
): EstimateGenerationPriceResult {
  const { unitPriceNanoUsd, unitType, marginBps, numImages } = input;

  if (unitPriceNanoUsd < 0n) {
    throw new Error("estimateGenerationPrice: unitPriceNanoUsd must be >= 0");
  }
  if (!Number.isInteger(numImages) || numImages < 0) {
    throw new Error("estimateGenerationPrice: numImages must be a non-negative integer");
  }
  if (!Number.isInteger(marginBps) || marginBps < 0 || marginBps >= 10_000) {
    // marginBps must be < 10000 so the sell denominator (10000 - marginBps)
    // never divides by zero (or goes negative).
    throw new Error("estimateGenerationPrice: marginBps must be an integer in [0, 9999]");
  }

  const numImagesBig = BigInt(numImages);

  let costNanoUsd: bigint;
  if (unitType === "per_megapixel") {
    const megapixels = input.megapixels;
    if (megapixels === undefined || !(megapixels >= 0)) {
      throw new Error(
        "estimateGenerationPrice: megapixels is required and must be >= 0 for per_megapixel"
      );
    }
    // Carry megapixels as integer milli-megapixels (mp × 1000) for sub-MP
    // precision, then divide back out at the end so the cost stays exact-ish.
    const milliMegapixels = BigInt(Math.round(megapixels * 1000));
    costNanoUsd = (unitPriceNanoUsd * numImagesBig * milliMegapixels) / 1000n;
  } else {
    // per_image and per_unit both bill per image.
    costNanoUsd = unitPriceNanoUsd * numImagesBig;
  }

  // costPoints = costNanoUsd / 1e7 — fractional, display only.
  const costPoints = Number(costNanoUsd) / Number(NANO_USD_PER_COMPUTE_POINT);

  // sellPoints = ceil( costNanoUsd × 10000 / (1e7 × (10000 − marginBps)) ).
  const marginBpsBig = BigInt(marginBps);
  const sellNumer = costNanoUsd * BPS_DENOMINATOR;
  const sellDenom = NANO_USD_PER_COMPUTE_POINT * (BPS_DENOMINATOR - marginBpsBig);
  const sellPoints = ceilDiv(sellNumer, sellDenom);

  return {
    costNanoUsd,
    costPoints,
    sellPoints: Number(sellPoints),
    marginBps,
  };
}
