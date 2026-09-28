import { getAuthSnapshot, openAuthSheet } from "@/auth";
import { toHref } from "@/lib/navigation";
import { router } from "expo-router";

import { communityWebPath } from "./web-checkout";

export type PaywallCategory =
  | "community_points"
  | "compute_points"
  | "compute_membership"
  | "community_membership";

/** Categories shown as paywall tabs. */
export const PAYWALL_CATEGORIES: PaywallCategory[] = [
  "community_points",
  // Hidden until these IAPs exist in App Store Connect (2.1(b) review).
  // "compute_points",
  // "compute_membership",
  // "community_membership",
];

const ALL_PAYWALL_CATEGORIES: readonly PaywallCategory[] = [
  "community_points",
  // Hidden until a real App Store product exists (2.1(b)).
  // "compute_points",
  // "compute_membership",
  // "community_membership",
];

/** Any valid paywall category, including ones hidden from the tab strip. */
export function resolvePaywallCategory(value: string | undefined): PaywallCategory {
  return ALL_PAYWALL_CATEGORIES.includes(value as PaywallCategory)
    ? (value as PaywallCategory)
    : "community_points";
}

export function openPaywall(input: {
  category: PaywallCategory;
  communityReturnUrl?: string;
}): void {
  const go = () => {
    const params = new URLSearchParams({
      category: resolvePaywallCategory(input.category),
    });
    const returnPath = communityWebPath(input.communityReturnUrl);
    if (returnPath !== "/") params.set("returnPath", returnPath);
    router.push(toHref(`/pay?${params.toString()}`));
  };

  const auth = getAuthSnapshot();
  if (auth.status !== "authenticated") {
    openAuthSheet({
      mode: "login",
      onAuthenticated: go,
    });
    return;
  }
  go();
}
