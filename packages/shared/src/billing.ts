export const COMPUTE_POINT_FIAT_CURRENCY = "USD" as const;

/**
 * Compute points are USD-cent anchored:
 * 1 compute point = US$0.01, so USD minor units map 1:1 to points.
 */
export const COMPUTE_POINTS_PER_USD_CENT = 1 as const;

export const COMPUTE_POINT_EXPLICIT_ADMIN_PRICING = "explicit_admin_pricing" as const;
