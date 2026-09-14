import { Platform } from "react-native";

import {
  assertPaymentReady,
  mustUseMockPayments,
  wechatAppId,
  wechatUniversalLink,
} from "./paywall-config";
import { currentCheckoutChannel } from "./checkout-channel";
import type { PaywallProduct } from "./catalog";
import type { PurchaseResult } from "./iap";

type ExpoWechat = typeof import("expo-wechat").default;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function loadWechat(): ExpoWechat {
  return require("expo-wechat").default as ExpoWechat;
}

async function ensureWechatRegistered(): Promise<ExpoWechat> {
  const appId = wechatAppId();
  if (!appId) {
    throw new Error("[paywall] EXPO_PUBLIC_WECHAT_APP_ID is required for WeChat Pay.");
  }

  let sdk: ExpoWechat;
  try {
    sdk = loadWechat();
  } catch {
    throw new Error(
      "[paywall] expo-wechat is not in this binary. Rebuild the CN Android dev client."
    );
  }

  if (!sdk.isRegistered) {
    const linked = await sdk.registerApp(appId, wechatUniversalLink() || "");
    if (!linked) {
      throw new Error("[paywall] WeChat OpenSDK registerApp failed.");
    }
  }

  const installed = await sdk.isWXAppInstalled();
  if (!installed) {
    throw new Error("[paywall] WeChat is not installed on this device.");
  }

  return sdk;
}

export async function purchaseWithWechat(product: PaywallProduct): Promise<PurchaseResult> {
  const channel = currentCheckoutChannel();
  assertPaymentReady(channel);
  if (Platform.OS === "web" || mustUseMockPayments(channel)) {
    await sleep(700);
    return { mocked: true, productId: product.storeProductId };
  }

  if (Platform.OS !== "android") {
    throw new Error("[paywall] WeChat Pay is only used on the CN Android build.");
  }

  await ensureWechatRegistered();
  throw new Error(
    `[paywall] WeChat OpenSDK is in the binary (${product.storeProductId}), but Nest still needs APP支付 (wechat_scene=app) plus paymentIntent.providerData before pay() can run.`
  );
}
