import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { getAuthGeneration } from "@/auth/auth-store";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { fetchCrewSpend, type CrewSpend } from "./crew-spend-api";
import { formatFinanceMoney } from "./crew-finance-api";
export function CrewSpendSummary(props: {
  crewId: string;
  generation: number;
  onClose: () => void;
}) {
  const t = useTranslations();
  const [revision, setRevision] = useState(0);
  return (
    <View style={{ flex: 1 }}>
      <Snapshot key={revision} {...props} />
      <Pressable
        accessibilityRole="button"
        style={{ padding: 12 }}
        onPress={() => setRevision((n) => n + 1)}
      >
        <ThemedText>{t("thread.refresh")}</ThemedText>
      </Pressable>
      <Pressable accessibilityRole="button" style={{ padding: 12 }} onPress={props.onClose}>
        <ThemedText>{t("crewExpenses.back")}</ThemedText>
      </Pressable>
    </View>
  );
}
function Snapshot({ crewId, generation }: { crewId: string; generation: number }) {
  const t = useTranslations();
  const [data, setData] = useState<CrewSpend>(),
    [error, setError] = useState<string>();
  useEffect(() => {
    const c = new AbortController();
    void fetchCrewSpend(crewId, c.signal).then(
      (value) => {
        if (!c.signal.aborted && generation === getAuthGeneration()) setData(value);
      },
      (cause) => {
        if (!c.signal.aborted && generation === getAuthGeneration())
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    );
    return () => c.abort();
  }, [crewId, generation]);
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
      <ThemedText>{t("crewSpend.heading")}</ThemedText>
      <ThemedText>{t("crewSpend.help")}</ThemedText>
      {!data && !error && <ActivityIndicator />}
      {error && <ThemedText accessibilityRole="alert">{error}</ThemedText>}
      {data &&
        (["USD", "CNY"] as const).map((currency) => (
          <View key={currency} style={{ gap: 8 }}>
            <ThemedText>{currency}</ThemedText>
            {(
              [
                ["taskRewardsByCurrency", "rewards"],
                ["reimbursementsByCurrency", "reimbursements"],
                ["totalByCurrency", "total"],
              ] as const
            ).map(([field, label]) => (
              <ThemedText key={field}>
                {t(`crewSpend.${label}`)} · {formatFinanceMoney(data[field][currency], currency)}
              </ThemedText>
            ))}
          </View>
        ))}
    </ScrollView>
  );
}
