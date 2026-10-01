import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { ThemedText } from "@/components/themed-text";
import { useTheme } from "@/hooks/use-theme";
import { useTranslations } from "@/i18n";
import { PROJECT_LIKENESS_CONSENT_VERSION } from "./casting-accept-api";
/** Mount with a project/likeness key so changing the consent subject resets both gates. */
export function ProjectLikenessConsent({
  projectName,
  confirmLabel,
  busy,
  onConfirm,
  onBack,
}: {
  projectName: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: (read: boolean, adultAttested: boolean) => void;
  onBack: () => void;
}) {
  const t = useTranslations(),
    theme = useTheme();
  const [read, setRead] = useState(false),
    [attested, setAttested] = useState(false),
    [height, setHeight] = useState(0),
    [viewport, setViewport] = useState(0);
  const readAll = read || (height > 0 && viewport > 0 && height <= viewport + 12);
  return (
    <View style={{ gap: 10 }}>
      <ScrollView
        testID="casting-consent-copy"
        nestedScrollEnabled
        style={{ height: 300, borderRadius: 8, backgroundColor: theme.backgroundElement }}
        contentContainerStyle={{ padding: 12, gap: 10 }}
        onLayout={(e) => setViewport(e.nativeEvent.layout.height)}
        onContentSizeChange={(_w, h) => setHeight(h)}
        scrollEventThrottle={16}
        onScroll={(e) => {
          const n = e.nativeEvent;
          if (n.layoutMeasurement.height + n.contentOffset.y >= n.contentSize.height - 12)
            setRead(true);
        }}
      >
        <ThemedText type="small">{PROJECT_LIKENESS_CONSENT_VERSION}</ThemedText>
        {(["Project", "Purpose", "Prohibited", "Transfer", "Controls"] as const).map((s) => (
          <View key={s} style={{ gap: 4 }}>
            <ThemedText type="smallBold">{t(`castingConsent.grant${s}Title`)}</ThemedText>
            <ThemedText type="small">
              {t(`castingConsent.grant${s}Body`).replace("{project}", projectName)}
            </ThemedText>
          </View>
        ))}
      </ScrollView>
      {!readAll ? (
        <ThemedText type="small">{t("castingConsent.consentScrollHint")}</ThemedText>
      ) : null}
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: attested }}
        disabled={busy}
        onPress={() => setAttested((v) => !v)}
        style={{ padding: 10 }}
      >
        <ThemedText>
          {attested ? "✓ " : "□ "}
          {t("castingConsent.grantAttestation")}
        </ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={busy || !readAll || !attested}
        onPress={() => {
          if (readAll && attested && !busy) onConfirm(readAll, attested);
        }}
        style={{ padding: 12, opacity: busy || !readAll || !attested ? 0.45 : 1 }}
      >
        <ThemedText type="small">{confirmLabel}</ThemedText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={onBack}
        style={{ padding: 12 }}
      >
        <ThemedText type="small">{t("common.back")}</ThemedText>
      </Pressable>
    </View>
  );
}
