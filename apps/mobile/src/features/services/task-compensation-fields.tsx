import { useState } from "react";
import { TaskPaymentTermsField } from "./task-payment-terms-field";
import { type TaskPaymentTerms } from "@repo/shared/crew";
import { Pressable, TextInput, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
export function TaskCompensationFields({
  reward,
  rewardCurrency = "USD",
  onCurrency,
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
  onCurrency?: (value: "USD" | "CNY") => void;
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
  const [mode, setMode] = useState(Number(share) > 0 ? (reward ? "both" : "share") : "cash");
  return (
    <View style={{ gap: 8 }}>
      <ThemedText>{t("taskCompensation.mode")}</ThemedText>
      <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {(["cash", "share", "both"] as const).map((option) => (
          <Pressable
            key={option}
            accessibilityRole="radio"
            disabled={locked}
            accessibilityState={{ disabled: locked, checked: mode === option }}
            onPress={() => {
              setMode(option);
              if (option === "share") onReward("");
              if (option === "cash") onShare("");
            }}
            style={{
              padding: 12,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: mode === option ? theme.text : "transparent",
            }}
          >
            <ThemedText>{t(`taskCompensation.${option}Mode`)}</ThemedText>
          </Pressable>
        ))}
      </View>
      {onCurrency && (
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          <ThemedText>{t("taskCompensation.currency")}</ThemedText>
          {(["USD", "CNY"] as const).map((currency) => (
            <Pressable
              key={currency}
              accessibilityRole="radio"
              accessibilityLabel={currency}
              accessibilityState={{ checked: rewardCurrency === currency, disabled: locked }}
              disabled={locked}
              onPress={() => onCurrency(currency)}
              style={{
                padding: 12,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: rewardCurrency === currency ? theme.text : "transparent",
              }}
            >
              <ThemedText>{currency}</ThemedText>
            </Pressable>
          ))}
        </View>
      )}
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
              ) {
                field.change(value);
                setMode(
                  field.key === "reward"
                    ? Number(share) > 0
                      ? value
                        ? "both"
                        : "share"
                      : "cash"
                    : Number(value) > 0
                      ? reward
                        ? "both"
                        : "share"
                      : "cash"
                );
              }
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
