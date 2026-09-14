import Constants from "expo-constants";
import { Platform } from "react-native";

import { isProductionApp } from "@/config";

import { currentCheckoutChannel, type CheckoutChannel } from "./checkout-channel";

type ExtraPaywall = {
  revenueCatAppleApiKey?: string;
  revenueCatGoogleApiKey?: string;
  wechatAppId?: string;
  wechatUniversalLink?: string;
};

function extraPaywall(): ExtraPaywall {
  const extra = Constants.expoConfig?.extra as { paywall?: ExtraPaywall } | undefined;
  return extra?.paywall ?? {};
}

export function revenueCatApiKey(channel: CheckoutChannel = currentCheckoutChannel()): string {
  const extra = extraPaywall();
  if (channel === "apple_iap") return extra.revenueCatAppleApiKey?.trim() ?? "";
  if (channel === "google_play_iap") return extra.revenueCatGoogleApiKey?.trim() ?? "";
  return "";
}

export function wechatAppId(): string {
  return extraPaywall().wechatAppId?.trim() ?? "";
}

export function wechatUniversalLink(): string {
  return extraPaywall().wechatUniversalLink?.trim() ?? "";
}

/** Dev / Expo web always mock. Production native requires keys then the SDK. */
export function mustUseMockPayments(_channel: CheckoutChannel): boolean {
  if (Platform.OS === "web") return true;
  return !isProductionApp;
}

export function missingPaymentKeyMessage(channel: CheckoutChannel): string {
  if (channel === "wechat") {
    return "[paywall] EXPO_PUBLIC_WECHAT_APP_ID is required for WeChat Pay on this build.";
  }
  if (channel === "apple_iap") {
    return "[paywall] EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY is required for Apple IAP on this build.";
  }
  if (channel === "google_play_iap") {
    return "[paywall] EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY is required for Google Play IAP on this build.";
  }
  if (channel === "web") {
    return "[paywall] This device has no native payment rail.";
  }
  return "[paywall] No native payment key is configured for this channel.";
}

export function assertPaymentReady(channel: CheckoutChannel): void {
  if (channel === "web") return;
  if (!isProductionApp || Platform.OS === "web") return;
  if (mustUseMockPayments(channel)) {
    throw new Error(missingPaymentKeyMessage(channel));
  }
  if (channel === "wechat" && !wechatAppId()) {
    throw new Error(missingPaymentKeyMessage(channel));
  }
  if ((channel === "apple_iap" || channel === "google_play_iap") && !revenueCatApiKey(channel)) {
    throw new Error(missingPaymentKeyMessage(channel));
  }
}
