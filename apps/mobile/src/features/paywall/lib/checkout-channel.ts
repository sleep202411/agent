import { Platform } from "react-native";

import { appEnv } from "@/config";

/**
 * Where this install collects fiat.
 *
 * Native rails: Apple IAP, Google Play Billing, WeChat Pay.
 * Everything else (Expo web, Transsion / sideload, unknown Android) is `web` —
 * the sheet sends the user to the public site to buy community points.
 */
export type CheckoutChannel = "apple_iap" | "google_play_iap" | "wechat" | "web";

const PLAY_INSTALLERS = new Set(["com.android.vending", "com.google.android.feedback"]);

/** PalmStore / Transsion family — no Play Billing, no WeChat on the global APK. */
const TRANSSION_MARKERS = ["tecno", "infinix", "itel", "transsion"];

export function resolveCheckoutChannel(input: {
  os: typeof Platform.OS;
  appRegion: typeof appEnv.appRegion;
  installerPackageName?: string | null;
  brand?: string | null;
  manufacturer?: string | null;
}): CheckoutChannel {
  if (input.os === "web") return "web";
  if (input.os === "ios") return "apple_iap";
  if (input.appRegion === "cn") return "wechat";
  if (input.os === "android") {
    if (lacksGooglePlayBilling(input)) return "web";
    return "google_play_iap";
  }
  return "web";
}

export function currentCheckoutChannel(): CheckoutChannel {
  const android =
    Platform.OS === "android"
      ? (Platform.constants as { Brand?: string; Manufacturer?: string })
      : undefined;

  return resolveCheckoutChannel({
    os: Platform.OS,
    appRegion: appEnv.appRegion,
    brand: android?.Brand,
    manufacturer: android?.Manufacturer,
  });
}

function lacksGooglePlayBilling(input: {
  installerPackageName?: string | null;
  brand?: string | null;
  manufacturer?: string | null;
}): boolean {
  if (input.installerPackageName && !PLAY_INSTALLERS.has(input.installerPackageName)) {
    return true;
  }

  const hay = `${input.brand ?? ""} ${input.manufacturer ?? ""}`.toLowerCase();
  return TRANSSION_MARKERS.some((marker) => hay.includes(marker));
}
