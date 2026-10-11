import { TaskPaymentTermsField } from "./task-payment-terms-field";
import { type TaskPaymentTerms } from "@repo/shared/crew";
import { TextInput, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
export function TaskCompensationFields({
  reward,
  rewardCurrency = "USD",
  share,
  onReward,
  onShare,
  locked,
  rewardRequired = false,
  paymentTerms,
  onPaymentTerms,
}: {
  reward: string;
  rewardCurrency?: "USD" | "CNY";
  share: string;
  onReward: (value: string) => void;
  onShare: (value: string) => void;
  locked: boolean;
  rewardRequired?: boolean;
  paymentTerms?: TaskPaymentTerms | null;
  onPaymentTerms?: (value: TaskPaymentTerms | null) => void;
}) {
  const t = useTranslations(),
    theme = useTheme();
  return (
    <View style={{ gap: 8 }}>
      {(
        [
          { key: "reward", value: reward, change: onReward },
          { key: "share", value: share, change: onShare },
        ] as const
      ).map((field) => (
        <View key={field.key}>
          <ThemedText>
            {t(`taskCompensation.${field.key}`).replace("{currency}", rewardCurrency)}
          </ThemedText>
          <TextInput
            accessibilityLabel={t(`taskCompensation.${field.key}`).replace(
              "{currency}",
              rewardCurrency
            )}
            value={field.value}
            onChangeText={(value) => {
              if (
                /^\d*(?:\.\d{0,2})?$/.test(value) &&
                (field.key !== "share" || Number(value || 0) <= 100)
              )
                field.change(value);
            }}
            editable={!locked}
            keyboardType="decimal-pad"
            maxLength={16}
            style={{ color: theme.text, padding: 12 }}
          />
        </View>
      ))}
      {onPaymentTerms && (
        <TaskPaymentTermsField
          value={paymentTerms ?? null}
          onChange={onPaymentTerms}
          locked={locked}
          required={rewardRequired}
        />
      )}
      <ThemedText>
        {t(rewardRequired ? "taskCreate.rewardHelp" : "taskCompensation.help")}
      </ThemedText>
    </View>
  );
}
