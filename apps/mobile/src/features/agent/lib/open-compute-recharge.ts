import { Alert, Linking } from "react-native";

import { webBaseUrl, type AppLocale } from "@/config";
import { getLocale, t } from "@/i18n";

/** Public site entry that redirects to Studio compute-credit billing. */
export function computeRechargeWebUrl(locale: AppLocale = getLocale()): string {
  return `${webBaseUrl.replace(/\/+$/, "")}/${locale}/membership`;
}

/** Asks first, then opens the FizzDragon website to top up compute credits. */
export function openComputeRecharge(): void {
  Alert.alert(t("agent.credits.webRechargeTitle"), t("agent.credits.webRechargeBody"), [
    { text: t("common.cancel"), style: "cancel" },
    {
      text: t("agent.credits.webRechargeOpen"),
      onPress: () => {
        void Linking.openURL(computeRechargeWebUrl()).catch(() => {
          Alert.alert(t("agent.credits.webRechargeTitle"), t("agent.credits.webRechargeBody"));
        });
      },
    },
  ]);
}
