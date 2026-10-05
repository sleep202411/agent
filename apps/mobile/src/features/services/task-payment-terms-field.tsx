import { TASK_PAYMENT_TERMS, type TaskPaymentTerms } from "@repo/shared/crew";
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
  return (
    <View style={{ gap: 8 }}>
      <ThemedText>{t("taskPaymentTerms.label")}</ThemedText>
      {(required ? TASK_PAYMENT_TERMS : [null, ...TASK_PAYMENT_TERMS]).map((option) => (
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
