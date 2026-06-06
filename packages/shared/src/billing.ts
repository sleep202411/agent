export const COMPUTE_POINT_FIAT_CURRENCY = "USD" as const;

/**
 * Compute points are USD-cent anchored:
 * 1 compute point = US$0.01, so USD minor units map 1:1 to points.
 */
export const COMPUTE_POINTS_PER_USD_CENT = 1 as const;

export const USD_CENTS_PER_COMPUTE_POINT = 1 as const;
export const COMPUTE_POINT_EXPLICIT_ADMIN_PRICING = "explicit_admin_pricing" as const;

export const COMPUTE_POINT_TOPUP_PACKAGES = [
  {
    code: "COMPUTE_POINT_5000_USD_5000",
    points: 5000,
    amountMinor: 5000,
  },
  {
    code: "COMPUTE_POINT_10000_USD_10000",
    points: 10000,
    amountMinor: 10000,
  },
  {
    code: "COMPUTE_POINT_30000_USD_30000",
    points: 30000,
    amountMinor: 30000,
  },
] as const;

export type ComputePointTopupPackage = (typeof COMPUTE_POINT_TOPUP_PACKAGES)[number];

export function computePointsForUsdMinor(amountMinor: number): number {
  return amountMinor * COMPUTE_POINTS_PER_USD_CENT;
}
