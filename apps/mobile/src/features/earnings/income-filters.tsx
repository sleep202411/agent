import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { earning, earningStatuses } from "@/features/services/crew-finance-api";
import { incomeFiltersSchema, type IncomeFilters } from "./crew-income-api";

export function IncomeFilterFields({
  value,
  onApply,
}: {
  value: IncomeFilters;
  onApply(value: IncomeFilters): void;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const parsed = incomeFiltersSchema.safeParse(draft);
  const button = { minHeight: 44, justifyContent: "center" as const, paddingHorizontal: 8 };
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={button}
        onPress={() => {
          if (!open) setDraft(value);
          setOpen((v) => !v);
        }}
      >
        <ThemedText>{t("crewPersonalIncome.applyFilters")}</ThemedText>
      </Pressable>
      {!!value.sourceType && (
        <ThemedText type="small">
          {t("crewPersonalIncome.incomeType")}: {t(`crewIncome.sources.${value.sourceType}`)}
        </ThemedText>
      )}
      {!!value.status && (
        <ThemedText type="small">
          {t("crewPersonalIncome.status")}: {t(`crewPersonalIncome.${value.status}`)}
        </ThemedText>
      )}
      {!!value.recordedFrom && (
        <ThemedText type="small">
          {t("crewPersonalIncome.recordedFrom")}: {value.recordedFrom}
        </ThemedText>
      )}
      {!!value.recordedThrough && (
        <ThemedText type="small">
          {t("crewPersonalIncome.recordedThrough")}: {value.recordedThrough}
        </ThemedText>
      )}
      {open && (
        <>
          <ThemedText type="smallBold">{t("crewPersonalIncome.incomeType")}</ThemedText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
            {[undefined, ...earning.shape.sourceType.options].map((source) => (
              <Pressable
                key={source ?? "all"}
                accessibilityRole="radio"
                accessibilityState={{ selected: draft.sourceType === source }}
                style={[
                  button,
                  {
                    backgroundColor:
                      draft.sourceType === source
                        ? theme.backgroundSelected
                        : theme.backgroundElement,
                    borderRadius: 8,
                  },
                ]}
                onPress={() => setDraft((previous) => ({ ...previous, sourceType: source }))}
              >
                <ThemedText type="small">
                  {source ? t(`crewIncome.sources.${source}`) : t("crewPersonalIncome.allTypes")}
                </ThemedText>
              </Pressable>
            ))}
          </View>
          <ThemedText type="smallBold">{t("crewPersonalIncome.status")}</ThemedText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
            {[undefined, ...earningStatuses].map((status) => (
              <Pressable
                key={status ?? "all"}
                accessibilityRole="radio"
                accessibilityState={{ selected: draft.status === status }}
                style={[
                  button,
                  {
                    backgroundColor:
                      draft.status === status ? theme.backgroundSelected : theme.backgroundElement,
                    borderRadius: 8,
                  },
                ]}
                onPress={() => setDraft((previous) => ({ ...previous, status }))}
              >
                <ThemedText type="small">
                  {status ? t(`crewPersonalIncome.${status}`) : t("crewPersonalIncome.allStatuses")}
                </ThemedText>
              </Pressable>
            ))}
          </View>
          {(["recordedFrom", "recordedThrough"] as const).map((field) => (
            <View key={field} style={{ gap: 4 }}>
              <ThemedText type="small">{t(`crewPersonalIncome.${field}`)}</ThemedText>
              <TextInput
                accessibilityLabel={t(`crewPersonalIncome.${field}`)}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={theme.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                maxLength={10}
                value={draft[field] ?? ""}
                onChangeText={(value) =>
                  setDraft((previous) => ({ ...previous, [field]: value || undefined }))
                }
                style={{
                  color: theme.text,
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: theme.backgroundElement,
                }}
              />
            </View>
          ))}
          {!parsed.success && (
            <ThemedText accessibilityRole="alert">
              {t(
                draft.recordedFrom &&
                  draft.recordedThrough &&
                  draft.recordedFrom > draft.recordedThrough
                  ? "crewPersonalIncome.invalidDateRange"
                  : "crewPersonalIncome.invalidDate"
              )}
            </ThemedText>
          )}
          <Pressable
            accessibilityRole="button"
            style={button}
            disabled={!parsed.success}
            onPress={() => {
              if (parsed.success) {
                onApply(parsed.data);
                setOpen(false);
              }
            }}
          >
            <ThemedText>{t("crewPersonalIncome.applyFilters")}</ThemedText>
          </Pressable>
        </>
      )}
    </View>
  );
}
