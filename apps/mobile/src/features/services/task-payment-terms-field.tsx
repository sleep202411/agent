import { useState } from "react";
import { CURRENT_TASK_PAYMENT_TERMS, type TaskPaymentTerms } from "@repo/shared/crew";
import { Pressable, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";

export function TaskPaymentTermsField({
  value,
  onChange,
  locked,
  required = false,
}: {
  value: TaskPaymentTerms | null;
  onChange: (value: TaskPaymentTerms | null) => void;
  locked: boolean;
  required?: boolean;
}) {
  const t = useTranslations();
  const [showHelp, setShowHelp] = useState(false);
  const options: readonly TaskPaymentTerms[] =
    value === "monthly" ? ["monthly", ...CURRENT_TASK_PAYMENT_TERMS] : CURRENT_TASK_PAYMENT_TERMS;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <ThemedText>{t("taskPaymentTerms.label")}</ThemedText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("taskPaymentTerms.help")}
          accessibilityState={{ expanded: showHelp }}
          onPress={() => setShowHelp(!showHelp)}
          style={{ minWidth: 44, minHeight: 44, justifyContent: "center", alignItems: "center" }}
        >
          <ThemedText>?</ThemedText>
        </Pressable>
      </View>
      {showHelp &&
        CURRENT_TASK_PAYMENT_TERMS.map((term) => (
          <ThemedText key={term}>
            {t(`taskPaymentTerms.${term}`)}: {t(`taskPaymentTerms.${term}Help`)}
          </ThemedText>
        ))}
      {(required ? options : [null, ...options]).map((option) => (
        <Pressable
          key={option ?? "unset"}
          accessibilityRole="radio"
          accessibilityState={{ checked: value === option, disabled: locked }}
          disabled={locked}
          onPress={() => onChange(option)}
          style={{ padding: 12 }}
        >
          <ThemedText>
            {value === option ? "● " : "○ "}
            {t(`taskPaymentTerms.${option ?? "unspecified"}`)}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}
