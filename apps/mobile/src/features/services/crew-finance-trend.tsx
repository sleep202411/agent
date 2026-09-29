import { useState } from "react";
import { Pressable, View } from "react-native";
import Svg, { Line, Polygon, Polyline } from "react-native-svg";
import { ThemedText } from "@/components/themed-text";
import { useTranslations } from "@/i18n";
import { useTheme } from "@/hooks/use-theme";
import { formatFinanceMoney } from "./crew-finance-api";
import { financeTrendGeometry } from "./crew-finance-trend-data";
export function CrewFinanceTrend({
  value,
  currency,
  failed = false,
}: {
  value: unknown;
  currency: "USD" | "CNY";
  failed?: boolean;
}) {
  const t = useTranslations(),
    theme = useTheme(),
    [expanded, setExpanded] = useState(false);
  const graph = failed ? null : financeTrendGeometry(value);
  return (
    <View style={{ gap: 10, paddingVertical: 12 }}>
      <ThemedText>{t("crewFinance.trend")}</ThemedText>
      <ThemedText>{t("crewFinance.trendBasis")}</ThemedText>
      {!graph ? (
        <ThemedText>{t("crewFinance.trendUnavailable")}</ThemedText>
      ) : (
        <>
          <ThemedText>
            {t("crewFinance.trendMax")} · {formatFinanceMoney(graph.max, currency)}
          </ThemedText>
          <Svg
            height={160}
            width="100%"
            viewBox="0 0 600 160"
            accessibilityRole="image"
            accessibilityLabel={t("crewFinance.trend")}
          >
            <Line
              x1={20}
              x2={580}
              y1={graph.baseline}
              y2={graph.baseline}
              stroke={theme.text}
              opacity={0.25}
            />
            <Polygon
              points={`20,${graph.baseline} ${graph.points} 580,${graph.baseline}`}
              fill={theme.text}
              opacity={0.08}
            />
            <Polyline points={graph.points} fill="none" stroke={theme.text} strokeWidth={2} />
          </Svg>
          <ThemedText>
            {t("crewFinance.trendMin")} · {formatFinanceMoney(graph.min, currency)}
          </ThemedText>
          <ThemedText>
            {graph.data.days[0]!.date} – {graph.data.days[29]!.date} (UTC)
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            style={{ paddingVertical: 12 }}
            onPress={() => setExpanded((old) => !old)}
          >
            <ThemedText>{t("crewFinance.dailyAmounts")}</ThemedText>
          </Pressable>
          {expanded &&
            graph.data.days.map((day) => (
              <View
                key={day.date}
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  justifyContent: "space-between",
                  gap: 8,
                }}
              >
                <ThemedText>{day.date}</ThemedText>
                <ThemedText>{formatFinanceMoney(day.amountMinor, currency)}</ThemedText>
              </View>
            ))}
        </>
      )}
    </View>
  );
}
