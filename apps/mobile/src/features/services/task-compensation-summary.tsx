import type { TaskPaymentTerms } from "@repo/shared/crew";
import { View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
export function TaskCompensationSummary({
  paymentTerms,
  rewardUsdMinor,
  profitShareBps,
}: {
  paymentTerms?: TaskPaymentTerms | null;
  rewardUsdMinor?: number | null;
  profitShareBps?: number | null;
}) {
  const t = useTranslations();
  return (
    <View style={{ gap: 4 }}>
      {paymentTerms && (
        <ThemedText>
          {t("taskPaymentTerms.label")}: {t(`taskPaymentTerms.${paymentTerms}`)}
        </ThemedText>
      )}
      {rewardUsdMinor !== undefined && (
        <ThemedText>
          {t("taskCompensation.rewardSummary")}:{" "}
          {rewardUsdMinor === null
            ? t("taskPlanning.unset")
            : `USD ${(rewardUsdMinor / 100).toFixed(2)}`}
        </ThemedText>
      )}
      {profitShareBps !== undefined && (
        <ThemedText>
          {t("taskCompensation.shareSummary")}:{" "}
          {profitShareBps === null
            ? t("taskPlanning.unset")
            : `${(profitShareBps / 100).toFixed(2)}%`}
        </ThemedText>
      )}
    </View>
  );
}
