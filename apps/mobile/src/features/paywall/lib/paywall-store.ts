import { getAuthSnapshot, openAuthSheet } from "@/auth";
import { toHref } from "@/lib/navigation";
import { router } from "expo-router";

import { communityWebPath } from "./web-checkout";

export type PaywallCategory =
  | "community_points"
  | "compute_points"
  | "compute_membership"
  | "community_membership";

export const PAYWALL_CATEGORIES: PaywallCategory[] = [
  "community_points",
  "compute_points",
  "compute_membership",
  "community_membership",
];

export function isPaywallCategory(value: string | undefined): value is PaywallCategory {
  return PAYWALL_CATEGORIES.includes(value as PaywallCategory);
}

export function openPaywall(input: {
  category: PaywallCategory;
  communityReturnUrl?: string;
}): void {
  const go = () => {
    const params = new URLSearchParams({ category: input.category });
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
