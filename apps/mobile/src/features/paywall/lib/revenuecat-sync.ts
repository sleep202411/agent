import { Platform } from "react-native";

import { api } from "@/lib/api-client";

export type RevenueCatSyncResult = {
  fulfilled?: unknown;
  skipped?: unknown;
};

/** Java credits points from RevenueCat. There is no RevenueCat webhook. */
export function revenueCatSyncPlatform(): "ios" | "android" {
  return Platform.OS === "android" ? "android" : "ios";
}

export async function syncRevenueCatPurchases(): Promise<RevenueCatSyncResult> {
  return api.post<RevenueCatSyncResult>("/user/pay/rc/sync", {
    data: { platform: revenueCatSyncPlatform() },
    retry: false,
  });
}
