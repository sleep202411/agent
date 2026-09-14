/**
 * Community-point checkout on the public web — used when this device has no
 * native rail (Apple IAP / Play Billing / WeChat Pay).
 *
 * Loads apps/web with the app session cookie, without the native-shell UA, so
 * the site chrome (credits chip → recharge) is available.
 */
import { useLocalSearchParams } from "expo-router";

import { AuthedWebView } from "@/components/authed-web-view";
import { sanitizeAppWebPath } from "@/features/paywall/lib/web-checkout";
import { useTranslations } from "@/i18n";

export default function CommunityPayWebScreen() {
  const t = useTranslations();
  const { returnPath } = useLocalSearchParams<{ returnPath?: string | string[] }>();
  const raw = Array.isArray(returnPath) ? returnPath[0] : returnPath;
  const path = sanitizeAppWebPath(raw);

  return <AuthedWebView nativeShell={false} path={path} title={t("paywall.continueWeb")} />;
}
